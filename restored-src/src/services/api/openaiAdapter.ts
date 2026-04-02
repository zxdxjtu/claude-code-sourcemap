/**
 * OpenAI-compatible API adapter.
 *
 * Converts between Anthropic's internal message format and the OpenAI
 * chat completions API format used by Volcano Engine / MiniMax.
 */

import type { OpenAIClientConfig } from './client.js'

// ─── Types ───────────────────────────────────────────────────────────

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentPart[] | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
  name?: string
}

export interface OpenAIContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string; detail?: string }
}

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export interface OpenAIStreamChunk {
  id?: string
  object?: string
  created?: number
  model?: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface OpenAIChatRequest {
  model: string
  messages: OpenAIMessage[]
  tools?: OpenAITool[]
  stream: boolean
  max_tokens: number
  temperature?: number
  top_p?: number
  stop?: string[]
}

// ─── Message Conversion ──────────────────────────────────────────────

/**
 * Convert Anthropic-format messages + system prompt to OpenAI messages array.
 */
export function convertMessagesToOpenAI(
  messages: readonly Record<string, unknown>[],
  systemPrompt: string | string[],
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  // System prompt
  const sysText = Array.isArray(systemPrompt)
    ? systemPrompt.join('\n\n')
    : systemPrompt
  if (sysText) {
    result.push({ role: 'system', content: sysText })
  }

  for (const msg of messages) {
    const role = msg.role as string
    const content = msg.content as unknown

    if (role === 'user') {
      result.push(convertUserMessage(content))
    } else if (role === 'assistant') {
      result.push(...convertAssistantMessage(content))
    }
  }

  return result
}

function convertUserMessage(content: unknown): OpenAIMessage {
  if (typeof content === 'string') {
    return { role: 'user', content }
  }

  if (Array.isArray(content)) {
    // Check if it's a tool_result array
    const toolResults = content.filter(
      (b: Record<string, unknown>) => b.type === 'tool_result',
    )
    if (toolResults.length > 0) {
      // Return multiple messages for tool results
      // But since we return a single OpenAIMessage, we'll handle this at call site
      // For now, handle the first tool_result
    }

    // Mix of text and other blocks
    const textParts: string[] = []
    const toolResultMsgs: OpenAIMessage[] = []

    for (const block of content) {
      if (typeof block === 'string') {
        textParts.push(block)
      } else if (block.type === 'text') {
        textParts.push(block.text || '')
      } else if (block.type === 'tool_result') {
        // These will be handled separately
        const resultContent = block.content
        let text = ''
        if (typeof resultContent === 'string') {
          text = resultContent
        } else if (Array.isArray(resultContent)) {
          text = resultContent
            .filter((c: Record<string, unknown>) => c.type === 'text')
            .map((c: Record<string, unknown>) => c.text)
            .join('\n')
        }
        toolResultMsgs.push({
          role: 'tool',
          tool_call_id: block.tool_use_id || block.id || '',
          content: text || '[no output]',
        })
      } else if (block.type === 'image') {
        // Image blocks — convert to image_url format
        const source = block.source as Record<string, unknown> | undefined
        if (source?.type === 'base64') {
          textParts.push('[image]')
        }
      }
    }

    // If we only have tool results, return the first one
    // (the caller should handle splitting)
    if (textParts.length === 0 && toolResultMsgs.length > 0) {
      return toolResultMsgs[0]!
    }

    return { role: 'user', content: textParts.join('\n') || '' }
  }

  return { role: 'user', content: String(content ?? '') }
}

function convertAssistantMessage(
  content: unknown,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  if (typeof content === 'string') {
    result.push({ role: 'assistant', content })
    return result
  }

  if (Array.isArray(content)) {
    let textParts: string[] = []
    const toolCalls: OpenAIToolCall[] = []

    for (const block of content) {
      if (typeof block === 'string') {
        textParts.push(block)
      } else if (block.type === 'text') {
        textParts.push(block.text || '')
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        // Skip thinking blocks — reasoning_content is handled at response level
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id || '',
          type: 'function',
          function: {
            name: block.name || '',
            arguments:
              typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input ?? {}),
          },
        })
      }
    }

    const msg: OpenAIMessage = {
      role: 'assistant',
      content: textParts.join('') || null,
    }
    if (toolCalls.length > 0) {
      msg.tool_calls = toolCalls
    }
    result.push(msg)
  }

  return result.length > 0
    ? result
    : [{ role: 'assistant', content: '' }]
}

/**
 * Convert Anthropic-format messages to a flat OpenAI messages array,
 * properly handling interleaved tool_use/tool_result pairs.
 */
