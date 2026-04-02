/**
 * Simplified retry logic for OpenAI-compatible API.
 * Removes Anthropic-specific error handling, 529 logic, and model fallback.
 * Keeps basic exponential backoff with retry-after header support.
 */

import type { QuerySource } from 'src/constants/querySource.js'
import type { SystemAPIErrorMessage } from 'src/types/message.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logError } from 'src/utils/log.js'
import { createSystemAPIErrorMessage } from 'src/utils/messages.js'
import { errorMessage } from '../../utils/errors.js'
import { sleep } from '../../utils/sleep.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import { logEvent } from '../analytics/index.js'

const DEFAULT_MAX_RETRIES = 5
const FLOOR_OUTPUT_TOKENS = 3000
export const BASE_DELAY_MS = 500

export interface RetryContext {
  maxTokensOverride?: number
  model: string
  thinkingConfig: ThinkingConfig
  fastMode?: boolean
}

interface RetryOptions {
  maxRetries?: number
  model: string
  fallbackModel?: string
  thinkingConfig: ThinkingConfig
  fastMode?: boolean
  signal?: AbortSignal
  querySource?: QuerySource
  initialConsecutive529Errors?: number
}

export class CannotRetryError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly retryContext: RetryContext,
  ) {
    const message = errorMessage(originalError)
    super(message)
    this.name = 'RetryError'

    if (originalError instanceof Error && originalError.stack) {
      this.stack = originalError.stack
    }
  }
}

export class FallbackTriggeredError extends Error {
  constructor(
    public readonly originalModel: string,
    public readonly fallbackModel: string,
  ) {
    super(`Model fallback triggered: ${originalModel} -> ${fallbackModel}`)
    this.name = 'FallbackTriggeredError'
  }
}

/**
 * Check if an error is a retriable API error (5xx, 429, connection errors).
 */
function isRetriableError(error: unknown): boolean {
  if (error instanceof Error) {
    const status = (error as unknown as Record<string, unknown>).status as
      | number
      | undefined

    // Retry on server errors
    if (status && status >= 500) return true

    // Retry on rate limit
    if (status === 429) return true

    // Retry on timeout
    if (status === 408) return true

    // Retry on connection errors
    if (
      error.message.includes('ECONNRESET') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('EPIPE') ||
      error.message.includes('fetch failed') ||
      error.message.includes('network')
    ) {
      return true
    }
  }
  return false
}

/**
 * Check if error looks like a 529 overloaded error (for compatibility).
 */
export function is529Error(error: unknown): boolean {
  if (error instanceof Error) {
    const status = (error as unknown as Record<string, unknown>).status as
      | number
      | undefined
    if (status === 529) return true
    if (error.message?.includes('"type":"overloaded_error"')) return true
  }
  return false
}

/**
 * Extract Retry-After header value from error.
 */
function getRetryAfter(error: unknown): string | null {
  const headers = (error as Record<string, unknown>).headers as
    | Headers
    | Record<string, string>
    | undefined
  if (!headers) return null

  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get('retry-after')
  }

  return (headers as Record<string, string>)['retry-after'] || null
}

export function getRetryDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  maxDelayMs = 32000,
): number {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) {
      return seconds * 1000
    }
  }

  const baseDelay = Math.min(
    BASE_DELAY_MS * Math.pow(2, attempt - 1),
    maxDelayMs,
  )
  const jitter = Math.random() * 0.25 * baseDelay
  return baseDelay + jitter
}

export function parseMaxTokensContextOverflowError(
  error: unknown,
):
  | { inputTokens: number; maxTokens: number; contextLimit: number }
  | undefined {
  if (!(error instanceof Error)) return undefined
  const status = (error as unknown as Record<string, unknown>).status as
    | number
    | undefined
  if (status !== 400) return undefined

  const msg = error.message
  if (!msg.includes('context') && !msg.includes('max_tokens')) return undefined

  // Try to parse numeric values from error message
  const regex = /(\d+)\s*\+\s*(\d+)\s*>\s*(\d+)/
  const match = msg.match(regex)
  if (!match || !match[1] || !match[2] || !match[3]) return undefined

  const inputTokens = parseInt(match[1], 10)
  const maxTokens = parseInt(match[2], 10)
  const contextLimit = parseInt(match[3], 10)

  if (isNaN(inputTokens) || isNaN(maxTokens) || isNaN(contextLimit))
    return undefined

  return { inputTokens, maxTokens, contextLimit }
}

class AbortError extends Error {
  constructor() {
    super('Request was aborted')
    this.name = 'APIUserAbortError'
  }
}

export async function* withRetry<T>(
  getClient: () => Promise<unknown>,
  operation: (
    client: unknown,
    attempt: number,
    context: RetryContext,
  ) => Promise<T>,
  options: RetryOptions,
): AsyncGenerator<SystemAPIErrorMessage, T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const retryContext: RetryContext = {
    model: options.model,
    thinkingConfig: options.thinkingConfig,
    fastMode: options.fastMode,
  }

  let client: unknown = null
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    if (options.signal?.aborted) {
      throw new AbortError()
    }

    try {
      if (client === null) {
        client = await getClient()
      }
      return await operation(client, attempt, retryContext)
    } catch (error) {
      lastError = error
      logForDebugging(
        `API error (attempt ${attempt}/${maxRetries + 1}): ${errorMessage(error)}`,
        { level: 'error' },
      )

      // Don't retry non-retriable errors
      if (!isRetriableError(error) && attempt <= maxRetries) {
        // Check for context overflow and adjust
        const overflowData = parseMaxTokensContextOverflowError(error)
        if (overflowData) {
          const { inputTokens, contextLimit } = overflowData
          const safetyBuffer = 1000
          const availableContext = Math.max(
            0,
            contextLimit - inputTokens - safetyBuffer,
          )
          if (availableContext >= FLOOR_OUTPUT_TOKENS) {
            retryContext.maxTokensOverride = Math.max(
              FLOOR_OUTPUT_TOKENS,
              availableContext,
            )
            continue
          }
        }

        throw new CannotRetryError(error, retryContext)
      }

      if (attempt > maxRetries) {
        throw new CannotRetryError(error, retryContext)
      }

      // Calculate retry delay
      const retryAfter = getRetryAfter(error)
      const delayMs = getRetryDelay(attempt, retryAfter)

      logEvent('tengu_api_retry', {
        attempt,
        delayMs,
      })

      // Yield error message for UI display
      const fakeApiError = Object.assign(new Error(errorMessage(error)), {
        status: (error as Record<string, unknown>).status || 500,
        headers: (error as Record<string, unknown>).headers || null,
        message: errorMessage(error),
      })
      yield createSystemAPIErrorMessage(
        fakeApiError as never,
        delayMs,
        attempt,
        maxRetries,
      )

      await sleep(delayMs, options.signal, {
        abortError: () => new AbortError(),
      })

      // Refresh client on auth errors
      const status = (error as Record<string, unknown>).status as
        | number
        | undefined
      if (status === 401 || status === 403) {
        client = null
      }
    }
  }

  throw new CannotRetryError(lastError, retryContext)
}

export function getDefaultMaxRetries(): number {
  if (process.env.CLAUDE_CODE_MAX_RETRIES) {
    return parseInt(process.env.CLAUDE_CODE_MAX_RETRIES, 10)
  }
  return DEFAULT_MAX_RETRIES
}

export const REPEATED_529_ERROR_MESSAGE =
  'The API is currently overloaded. Please try again later.'
