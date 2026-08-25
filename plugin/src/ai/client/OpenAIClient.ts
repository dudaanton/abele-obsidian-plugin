import { requestUrl } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { prepareImageForApi } from '@/ai/imagePrep'
import type {
  AssistantMessage,
  AssistantContentBlock,
  TextContent,
  ThinkingContent,
  ToolCallContent,
  ToolDefinition,
  Message,
  UserMessage,
  ModelConfig,
  StreamOptions,
  StreamEvent,
  StopReason,
  Usage,
  UserContentPart,
} from './types'

// ── OpenAI API types (request/response) ─────────────────────

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentPart[] | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
  name?: string
  reasoning_content?: string
}

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
    strict: boolean
  }
}

// ── Streaming delta types ───────────────────────────────────

interface ChunkChoice {
  delta: {
    content?: string | null
    reasoning_content?: string | null
    reasoning?: string | null
    reasoning_text?: string | null
    tool_calls?: Array<{
      index: number
      id?: string
      function?: { name?: string; arguments?: string }
    }>
  }
  finish_reason?: string | null
  usage?: ChunkUsage
}

interface ChunkUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

interface StreamChunk {
  id?: string
  choices?: ChunkChoice[]
  usage?: ChunkUsage
}

// ── Client ──────────────────────────────────────────────────

export interface RemoteModel {
  id: string
  owned_by?: string
  created?: number
}

export class OpenAIClient {
  private static readonly DEFAULT_MAX_COMPLETION_TOKENS = 32000
  private static readonly MAX_TOOL_CALL_ID_LENGTH = 40