export function convertMessagesFlat(
  messages: readonly Record<string, unknown>[],
  systemPrompt: string | string[],
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  const sysText = Array.isArray(systemPrompt)
    ? systemPrompt.join('\n\n')
    : systemPrompt
  if (sysText) {
    result.push({ role: 'system', content: sysText })
  }

  for (const msg of messages) {
    const role = msg.role as string
    const content = msg.content as unknown

    if (role === 'user') {
      if (Array.isArray(content)) {
        // Split tool_result blocks into separate tool messages
        const textParts: string[] = []
        for (const block of content as Record<string, unknown>[]) {
          if (block.type === 'tool_result') {
            // Flush any accumulated text first
            if (textParts.length > 0) {
              result.push({ role: 'user', content: textParts.join('\n') })
              textParts.length = 0
            }
            const resultContent = block.content
            let text = ''
            if (typeof resultContent === 'string') {
              text = resultContent
            } else if (Array.isArray(resultContent)) {
              text = (resultContent as Record<string, unknown>[])
                .filter(c => c.type === 'text')
                .map(c => c.text as string)
                .join('\n')
            }
            result.push({
              role: 'tool',
              tool_call_id: (block.tool_use_id || block.id || '') as string,
              content: text || '[no output]',
            })
          } else if (block.type === 'text') {
            textParts.push((block.text || '') as string)
          } else if (typeof block === 'string') {
            textParts.push(block as unknown as string)
          }
        }
        if (textParts.length > 0) {
          result.push({ role: 'user', content: textParts.join('\n') })
        }
      } else {
        result.push({ role: 'user', content: String(content ?? '') })
      }
    } else if (role === 'assistant') {
      const converted = convertAssistantMessage(content)
      result.push(...converted)
    }
  }

  return result
}

// ─── Tool Conversion ─────────────────────────────────────────────────

/**
 * Convert Anthropic tool definitions to OpenAI function calling format.
 */
export function convertToolsToOpenAI(
  tools: readonly Record<string, unknown>[],
): OpenAITool[] {
  return tools
    .filter(t => {
      // Skip server tools, advisor, etc.
      const type = t.type as string | undefined
      return !type || type === 'custom' || type === undefined
    })
    .map(tool => ({
      type: 'function' as const,
      function: {
        name: (tool.name as string) || '',
        description: (tool.description as string) || undefined,
        parameters: (tool.input_schema as Record<string, unknown>) || undefined,
      },
    }))
}

// ─── Response Conversion ─────────────────────────────────────────────

/**
 * State for incrementally assembling tool_calls from streamed deltas.
 */
export interface ToolCallAssembler {
  toolCalls: Map<
    number,
    { id: string; name: string; arguments: string }
  >
}

export function createToolCallAssembler(): ToolCallAssembler {
  return { toolCalls: new Map() }
}

/**
 * Process a single streaming chunk's tool_calls delta and update the assembler.
 */
export function processToolCallDelta(
  assembler: ToolCallAssembler,
  deltas: OpenAIStreamChunk['choices'][0]['delta']['tool_calls'],
): void {
  if (!deltas) return
  for (const delta of deltas) {
    const existing = assembler.toolCalls.get(delta.index)
    if (!existing) {
      assembler.toolCalls.set(delta.index, {
        id: delta.id || '',
        name: delta.function?.name || '',
        arguments: delta.function?.arguments || '',
      })
    } else {
      if (delta.id) existing.id = delta.id
      if (delta.function?.name) existing.name += delta.function.name
      if (delta.function?.arguments)
        existing.arguments += delta.function.arguments
    }
  }
}

/**
 * Get the assembled tool calls as Anthropic-format tool_use content blocks.
 */
export function getAssembledToolUseBlocks(
  assembler: ToolCallAssembler,
): Array<{
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}> {
  const blocks: Array<{
    type: 'tool_use'
    id: string
    name: string
    input: Record<string, unknown>
  }> = []

  for (const [, tc] of assembler.toolCalls) {
    let input: Record<string, unknown> = {}
    try {
      input = JSON.parse(tc.arguments || '{}')
    } catch {
      // If JSON parse fails, wrap raw string
      input = { __raw: tc.arguments }
    }
    blocks.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.name,
      input,
    })
  }

  return blocks
}

// ─── HTTP Request Helper ─────────────────────────────────────────────

/**
 * Make a streaming request to an OpenAI-compatible endpoint.
 * Returns a ReadableStream of SSE lines.
 */
export async function makeOpenAIStreamRequest(
  config: OpenAIClientConfig,
  body: OpenAIChatRequest,
  signal?: AbortSignal,
): Promise<Response> {
  const url = `${config.baseURL.replace(/\/$/, '')}/chat/completions`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    const error = new Error(
      `OpenAI API error ${response.status}: ${errorBody}`,
    )
    ;(error as unknown as Record<string, unknown>).status = response.status
    ;(error as unknown as Record<string, unknown>).headers = response.headers
    throw error
  }

  return response
}

/**
 * Parse SSE stream from a Response into async iterable of OpenAIStreamChunks.
 */
export async function* parseSSEStream(
  response: Response,
): AsyncGenerator<OpenAIStreamChunk> {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue
        if (trimmed === 'data: [DONE]') return

        if (trimmed.startsWith('data: ')) {
          const json = trimmed.slice(6)
          try {
            const chunk = JSON.parse(json) as OpenAIStreamChunk
            yield chunk
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim()
      if (
        trimmed.startsWith('data: ') &&
        trimmed !== 'data: [DONE]'
      ) {
        try {
          const chunk = JSON.parse(trimmed.slice(6)) as OpenAIStreamChunk
          yield chunk
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Make a non-streaming request to an OpenAI-compatible endpoint.
 */
export async function makeOpenAINonStreamRequest(
  config: OpenAIClientConfig,
  body: Omit<OpenAIChatRequest, 'stream'>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const url = `${config.baseURL.replace(/\/$/, '')}/chat/completions`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ ...body, stream: false }),
    signal,
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    const error = new Error(
      `OpenAI API error ${response.status}: ${errorBody}`,
    )
    ;(error as unknown as Record<string, unknown>).status = response.status
    ;(error as unknown as Record<string, unknown>).headers = response.headers
    throw error
  }

  return (await response.json()) as Record<string, unknown>
}
