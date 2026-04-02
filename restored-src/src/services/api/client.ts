/**
 * OpenAI-compatible API client that mimics the Anthropic SDK interface.
 *
 * The downstream code calls `anthropic.beta.messages.create(params, opts)`,
 * so we return an object with that shape but internally translate to
 * OpenAI chat/completions format.
 */

import { randomUUID } from 'crypto'
import { logForDebugging } from '../../utils/debug.js'
import {
  convertMessagesFlat,
  convertToolsToOpenAI,
  createToolCallAssembler,
  getAssembledToolUseBlocks,
  parseSSEStream,
  processToolCallDelta,
  type OpenAIChatRequest,
  type OpenAIStreamChunk,
} from './openaiAdapter.js'

// Default configuration for Volcano Engine (火山引擎)
const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/coding/v3'
const DEFAULT_API_KEY = '4fe3d114-5965-4d2b-b54e-041b76cf8daa'
const DEFAULT_MODEL = 'MiniMax-M2.5'

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'

/**
 * Fake Anthropic SDK error classes for compatibility with downstream code.
 */
class FakeAPIError extends Error {
  status: number
  headers: Headers | null

  constructor(message: string, status: number, headers?: Headers) {
    super(message)
    this.name = 'APIError'
    this.status = status
    this.headers = headers || null
  }
}

/**
 * SSE stream wrapper that mimics Anthropic's Stream<BetaRawMessageStreamEvent>.
 *
 * Translates OpenAI streaming chunks into Anthropic-format events so the
 * existing queryModel() streaming loop works without modification.
 */
class AnthropicCompatStream {
  private response: Response
  private signal?: AbortSignal
  controller = new AbortController()

  constructor(response: Response, signal?: AbortSignal) {
    this.response = response
    this.signal = signal
  }

  async *[Symbol.asyncIterator]() {
    const assembler = createToolCallAssembler()
    let contentBlockIndex = 0
    let hasEmittedMessageStart = false
    let accumulatedText = ''
    let hasStartedTextBlock = false
    let accumulatedThinking = ''
    let hasStartedThinkingBlock = false

    for await (const chunk of parseSSEStream(this.response)) {
      if (this.signal?.aborted) break

      const choice = chunk.choices?.[0]
      if (!choice) continue
      const delta = choice.delta

      // Emit message_start on first chunk
      if (!hasEmittedMessageStart) {
        hasEmittedMessageStart = true
        yield {
          type: 'message_start' as const,
          message: {
            id: chunk.id || `msg_${randomUUID()}`,
            type: 'message' as const,
            role: 'assistant' as const,
            content: [],
            model: chunk.model || DEFAULT_MODEL,
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: chunk.usage?.prompt_tokens || 0,
              output_tokens: chunk.usage?.completion_tokens || 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          },
        }
      }

      // Handle reasoning_content (thinking)
      if (delta.reasoning_content) {
        if (!hasStartedThinkingBlock) {
          hasStartedThinkingBlock = true
          yield {
            type: 'content_block_start' as const,
            index: contentBlockIndex,
            content_block: {
              type: 'thinking' as const,
              thinking: '',
              signature: '',
            },
          }
        }
        accumulatedThinking += delta.reasoning_content
        yield {
          type: 'content_block_delta' as const,
          index: contentBlockIndex,
          delta: {
            type: 'thinking_delta' as const,
            thinking: delta.reasoning_content,
          },
        }
      }

      // Handle text content
      if (delta.content) {
        // Close thinking block if still open
        if (hasStartedThinkingBlock && !hasStartedTextBlock) {
          yield {
            type: 'content_block_stop' as const,
            index: contentBlockIndex,
          }
          contentBlockIndex++
        }

        if (!hasStartedTextBlock) {
          hasStartedTextBlock = true
          yield {
            type: 'content_block_start' as const,
            index: contentBlockIndex,
            content_block: {
              type: 'text' as const,
              text: '',
            },
          }
        }
        accumulatedText += delta.content
        yield {
          type: 'content_block_delta' as const,
          index: contentBlockIndex,
          delta: {
            type: 'text_delta' as const,
            text: delta.content,
          },
        }
      }

      // Handle tool_calls
      if (delta.tool_calls) {
        // Close any open text or thinking block first
        if (hasStartedTextBlock) {
          yield {
            type: 'content_block_stop' as const,
            index: contentBlockIndex,
          }
          contentBlockIndex++
          hasStartedTextBlock = false
        } else if (hasStartedThinkingBlock && !hasStartedTextBlock) {
          yield {
            type: 'content_block_stop' as const,
            index: contentBlockIndex,
          }
          contentBlockIndex++
          hasStartedThinkingBlock = false
        }

        for (const tcDelta of delta.tool_calls) {
          // New tool call — emit content_block_start
          if (tcDelta.id) {
            yield {
              type: 'content_block_start' as const,
              index: contentBlockIndex + tcDelta.index,
              content_block: {
                type: 'tool_use' as const,
                id: tcDelta.id,
                name: tcDelta.function?.name || '',
                input: '',
              },
            }
          }
          // Incremental arguments
          if (tcDelta.function?.arguments) {
            yield {
              type: 'content_block_delta' as const,
              index: contentBlockIndex + tcDelta.index,
              delta: {
                type: 'input_json_delta' as const,
                partial_json: tcDelta.function.arguments,
              },
            }
          }
        }

        processToolCallDelta(assembler, delta.tool_calls)
      }

      // Handle finish_reason
      if (choice.finish_reason) {
        // Close any open block
        if (hasStartedTextBlock) {
          yield {
            type: 'content_block_stop' as const,
            index: contentBlockIndex,
          }
          contentBlockIndex++
        } else if (hasStartedThinkingBlock) {
          yield {
            type: 'content_block_stop' as const,
            index: contentBlockIndex,
          }
          contentBlockIndex++
        }

        // Close tool call blocks
        const toolBlocks = getAssembledToolUseBlocks(assembler)
        for (let i = 0; i < toolBlocks.length; i++) {
          yield {
            type: 'content_block_stop' as const,
            index: contentBlockIndex + i,
          }
        }

        // Map OpenAI finish_reason to Anthropic stop_reason
        let stopReason: string
        switch (choice.finish_reason) {
          case 'stop':
            stopReason = 'end_turn'
            break
          case 'tool_calls':
            stopReason = 'tool_use'
            break
          case 'length':
            stopReason = 'max_tokens'
            break
          default:
            stopReason = 'end_turn'
        }

        yield {
          type: 'message_delta' as const,
          delta: {
            stop_reason: stopReason,
            stop_sequence: null,
          },
          usage: {
            output_tokens: chunk.usage?.completion_tokens || 0,
          },
        }

        yield {
          type: 'message_stop' as const,
        }
      }
    }

    // Edge case: stream ended without a finish_reason
    if (hasEmittedMessageStart && !accumulatedText && !hasStartedTextBlock) {
      // Ensure we emit at least a message_delta to close
    }
  }
}