  /**
   * Fetch available models from a provider's /models endpoint.
   */
  async fetchModels(baseUrl: string, apiKey: string): Promise<RemoteModel[]> {
    const url = `${baseUrl.replace(/\/+$/, '')}/models`

    // `requestUrl` rather than `fetch`: it goes out from the main process, so a provider that
    // sends no CORS headers — most self-hosted ones — still answers. `throw: false` keeps the
    // error message below, which reports the provider's own body.
    const response = await requestUrl({
      url,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      throw: false,
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Failed to fetch models: HTTP ${response.status} ${response.text ?? ''}`)
    }

    const data = response.json
    const models: RemoteModel[] = (data.data || []).map(
      (m: { id: string; owned_by?: string; created?: number }) => ({
        id: m.id,
        owned_by: m.owned_by,
        created: m.created,
      })
    )

    return models.sort((a, b) => a.id.localeCompare(b.id))
  }

  /**
   * Stream a chat completion, yielding events as they arrive.
   * Handles SSE parsing, tool call assembly, thinking content, and usage tracking.
   */
  async *stream(
    model: ModelConfig,
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
    options: StreamOptions = {}
  ): AsyncGenerator<StreamEvent> {
    // Resolve vault: image references to base64 data URLs before sending
    const resolved = await OpenAIClient.resolveVaultImages(messages)
    const body = this.buildRequestBody(model, systemPrompt, resolved, tools, options)

    // `requestUrl` buffers the whole response and takes no abort signal, so it can neither
    // stream tokens as they arrive nor be stopped mid-answer. Both are the point of this call:
    // tokens appear as the model produces them, and Stop cancels the request. Every other
    // request in this file goes through `requestUrl`. Named on `window` for the same reason
    // the timers are — it is the window's own implementation that is wanted.
    const response = await window.fetch(this.getUrl(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      const errorMsg: AssistantMessage = this.makeErrorMessage(
        model,
        `HTTP ${response.status}: ${errorText}`
      )
      yield { type: 'error', error: errorMsg.errorMessage ?? '', message: errorMsg }
      return
    }

    if (!response.body) {
      const errorMsg = this.makeErrorMessage(model, 'No response body')
      yield { type: 'error', error: errorMsg.errorMessage ?? '', message: errorMsg }
      return
    }

    // State for assembling the response
    const output: AssistantMessage = {
      role: 'assistant',
      content: [],
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'stop',
      timestamp: Date.now(),
    }

    let currentBlock: (AssistantContentBlock & { partialArgs?: string }) | null = null
    // Track which reasoning field this model uses (reasoning_content, reasoning, reasoning_text)
    let reasoningField: string | null = null

    try {
      for await (const chunk of this.parseSSE(response.body, options.signal)) {
        if (!chunk || typeof chunk !== 'object') continue

        // Track usage
        if (chunk.usage) {
          output.usage = this.parseUsage(chunk.usage)
        }

        const choice = chunk.choices?.[0]
        if (!choice) continue

        // Fallback usage from choice (some providers like Moonshot)
        if (choice.usage && !chunk.usage) {
          output.usage = this.parseUsage(choice.usage)
        }

        // Stop reason
        if (choice.finish_reason) {
          output.stopReason = this.mapStopReason(choice.finish_reason)
          if (output.stopReason === 'error') {
            output.errorMessage = `Provider stop reason: ${choice.finish_reason}`
          }
        }

        const delta = choice.delta
        if (!delta) continue

        // ── Text content ──
        if (delta.content != null && delta.content.length > 0) {
          if (!currentBlock || currentBlock.type !== 'text') {
            if (currentBlock) yield* this.finishBlock(currentBlock, output)
            currentBlock = { type: 'text', text: '' }
            yield { type: 'text_start' }
          }
          ;(currentBlock as TextContent).text += delta.content
          yield { type: 'text_delta', delta: delta.content }
        }

        // ── Thinking / reasoning content ──
        // Models use different fields: reasoning_content, reasoning, reasoning_text
        const thinkingFields = ['reasoning_content', 'reasoning', 'reasoning_text'] as const
        for (const field of thinkingFields) {
          const value = delta[field]
          if (value == null || value.length === 0) continue
          // Prevent duplicate content from providers that emit same data in multiple fields
          if (reasoningField && reasoningField !== field) continue
          reasoningField = field

          if (!currentBlock || currentBlock.type !== 'thinking') {
            if (currentBlock) yield* this.finishBlock(currentBlock, output)
            currentBlock = { type: 'thinking', thinking: '' }
            yield { type: 'thinking_start' }
          }
          ;(currentBlock as ThinkingContent).thinking += value
          yield { type: 'thinking_delta', delta: value }
          break
        }

        // ── Tool calls ──
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const tcId = tc.id
            const tcName = tc.function?.name
            const tcArgs = tc.function?.arguments || ''

            // New tool call starts when we get an ID
            if (tcId) {
              if (currentBlock) yield* this.finishBlock(currentBlock, output)
              currentBlock = {
                type: 'toolCall',
                id: this.sanitizeToolCallId(tcId),
                name: tcName || '',
                arguments: {},
                partialArgs: '',
              }
              yield {
                type: 'tool_call_start',
                toolCallId: currentBlock.id,
                toolName: currentBlock.name,
              }
            }

            // Accumulate argument deltas
            if (currentBlock?.type === 'toolCall' && tcArgs) {
              currentBlock.partialArgs = (currentBlock.partialArgs || '') + tcArgs
              yield { type: 'tool_call_delta', delta: tcArgs }
            }

            // Update name if provided later
            if (currentBlock?.type === 'toolCall' && tcName && !currentBlock.name) {
              ;(currentBlock as ToolCallContent).name = tcName
            }
          }
        }
      }
    } catch (err: unknown) {
      if (currentBlock) yield* this.finishBlock(currentBlock, output)

      if (err instanceof DOMException && err.name === 'AbortError') {
        output.stopReason = 'aborted'
        yield { type: 'done', message: output }
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      output.stopReason = 'error'
      output.errorMessage = msg
      yield { type: 'error', error: msg, message: output }
      return
    }

    // Finish any remaining block
    if (currentBlock) yield* this.finishBlock(currentBlock, output)

    yield { type: 'done', message: output }
  }

  // ── Vault image resolution ──────────────────────────────────

  private static readonly VAULT_PREFIX = 'vault:'

  /**
   * Replace vault: image references with base64 data URLs.
   * Only clones messages that actually contain vault references.
   */
  private static async resolveVaultImages(messages: Message[]): Promise<Message[]> {
    let cloned = false
    let result = messages

    for (let i = 0; i < result.length; i++) {
      const msg = result[i]
      if (msg.role !== 'user' || !Array.isArray(msg.content)) continue

      const parts = msg.content as UserContentPart[]
      const hasVaultRef = parts.some(
        (p) => p.type === 'image_url' && p.image_url.url.startsWith(OpenAIClient.VAULT_PREFIX)
      )
      if (!hasVaultRef) continue

      if (!cloned) {
        result = [...messages]
        cloned = true
      }

      const resolvedParts = await Promise.all(
        parts.map(async (p) => {
          if (p.type !== 'image_url' || !p.image_url.url.startsWith(OpenAIClient.VAULT_PREFIX))
            return p
          const path = p.image_url.url.slice(OpenAIClient.VAULT_PREFIX.length)
          const dataUrl = await prepareImageForApi(path)
          return dataUrl
            ? { type: 'image_url' as const, image_url: { url: dataUrl } }
            : { type: 'text' as const, text: `[Image unavailable: ${path}]` }
        })
      )

      result[i] = { ...msg, content: resolvedParts } as UserMessage
    }

    return result
  }

  // ── Internals ─────────────────────────────────────────────

  private getUrl(model: ModelConfig): string {
    const base = model.baseUrl.replace(/\/+$/, '')
    return `${base}/chat/completions`
  }

  private buildRequestBody(
    model: ModelConfig,
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
    options: StreamOptions
  ): Record<string, unknown> {
    const openaiMessages = this.convertMessages(systemPrompt, messages, model.supportsReasoning)
    const openaiTools = this.convertTools(tools)

    const body: Record<string, unknown> = {
      model: model.id,
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true },
    }

    if (openaiTools.length > 0) {
      body.tools = openaiTools
    } else if (this.hasToolHistory(messages)) {
      // Some providers require tools param when conversation includes tool_calls
      body.tools = []
    }

    const maxTokens =
      options.maxTokens || Math.min(model.maxTokens, OpenAIClient.DEFAULT_MAX_COMPLETION_TOKENS)
    body.max_completion_tokens = maxTokens

    if (options.temperature != null) {
      body.temperature = options.temperature
    }

    if (options.reasoningEffort && model.supportsReasoning) {
      body.reasoning_effort = options.reasoningEffort
    }

    return body
  }

  private convertMessages(
    systemPrompt: string,
    messages: Message[],
    supportsReasoning: boolean
  ): OpenAIMessage[] {
    const result: OpenAIMessage[] = []

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt })
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      if (msg.role === 'user') {
        if (Array.isArray(msg.content)) {
          // Multipart content (text + images)
          result.push({
            role: 'user',
            content: msg.content.map((p) =>
              p.type === 'text'
                ? { type: 'text' as const, text: p.text }
                : { type: 'image_url' as const, image_url: p.image_url }
            ),
          })
        } else {
          result.push({ role: 'user', content: msg.content })
        }
        continue
      }

      if (msg.role === 'system') {
        result.push({ role: 'system', content: msg.content })
        continue
      }

      if (msg.role === 'assistant') {
        // Error/aborted messages: insert placeholder to preserve turn structure
        if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
          result.push({ role: 'assistant', content: '[Response interrupted]' })
          continue
        }

        const textParts = msg.content.filter((b): b is TextContent => b.type === 'text')
        const toolCalls = msg.content.filter((b): b is ToolCallContent => b.type === 'toolCall')
        const thinkingParts = msg.content.filter((b): b is ThinkingContent => b.type === 'thinking')

        const text = textParts.map((t) => t.text).join('')
        const openaiMsg: OpenAIMessage = {
          role: 'assistant',
          content: text || '',
        }

        // Include reasoning_content only when sending to a reasoning model
        if (thinkingParts.length > 0 && supportsReasoning) {
          openaiMsg.reasoning_content = thinkingParts.map((t) => t.thinking).join('')
        }

        if (toolCalls.length > 0) {
          openaiMsg.tool_calls = toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }))
        }

        result.push(openaiMsg)

        // Insert synthetic tool results for orphaned tool calls
        if (toolCalls.length > 0) {
          const nextToolResults = new Set<string>()
          for (let j = i + 1; j < messages.length; j++) {
            const next = messages[j]
            if (next.role === 'toolResult') {
              nextToolResults.add(next.toolCallId)
            } else if (next.role === 'assistant' || next.role === 'user') {
              break
            }
            // Skip injected messages (e.g. image content) without breaking the scan
          }
          for (const tc of toolCalls) {
            if (!nextToolResults.has(tc.id)) {
              result.push({
                role: 'tool',
                content: 'No result provided',
                tool_call_id: tc.id,
              })
            }
          }
        }
        continue
      }

      if (msg.role === 'toolResult') {
        const text = msg.content.map((c) => c.text).join('\n')
        result.push({
          role: 'tool',
          content: text || '(empty result)',
          tool_call_id: msg.toolCallId,
        })
        continue
      }
    }

    return result
  }

  private convertTools(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        strict: false,
      },
    }))
  }

  private hasToolHistory(messages: Message[]): boolean {
    return messages.some(
      (m) =>
        m.role === 'toolResult' ||
        (m.role === 'assistant' && m.content.some((b) => b.type === 'toolCall'))
    )
  }

  private *finishBlock(
    block: AssistantContentBlock & { partialArgs?: string },
    output: AssistantMessage
  ): Generator<StreamEvent> {
    if (block.type === 'text') {
      output.content.push({ type: 'text', text: (block as TextContent).text })
      yield { type: 'text_end', text: (block as TextContent).text }
    } else if (block.type === 'thinking') {
      output.content.push({ type: 'thinking', thinking: (block as ThinkingContent).thinking })
      yield { type: 'thinking_end', thinking: (block as ThinkingContent).thinking }
    } else if (block.type === 'toolCall') {
      // Parse accumulated partial args
      const tc = block as ToolCallContent & { partialArgs?: string }
      if (tc.partialArgs) {
        tc.arguments = this.parseJsonSafe(tc.partialArgs)
      }
      delete tc.partialArgs
      const clean: ToolCallContent = {
        type: 'toolCall',
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      }
      output.content.push(clean)
      yield { type: 'tool_call_end', toolCall: clean }
    }
  }

  private mapStopReason(reason: string): StopReason {
    switch (reason) {
      case 'stop':
      case 'end':
        return 'stop'
      case 'length':
        return 'length'
      case 'function_call':
      case 'tool_calls':
        return 'toolUse'
      case 'content_filter':
      case 'network_error':
        return 'error'
      default:
        return 'error'
    }
  }

  private parseUsage(usage: ChunkUsage): Usage {
    const promptTokens = usage.prompt_tokens || 0
    const completionTokens = usage.completion_tokens || 0
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0

    const reportedCached = usage.prompt_tokens_details?.cached_tokens || 0
    const cacheWrite = usage.prompt_tokens_details?.cache_write_tokens || 0
    // Correction: some providers count cacheWrite in cachedTokens
    const cacheRead = cacheWrite > 0 ? Math.max(0, reportedCached - cacheWrite) : reportedCached
    const input = Math.max(0, promptTokens - cacheRead - cacheWrite)
    const output = completionTokens + reasoningTokens

    return {
      input,
      output,
      cacheRead,
      cacheWrite,
      totalTokens: input + output + cacheRead + cacheWrite,
    }
  }

  private sanitizeToolCallId(id: string): string {
    // Some providers generate very long IDs with special chars (e.g. pipe-separated)
    let clean = id.includes('|') ? id.split('|')[0] : id
    clean = clean.replace(/[^a-zA-Z0-9_-]/g, '')
    return clean.slice(0, OpenAIClient.MAX_TOOL_CALL_ID_LENGTH)
  }

  private parseJsonSafe(raw: string): Record<string, unknown> {
    if (!raw || !raw.trim()) return {}
    try {
      return JSON.parse(raw)
    } catch {
      // Try to fix common partial JSON issues
      try {
        let fixed = raw
        const opens = (fixed.match(/\{/g) || []).length
        const closes = (fixed.match(/\}/g) || []).length
        for (let i = 0; i < opens - closes; i++) fixed += '}'
        return JSON.parse(fixed)
      } catch {
        console.warn('[Abele] Failed to parse tool arguments:', raw.slice(0, 200))
        return {}
      }
    }
  }

  private makeErrorMessage(model: ModelConfig, error: string): AssistantMessage {
    return {
      role: 'assistant',
      content: [],
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'error',
      errorMessage: error,
      timestamp: Date.now(),
    }
  }

  /**
   * Parse Server-Sent Events from a ReadableStream.
   * Handles `data: [DONE]`, multi-line data fields, and partial chunks.
   */
  private async *parseSSE(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let dataLines: string[] = []

    try {
      while (true) {
        if (signal?.aborted) break

        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete lines
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete last line in buffer

        for (const line of lines) {
          const stripped = line.replace(/\r$/, '')

          // Empty line = end of event, dispatch accumulated data
          if (!stripped) {
            if (dataLines.length > 0) {
              const jsonStr = dataLines.join('\n')
              dataLines = []
              try {
                yield JSON.parse(jsonStr) as StreamChunk
              } catch {
                // Skip malformed JSON chunks
              }
            }
            continue
          }

          if (stripped.startsWith(':')) continue // SSE comment

          if (stripped === 'data: [DONE]') return

          if (stripped.startsWith('data: ')) {
            dataLines.push(stripped.slice(6))
          } else if (stripped.startsWith('data:')) {
            dataLines.push(stripped.slice(5))
          }
        }
      }

      // Flush remaining data lines (stream ended without trailing empty line)
      if (dataLines.length > 0) {
        const jsonStr = dataLines.join('\n')
        try {
          yield JSON.parse(jsonStr) as StreamChunk
        } catch {
          // Skip malformed JSON chunks
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}
