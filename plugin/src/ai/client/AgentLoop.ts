import { OpenAIClient } from './OpenAIClient'
import type {
  AgentEvent,
  AgentTool,
  AgentToolResult,
  AssistantMessage,
  Message,
  ModelConfig,
  StreamOptions,
  TextContent,
  ToolCallContent,
  ToolResultMessage,
  UserMessage,
} from './types'

export interface AgentLoopOptions {
  model: ModelConfig
  systemPrompt: string
  tools: AgentTool[]
  messages: Message[]
  streamOptions?: StreamOptions
  /** Called before tool execution. Return { block: true, reason } to prevent. */
  beforeToolCall?: (
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>
  ) => Promise<{ block: boolean; reason?: string; modifiedArgs?: Record<string, unknown> } | void>
}

type Listener = (event: AgentEvent) => void

/**
 * Agent loop: prompt → LLM stream → tool execution → repeat until done.
 */
export class AgentLoop {
  private client = new OpenAIClient()
  private listeners: Listener[] = []
  private abortController: AbortController | null = null
  private _isRunning = false

  get isRunning() {
    return this._isRunning
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  private emit(event: AgentEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('AgentLoop listener error:', err)
      }
    }
  }

  abort() {
    this.abortController?.abort()
    this._isRunning = false
  }

  /**
   * Run the agent loop: send user message, stream response, execute tools, repeat.
   * Returns the final list of messages (including all new ones from this run).
   */
  async run(opts: AgentLoopOptions): Promise<Message[]> {
    this._isRunning = true
    this.abortController = new AbortController()
    const signal = this.abortController.signal
    const messages = [...opts.messages]

    this.emit({ type: 'agent_start' })

    try {
      // Agent loop: keep going while model requests tool calls
      let maxTurns = 50 // Safety limit
      while (maxTurns-- > 0) {
        if (signal.aborted) break

        // Stream LLM response
        const assistantMsg = await this.streamTurn(
          opts.model,
          opts.systemPrompt,
          messages,
          opts.tools,
          { ...opts.streamOptions, signal }
        )

        messages.push(assistantMsg)
        this.emit({ type: 'message_end', message: assistantMsg })

        // Stop conditions
        if (assistantMsg.stopReason === 'error' || assistantMsg.stopReason === 'aborted') break
        if (assistantMsg.stopReason === 'length') break

        // Check for tool calls
        const toolCalls = assistantMsg.content.filter(
          (b): b is ToolCallContent => b.type === 'toolCall'
        )
        if (toolCalls.length === 0) break

        // Execute tools sequentially
        for (const tc of toolCalls) {
          if (signal.aborted) break

          const tool = opts.tools.find((t) => t.name === tc.name)
          const resultMsg = await this.executeTool(tool, tc, opts.beforeToolCall, signal)
          messages.push(resultMsg)
          this.emit({ type: 'message_end', message: resultMsg })
        }
      }
    } finally {
      this._isRunning = false
      this.abortController = null
      this.emit({ type: 'agent_end' })
    }

    return messages
  }

  /**
   * Stream a single LLM turn and return the assembled AssistantMessage.
   */
  private async streamTurn(
    model: ModelConfig,
    systemPrompt: string,
    messages: Message[],
    tools: AgentTool[],
    options: StreamOptions
  ): Promise<AssistantMessage> {
    const toolDefs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))

    let result: AssistantMessage | null = null

    this.emit({
      type: 'message_start',
      message: {
        role: 'assistant',
        content: [],
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    })

    for await (const event of this.client.stream(
      model,
      systemPrompt,
      messages,
      toolDefs,
      options
    )) {
      this.emit({ type: 'stream_event', event })

      if (event.type === 'done') {
        result = event.message
      } else if (event.type === 'error') {
        result = event.message || {
          role: 'assistant',
          content: [],
          model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: 'error',
          errorMessage: event.error,
          timestamp: Date.now(),
        }
      }
    }

    if (!result) {
      result = {
        role: 'assistant',
        content: [],
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: 'error',
        errorMessage: 'No response received',
        timestamp: Date.now(),
      }
    }

    return result
  }

  /**
   * Execute a single tool call with beforeToolCall hook support.
   */
  private async executeTool(
    tool: AgentTool | undefined,
    tc: ToolCallContent,
    beforeToolCall: AgentLoopOptions['beforeToolCall'],
    signal: AbortSignal
  ): Promise<ToolResultMessage> {
    const makeResult = (content: string, isError: boolean): ToolResultMessage => ({
      role: 'toolResult',
      toolCallId: tc.id,
      toolName: tc.name,
      content: [{ type: 'text', text: content }],
      isError,
      timestamp: Date.now(),
    })

    // Tool not found
    if (!tool) {
      const result = makeResult(`Tool "${tc.name}" not found`, true)
      this.emit({
        type: 'tool_end',
        toolCallId: tc.id,
        toolName: tc.name,
        result: { content: result.content },
        isError: true,
      })
      return result
    }

    let args = tc.arguments

    // beforeToolCall hook
    if (beforeToolCall) {
      try {
        const hookResult = await beforeToolCall(tc.name, tc.id, args)
        if (hookResult && hookResult.block) {
          const result = makeResult(hookResult.reason || 'User rejected this action', true)
          this.emit({
            type: 'tool_end',
            toolCallId: tc.id,
            toolName: tc.name,
            result: { content: result.content },
            isError: true,
          })
          return result
        }
        if (hookResult && hookResult.modifiedArgs) {
          args = hookResult.modifiedArgs
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        const result = makeResult(`Hook error: ${msg}`, true)
        this.emit({
          type: 'tool_end',
          toolCallId: tc.id,
          toolName: tc.name,
          result: { content: result.content },
          isError: true,
        })
        return result
      }
    }

    // Execute
    this.emit({ type: 'tool_start', toolCallId: tc.id, toolName: tc.name, args })

    let toolResult: AgentToolResult
    let isError = false

    try {
      toolResult = await tool.execute(tc.id, args, signal)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toolResult = { content: [{ type: 'text', text: msg }] }
      isError = true
    }

    this.emit({
      type: 'tool_end',
      toolCallId: tc.id,
      toolName: tc.name,
      result: toolResult,
      isError,
    })

    return {
      role: 'toolResult',
      toolCallId: tc.id,
      toolName: tc.name,
      content: toolResult.content,
      isError,
      timestamp: Date.now(),
    }
  }
}