/**
 * Build an object that looks like Anthropic SDK to the rest of the codebase.
 */
function createFakeAnthropicClient(config: {
  apiKey: string
  baseURL: string
  model: string
  timeout: number
}) {
  const makeRequest = async (
    params: Record<string, unknown>,
    opts?: { signal?: AbortSignal; timeout?: number; headers?: Record<string, string> },
  ) => {
    // Extract Anthropic params and convert to OpenAI format
    const messages = params.messages as Record<string, unknown>[]
    const system = params.system as
      | string
      | Array<{ type: string; text: string }>
      | undefined
    const tools = params.tools as Record<string, unknown>[] | undefined
    const maxTokens = (params.max_tokens as number) || 16384
    const temperature = (params.temperature as number) ?? 0.7
    const stream = params.stream as boolean

    // Build system prompt text
    let systemText = ''
    if (typeof system === 'string') {
      systemText = system
    } else if (Array.isArray(system)) {
      systemText = system
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n\n')
    }

    // Convert messages
    const openaiMessages = convertMessagesFlat(messages, systemText)

    // Convert tools
    const openaiTools = tools ? convertToolsToOpenAI(tools) : undefined

    const body: OpenAIChatRequest = {
      model: config.model,
      messages: openaiMessages,
      stream,
      max_tokens: maxTokens,
      temperature,
      ...(openaiTools && openaiTools.length > 0 ? { tools: openaiTools } : {}),
    }

    const url = `${config.baseURL.replace(/\/$/, '')}/chat/completions`

    logForDebugging(
      `[API:openai] ${stream ? 'Streaming' : 'Non-streaming'} request to ${url}, model=${config.model}, messages=${openaiMessages.length}`,
    )

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        ...(opts?.headers || {}),
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      throw new FakeAPIError(
        `OpenAI API error ${response.status}: ${errorBody}`,
        response.status,
        response.headers,
      )
    }

    return response
  }

  return {
    beta: {
      messages: {
        // Streaming create — returns a thenable with .withResponse()
        // Anthropic SDK returns a special object from .create() that is
        // both a Promise (thenable) AND has a .withResponse() method,
        // so callers can do: .create(...).withResponse()
        create: (
          params: Record<string, unknown>,
          opts?: { signal?: AbortSignal; timeout?: number; headers?: Record<string, string> },
        ) => {
          if (params.stream) {
            const innerPromise = (async () => {
              const response = await makeRequest(params, opts)
              const stream = new AnthropicCompatStream(response, opts?.signal)
              return { stream, response }
            })()

            // Build a thenable that also has .withResponse()
            const thenable = {
              then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
                innerPromise.then(({ stream }) => resolve(stream), reject),
              catch: (reject: (e: unknown) => void) =>
                innerPromise.catch(reject),
              withResponse: () =>
                innerPromise.then(({ stream, response }) => ({
                  data: stream,
                  request_id: response.headers.get('x-request-id') || randomUUID(),
                  response,
                })),
            }
            return thenable
          }

          // Non-streaming path — also needs .withResponse() shape
          const innerPromise = (async () => {
            const response = await makeRequest(
              { ...params, stream: false },
              opts,
            )
            const json = (await response.json()) as Record<string, unknown>
            return { result: convertNonStreamingResponse(json, config.model), response }
          })()

          const thenable = {
            then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
              innerPromise.then(({ result }) => resolve(result), reject),
            catch: (reject: (e: unknown) => void) =>
              innerPromise.catch(reject),
            withResponse: () =>
              innerPromise.then(({ result, response }) => ({
                data: result,
                request_id: response.headers.get('x-request-id') || randomUUID(),
                response,
              })),
          }
          return thenable
        },

        // Token counting — return rough estimate
        countTokens: async (params: Record<string, unknown>) => {
          const messages = params.messages as Record<string, unknown>[]
          let totalChars = 0
          for (const msg of messages) {
            const content = msg.content
            if (typeof content === 'string') {
              totalChars += content.length
            } else if (Array.isArray(content)) {
              for (const block of content as Record<string, unknown>[]) {
                if (block.text) totalChars += String(block.text).length
              }
            }
          }
          return { input_tokens: Math.ceil(totalChars / 4) }
        },
      },
    },
  }
}

