/**
 * Token estimation module — uses local character-based estimation only.
 * No API calls for token counting (OpenAI-compatible endpoints don't support countTokens).
 */

import type { Attachment } from '../utils/attachments.js'
import { normalizeAttachmentForAPI } from '../utils/messages.js'
import { jsonStringify } from '../utils/slowOperations.js'

/**
 * Count tokens for a string using local estimation.
 */
export async function countTokensWithAPI(
  content: string,
): Promise<number | null> {
  if (!content) return 0
  return roughTokenCountEstimation(content)
}

/**
 * Count tokens for messages using local estimation.
 */
export async function countMessagesTokensWithAPI(
  messages: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
): Promise<number | null> {
  let total = 0

  for (const msg of messages) {
    const content = msg.content
    if (typeof content === 'string') {
      total += roughTokenCountEstimation(content)
    } else if (Array.isArray(content)) {
      for (const block of content as Record<string, unknown>[]) {
        if (typeof block === 'string') {
          total += roughTokenCountEstimation(block)
        } else if (block.type === 'text' && typeof block.text === 'string') {
          total += roughTokenCountEstimation(block.text)
        } else if (block.type === 'tool_use') {
          total += roughTokenCountEstimation(
            String(block.name || '') + jsonStringify(block.input ?? {}),
          )
        } else if (block.type === 'tool_result') {
          const rc = block.content
          if (typeof rc === 'string') {
            total += roughTokenCountEstimation(rc)
          } else if (Array.isArray(rc)) {
            for (const c of rc as Record<string, unknown>[]) {
              if (typeof c.text === 'string') {
                total += roughTokenCountEstimation(c.text)
              }
            }
          }
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          total += roughTokenCountEstimation(block.thinking)
        } else if (block.type === 'image' || block.type === 'document') {
          total += 2000
        } else {
          total += roughTokenCountEstimation(jsonStringify(block))
        }
      }
    }
  }

  // Add tool definitions estimate
  if (tools.length > 0) {
    total += roughTokenCountEstimation(jsonStringify(tools))
  }

  return total
}

export function roughTokenCountEstimation(
  content: string,
  bytesPerToken: number = 4,
): number {
  return Math.round(content.length / bytesPerToken)
}

export function bytesPerTokenForFileType(fileExtension: string): number {
  switch (fileExtension) {
    case 'json':
    case 'jsonl':
    case 'jsonc':
      return 2
    default:
      return 4
  }
}

export function roughTokenCountEstimationForFileType(
  content: string,
  fileExtension: string,
): number {
  return roughTokenCountEstimation(
    content,
    bytesPerTokenForFileType(fileExtension),
  )
}

/**
 * Haiku fallback — now uses the same local estimation.
 */
export async function countTokensViaHaikuFallback(
  messages: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
): Promise<number | null> {
  return countMessagesTokensWithAPI(messages, tools)
}

export function roughTokenCountEstimationForMessages(
  messages: readonly {
    type: string
    message?: { content?: unknown }
    attachment?: Attachment
  }[],
): number {
  let totalTokens = 0
  for (const message of messages) {
    totalTokens += roughTokenCountEstimationForMessage(message)
  }
  return totalTokens
}

export function roughTokenCountEstimationForMessage(message: {
  type: string
  message?: { content?: unknown }
  attachment?: Attachment
}): number {
  if (
    (message.type === 'assistant' || message.type === 'user') &&
    message.message?.content
  ) {
    return roughTokenCountEstimationForContent(message.message?.content)
  }

  if (message.type === 'attachment' && message.attachment) {
    const userMessages = normalizeAttachmentForAPI(message.attachment)
    let total = 0
    for (const userMsg of userMessages) {
      total += roughTokenCountEstimationForContent(userMsg.message.content)
    }
    return total
  }

  return 0
}

function roughTokenCountEstimationForContent(
  content: string | Array<Record<string, unknown>> | undefined,
): number {
  if (!content) return 0
  if (typeof content === 'string') {
    return roughTokenCountEstimation(content)
  }
  let totalTokens = 0
  for (const block of content) {
    totalTokens += roughTokenCountEstimationForBlock(block)
  }
  return totalTokens
}

function roughTokenCountEstimationForBlock(
  block: string | Record<string, unknown>,
): number {
  if (typeof block === 'string') {
    return roughTokenCountEstimation(block)
  }
  if (block.type === 'text' && typeof block.text === 'string') {
    return roughTokenCountEstimation(block.text)
  }
  if (block.type === 'image' || block.type === 'document') {
    return 2000
  }
  if (block.type === 'tool_result') {
    return roughTokenCountEstimationForContent(
      block.content as string | Array<Record<string, unknown>> | undefined,
    )
  }
  if (block.type === 'tool_use') {
    return roughTokenCountEstimation(
      String(block.name || '') + jsonStringify(block.input ?? {}),
    )
  }
  if (block.type === 'thinking' && typeof block.thinking === 'string') {
    return roughTokenCountEstimation(block.thinking)
  }
  if (block.type === 'redacted_thinking' && typeof block.data === 'string') {
    return roughTokenCountEstimation(block.data)
  }
  return roughTokenCountEstimation(jsonStringify(block))
}
