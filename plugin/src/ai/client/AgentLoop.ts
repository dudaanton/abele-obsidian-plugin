import { OpenAIClient } from './OpenAIClient'
import { interruptedToolResult, type ToolInterruption } from './toolInterruption'
import { mobileBackground } from '../mobileBackground'
import { appSuspension } from '../appSuspension'
import { SuspendedRequest } from '../suspendedRequest'
import type {
  AgentEvent,
  AgentTool,
  AgentToolResult,
  AssistantMessage,
  Message,
  ModelConfig,
  StreamOptions,
  ToolCallContent,
  ToolResultMessage,
} from './types'

export interface AgentLoopResult {
  messages: Message[]
  /** If the loop paused for tool approval, these are the remaining tool calls (including the paused one). */
  pausedAt?: ToolCallContent[]
}

export interface AgentLoopOptions {
  model: ModelConfig
  systemPrompt: string
  tools: AgentTool[]
  /** Re-resolved for each request and call when a conversation reveals optional groups. */
  getTools?: () => AgentTool[]
  /** Why a called tool is missing, when the conversation can say more than "not found". */
  missingTool?: (name: string) => string | undefined
  /** A tool answered by name although it is not offered: an old name an agent may still call. */
  hiddenTool?: (name: string) => AgentTool | undefined
  messages: Message[]
  streamOptions?: StreamOptions
  /** Publish accumulated history after each completed message, not only a whole tool batch. */
  onHistory?: (messages: Message[]) => void
  /** Called before tool execution. Return { block, pause, modifiedArgs } to control. */
  beforeToolCall?: (
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>,
    permissionKey?: string,
    destinationKey?: string
  ) => Promise<{
    block?: boolean
    pause?: boolean
    reason?: string
    modifiedArgs?: Record<string, unknown>
  } | void>
  /**
   * Called before every request to the model, including the first.
   *
   * Whatever it returns is added to the conversation the model is about to see. This is how a
   * message typed while the loop was already running reaches the model at the next iteration
   * instead of waiting for the whole turn to finish.
   */
  beforeIteration?: () => Promise<Message[]> | Message[]
  /** Projects the next request at a safe boundary, after the complete tool batch and injections.
   * The returned context may be compacted; the result still holds the full accumulated history. */
  prepareMessages?: (messages: Message[]) => Promise<Message[]>
}

type Listener = (event: AgentEvent) => void

/**
 * Agent loop: prompt → LLM stream → tool execution → repeat until done.
 */
export class AgentLoop {
  private static readonly MAX_TURNS = 100