/**
 * Convert non-streaming OpenAI response to Anthropic BetaMessage format.
 */
function convertNonStreamingResponse(
  json: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const choices = json.choices as Array<Record<string, unknown>>
  const choice = choices?.[0]
  const message = choice?.message as Record<string, unknown> | undefined
  const usage = json.usage as Record<string, number> | undefined

  const content: Array<Record<string, unknown>> = []

  // Handle reasoning_content
  if (message?.reasoning_content) {
    content.push({
      type: 'thinking',
      thinking: String(message.reasoning_content),
      signature: '',
    })
  }

  // Handle text content
  if (message?.content) {
    content.push({
      type: 'text',
      text: String(message.content),
    })
  }

  // Handle tool_calls
  const toolCalls = message?.tool_calls as
    | Array<Record<string, unknown>>
    | undefined
  if (toolCalls) {
    for (const tc of toolCalls) {
      const fn = tc.function as Record<string, unknown>
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(String(fn.arguments || '{}'))
      } catch {
        input = { __raw: fn.arguments }
      }
      content.push({
        type: 'tool_use',
        id: tc.id || `toolu_${randomUUID()}`,
        name: fn.name || '',
        input,
      })
    }
  }

  // Map finish_reason
  let stopReason = 'end_turn'
  const finishReason = choice?.finish_reason as string | undefined
  if (finishReason === 'tool_calls') stopReason = 'tool_use'
  else if (finishReason === 'length') stopReason = 'max_tokens'

  return {
    id: (json.id as string) || `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: (json.model as string) || model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: usage?.prompt_tokens || 0,
      output_tokens: usage?.completion_tokens || 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}

/**
 * Returns a fake Anthropic client that speaks OpenAI protocol internally.
 *
 * Signature matches the original `getAnthropicClient` so call sites don't change.
 */
export async function getAnthropicClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: unknown
  source?: string
}): Promise<ReturnType<typeof createFakeAnthropicClient>> {
  const resolvedApiKey =
    apiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    DEFAULT_API_KEY

  const resolvedBaseURL = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL

  const resolvedModel = DEFAULT_MODEL

  const timeout = parseInt(
    process.env.API_TIMEOUT_MS || String(600 * 1000),
    10,
  )

  logForDebugging(
    `[API:client] Creating OpenAI-compat client, baseURL=${resolvedBaseURL}, model=${resolvedModel}, source=${source ?? 'unknown'}`,
  )

  return createFakeAnthropicClient({
    apiKey: resolvedApiKey,
    baseURL: resolvedBaseURL,
    model: resolvedModel,
    timeout,
  })
}