  private client = new OpenAIClient()
  private listeners: Listener[] = []
  private abortController: AbortController | null = null
  private _isRunning = false
  private _pausedToolCalls: ToolCallContent[] | null = null

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
  }

  private publishHistory(opts: AgentLoopOptions, messages: Message[]): void {
    try {
      opts.onHistory?.(messages)
    } catch (error) {
      // A consumer failure cannot discard completed work or prevent runtime cleanup.
      console.error('AgentLoop history checkpoint error:', error)
    }
  }

  /**
   * Run the agent loop: send user message, stream response, execute tools, repeat.
   * Returns the final list of messages. If the loop paused for approval, `pausedAt` contains remaining tool calls.
   */
  async run(opts: AgentLoopOptions): Promise<AgentLoopResult> {
    if (this._isRunning) {
      throw new Error('AgentLoop.run() called while already running')
    }
    this._isRunning = true
    const endBackgroundTurn = mobileBackground.beginTurn()
    this._pausedToolCalls = null
    this.abortController = new AbortController()
    const signal = this.abortController.signal
    const messages = [...opts.messages]
    const injected: Message[] = []

    // Forward external abort signal to internal controller
    const externalSignal = opts.streamOptions?.signal
    const onExternalAbort = () => this.abortController?.abort()
    if (externalSignal) {
      if (externalSignal.aborted) {
        this.abortController.abort()
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true })
      }
    }

    this.emit({ type: 'agent_start' })

    try {
      let maxTurns = AgentLoop.MAX_TURNS
      while (maxTurns-- > 0) {
        if (signal.aborted) break

        if (opts.beforeIteration) {
          const injected = await opts.beforeIteration()
          if (injected.length) messages.push(...injected)
        }

        const context = opts.prepareMessages ? await opts.prepareMessages(messages) : messages
        if (signal.aborted) break
        // Stream LLM response
        const requestTools = opts.getTools?.() ?? opts.tools
        const assistantMsg = await this.streamTurn(
          opts.model,
          opts.systemPrompt,
          context,
          requestTools,
          { ...opts.streamOptions, signal }
        )

        /*
         * A failed turn is announced but not kept.
         *
         * The provider produced no answer, so leaving its empty shell in the conversation
         * makes the next request carry an assistant turn with nothing in it — and "retry",
         * which sends the conversation again, then sends something different from what
         * failed. Providers refuse that: an empty assistant turn, or two in a row.
         *
         * Aborting is different. The reader stopped it, and whatever had been said by then
         * is real, so it stays.
         */
        if (assistantMsg.stopReason !== 'error') messages.push(assistantMsg)
        this.emit({ type: 'message_end', message: assistantMsg })
        this.publishHistory(opts, messages)

        // Stop conditions
        if (assistantMsg.stopReason === 'error' || assistantMsg.stopReason === 'aborted') break
        if (assistantMsg.stopReason === 'length') break

        // Check for tool calls
        const toolCalls = assistantMsg.content.filter(
          (b): b is ToolCallContent => b.type === 'toolCall'
        )
        if (toolCalls.length === 0) break
        for (const tc of toolCalls) {
          // Bind the entire response before executing or pausing any call, including its tail.
          tc.permissionKey =
            requestTools.find((tool) => tool.name === tc.name)?.permissionKey ??
            (tc.name.startsWith('mcp_') ? `unresolved:${tc.name}` : undefined)
          tc.destinationKey = requestTools.find((tool) => tool.name === tc.name)?.destinationKey
        }

        // Execute sequentially; injected user messages follow the whole call/result batch.
        for (let ti = 0; ti < toolCalls.length; ti++) {
          if (signal.aborted) break

          const tc = toolCalls[ti]
          const tool =
            (opts.getTools?.() ?? opts.tools).find((t) => t.name === tc.name) ??
            opts.hiddenTool?.(tc.name)
          const resultMsg = await this.executeTool(
            tool,
            tc,
            opts.beforeToolCall,
            signal,
            opts.getTools,
            opts.missingTool
          )

          if (!resultMsg) {
            // beforeToolCall requested pause — store remaining tool calls
            this._pausedToolCalls = toolCalls.slice(ti)
            break
          }

          messages.push(resultMsg)
          this.emit({ type: 'message_end', message: resultMsg })
          this.publishHistory(opts, messages)

          // Inject extra messages (e.g. image content from read_image tool)
          if (resultMsg.injectMessages?.length) {
            injected.push(...resultMsg.injectMessages)
          }
        }

        messages.push(...injected.splice(0))

        // If paused, exit the main loop
        if (this._pausedToolCalls) break
      }

      if (maxTurns <= 0) {
        this.emit({
          type: 'stream_event',
          event: {
            type: 'error',
            error: `Agent stopped: reached ${AgentLoop.MAX_TURNS} turn limit`,
          },
        })
      }
    } catch (err) {
      // Return the accumulated history even if preparation or an iteration hook fails.
      // The caller commits it only once run resolves; rejecting here loses completed writes.
      if (!signal.aborted) {
        this.emit({
          type: 'stream_event',
          event: { type: 'error', error: err instanceof Error ? err.message : String(err) },
        })
      }
    } finally {
      if (signal.aborted) {
        // Settle every outstanding request, including the unexecuted tail of a batch and
        // calls in an aborted stream. Pairing is history only: never execute or undo here.
        const pending = new Map<string, ToolCallContent>()
        for (const message of messages.slice(opts.messages.length)) {
          if (message.role === 'assistant')
            for (const block of message.content)
              if (block.type === 'toolCall') pending.set(block.id, block)
          if (message.role === 'toolResult') pending.delete(message.toolCallId)
        }
        for (const call of pending.values()) {
          const result = this.interruptTool(call, 'not-run')
          messages.push(result)
          this.emit({ type: 'message_end', message: result })
        }
        this._pausedToolCalls = null
      }
      messages.push(...injected)
      this.publishHistory(opts, messages)
      externalSignal?.removeEventListener('abort', onExternalAbort)
      this._isRunning = false
      this.abortController = null
      this.emit({ type: 'agent_end' })
      endBackgroundTurn()
    }

    return { messages, pausedAt: this._pausedToolCalls || undefined }
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

    const empty = (error?: string): AssistantMessage => ({
      role: 'assistant',
      content: [],
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: error ? 'error' : 'stop',
      ...(error ? { errorMessage: error } : {}),
      timestamp: Date.now(),
    })

    let resumedWhileHidden = false
    try {
      for (;;) {
        const request = new SuspendedRequest(options.signal)
        let result: AssistantMessage | null = null
        const partial = empty()
        let block: AssistantMessage['content'][number] | undefined
        const partialArguments = new Map<string, string>()
        this.emit({ type: 'message_start', message: empty() })
        try {
          for await (const event of this.client.stream(model, systemPrompt, messages, toolDefs, {
            ...options,
            signal: request.controller.signal,
          })) {
            if (event.type === 'done') result = event.message
            else if (event.type === 'error') result = event.message ?? empty(event.error)
            else {
              request.progress()
              // Some transports throw on abort rather than returning their assembled turn.
              // Keep what was actually streamed even in that case.
              if (event.type === 'text_delta' || event.type === 'thinking_delta') {
                const type = event.type === 'text_delta' ? 'text' : 'thinking'
                if (block?.type !== type) {
                  block = type === 'text' ? { type, text: '' } : { type, thinking: '' }
                  partial.content.push(block)
                }
                if (block.type === 'text') block.text += event.delta
                if (block.type === 'thinking') block.thinking += event.delta
              } else if (event.type === 'tool_call_start') {
                block = {
                  type: 'toolCall',
                  id: event.toolCallId,
                  name: event.toolName,
                  arguments: {},
                }
                partial.content.push(block)
                partialArguments.set(event.toolCallId, '')
              } else if (event.type === 'tool_call_delta') {
                const call = event.toolCallId
                  ? partial.content.find(
                      (item) => item.type === 'toolCall' && item.id === event.toolCallId
                    )
                  : block
                if (call?.type !== 'toolCall') continue
                const raw = (partialArguments.get(call.id) ?? '') + event.delta
                partialArguments.set(call.id, raw)
                try {
                  const args: unknown = JSON.parse(raw)
                  if (args && typeof args === 'object' && !Array.isArray(args))
                    call.arguments = args as Record<string, unknown>
                } catch {
                  /* Unfinished arguments stay unexecuted, never repaired into an operation. */
                }
              } else if (event.type === 'tool_call_end') {
                const index = partial.content.findIndex(
                  (b) => b.type === 'toolCall' && b.id === event.toolCall.id
                )
                if (index < 0) partial.content.push(event.toolCall)
                else partial.content[index] = event.toolCall
                block = undefined
              }
              this.emit({ type: 'reconnecting', state: null })
              this.emit({ type: 'stream_event', event })
            }
          }
        } catch (error) {
          result = empty(error instanceof Error ? error.message : 'Model connection failed')
        } finally {
          request.dispose()
        }
        result ??= empty('No response received')
        if (options.signal?.aborted) {
          result = {
            ...result,
            content: result.content.length ? result.content : partial.content,
            stopReason: 'aborted',
            errorMessage: undefined,
          }
        }

        if (
          request.shouldResume(result.stopReason, result.errorMessage) &&
          !(resumedWhileHidden && appSuspension.hidden && mobileBackground.active)
        ) {
          console.debug('[Abele model] reconnect: unfinished background request', {
            reason: result.stopReason,
            hidden: appSuspension.hidden,
          })
          this.emit({
            type: 'reconnecting',
            state: appSuspension.hidden ? 'waiting' : 'connecting',
          })
          if (await appSuspension.waitForReturn(options.signal)) {
            // A real background failure may recover without foreground when audio keeps
            // us alive. Bound this recovery too: a broken network must not spin requests.
            resumedWhileHidden = appSuspension.hidden && mobileBackground.active
            this.emit({ type: 'reconnecting', state: 'connecting' })
            // Only this unfinished response is requested again. The history includes all
            // completed tool calls/results; no tool from the abandoned stream was executed.
            continue
          }
          // Stop retains the streamed turn but never retries or executes its calls.
          if (options.signal?.aborted) return { ...partial, stopReason: 'aborted' }
          return { ...empty(), stopReason: 'error' }
        }
        this.emit({
          type: 'stream_event',
          event:
            result.stopReason === 'error'
              ? {
                  type: 'error',
                  error: result.errorMessage ?? 'Model connection failed',
                  message: result,
                }
              : { type: 'done', message: result },
        })
        return result
      }
    } finally {
      this.emit({ type: 'reconnecting', state: null })
    }
  }

  private interruptTool(call: ToolCallContent, interruption: ToolInterruption): ToolResultMessage {
    console.debug('[Abele AI] tool stopped', { toolCallId: call.id, interruption })
    this.emit({ type: 'tool_interrupted', call, interruption })
    return interruptedToolResult(call, interruption)
  }

  /**
   * Execute a single tool call with beforeToolCall hook support.
   * Returns null if the hook requested a pause (caller should stop processing).
   */
  private async executeTool(
    tool: AgentTool | undefined,
    tc: ToolCallContent,
    beforeToolCall: AgentLoopOptions['beforeToolCall'],
    signal: AbortSignal,
    getTools?: () => AgentTool[],
    missingTool?: (name: string) => string | undefined
  ): Promise<ToolResultMessage | null> {
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
      const result = makeResult(missingTool?.(tc.name) ?? `Tool "${tc.name}" not found`, true)
      this.emit({
        type: 'tool_end',
        toolCallId: tc.id,
        toolName: tc.name,
        result: { content: result.content },
        isError: true,
      })
      return result
    }

    const identityRefusal = (): string | null => {
      if (tc.permissionKey === undefined) return null
      const current = getTools ? getTools().find((candidate) => candidate.name === tc.name) : tool
      if (!current || current.permissionKey !== tc.permissionKey)
        return 'The MCP tool changed or no longer exists. Ask for a new tool call.'
      if (current.destinationKey !== tc.destinationKey)
        return 'The MCP destination changed. Ask for a new tool call.'
      return null
    }
    const refusedBeforeApproval = identityRefusal()
    if (refusedBeforeApproval) return makeResult(refusedBeforeApproval, true)

    let args = tc.arguments

    // beforeToolCall hook
    if (beforeToolCall) {
      try {
        const hookResult =
          tc.permissionKey === undefined
            ? await beforeToolCall(tc.name, tc.id, args)
            : await beforeToolCall(tc.name, tc.id, args, tc.permissionKey, tc.destinationKey)
        if (signal.aborted) return this.interruptTool(tc, 'not-run')
        if (hookResult) {
          if (hookResult.pause) {
            return null // Signal caller to pause
          }
          if (hookResult.block) {
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
          if (hookResult.modifiedArgs) {
            args = hookResult.modifiedArgs
          }
        }
      } catch (err: unknown) {
        if (signal.aborted) return this.interruptTool(tc, 'not-run')
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

    const refusedAfterApproval = identityRefusal()
    if (refusedAfterApproval) return makeResult(refusedAfterApproval, true)

    // Approval may have yielded. Do not announce execution until admission is certain.
    if (signal.aborted) return this.interruptTool(tc, 'not-run')
    this.emit({ type: 'tool_start', toolCallId: tc.id, toolName: tc.name, args })

    let toolResult: AgentToolResult
    let isError = false
    let started = false

    try {
      // Approval can have waited for input or an interceptor. Stop during that wait must
      // not admit a request or mutation, even for a tool that cannot cancel once started.
      signal.throwIfAborted()
      started = true
      toolResult = await tool.execute(tc.id, args, signal)
    } catch (err: unknown) {
      if (signal.aborted) return this.interruptTool(tc, started ? 'interrupted' : 'not-run')
      toolResult = failedToolResult(err)
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
      injectMessages: toolResult.injectMessages,
      ...(toolResult.reads?.length ? { reads: toolResult.reads } : {}),
      ...(toolResult.stored ? { stored: toolResult.stored } : {}),
    }
  }
}

/**
 * What a tool that threw answers: its message for the model, and whatever the error carries for
 * the chat to show beside the call (a node refusal's place and way through).
 */
export function failedToolResult(err: unknown): AgentToolResult {
  const text = err instanceof Error ? err.message : String(err)
  const details = (err as { toolDetails?: unknown } | null)?.toolDetails
  return { content: [{ type: 'text', text }], ...(details ? { details } : {}) }
}
