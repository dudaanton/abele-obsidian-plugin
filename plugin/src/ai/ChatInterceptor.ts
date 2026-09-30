import { computed, ref, toRefs, type Ref, type WritableComputedRef } from 'vue'
import { nanoid } from 'nanoid'
import { OpenAIClient } from './client/OpenAIClient'
import type { Message } from './client'
import { AgentRegistry } from './agents/AgentRegistry'
import type { ChatMessage, InterceptorChatMessage } from './types'
import { matchesPattern } from './interceptor/pattern'
import { runInterceptorScript, type InterceptOutcome } from './interceptor/runScript'
import type { InterceptInput } from './interceptor/context'

/**
 * What looks at a message before or alongside the chat's agent: a reviewing agent, or a script that
 * decides about it. Which messages it is shown is narrowed by `pattern`.
 */
export interface InterceptorChoice {
  /** The reviewing agent. Empty means none. */
  agentId: string
  /** 0 sends only the draft, -1 the whole visible history, N the last N messages. */
  contextDepth: number
  /** Agent review without holding the message. Absent on older choices means hold. */
  replyOnly?: boolean
  /** The interceptor script, by its `@name`. Set, it wins over `agentId`. */
  script: string
  /** Only messages matching this regular expression are intercepted; empty means all. */
  pattern: string
}

export const NO_INTERCEPTOR: InterceptorChoice = {
  agentId: '',
  contextDepth: 0,
  replyOnly: false,
  script: '',
  pattern: '',
}

/** Where a message goes: straight on, to a reviewing agent, or through a script. */
export type InterceptRoute =
  | { kind: 'none' }
  | { kind: 'agent'; replyOnly?: boolean; broken?: string }
  | { kind: 'script'; script: string; broken?: string }

export interface ReviewProgress {
  streaming: boolean
  streamingContent: string
  error: string | null
}

type ReviewRefs = { [K in keyof ReviewProgress]: Ref<ReviewProgress[K]> }

/** The slice of a chat the interceptor touches. */
export interface InterceptorHost {
  messages: Ref<ChatMessage[]>
  findMessage(id: string): ChatMessage | undefined
  updateVisibleMessages(): void
  save(): Promise<void>
  /**
   * What the chat's agent says about review, read on every access so that switching the agent
   * or editing it reaches the chat. Absent, or answering none, means no default.
   */
  defaultInterceptor?(): InterceptorChoice
}

/**
 * Reviews a held draft or a message sent alongside an independent main-agent turn.
 *
 * The reviewer is an ordinary agent — it gets its model and its composed system prompt from
 * `AgentRegistry` like any other. Which one reviews, and how much it sees, comes from the chat's
 * agent (`interceptorAgentId` on it) unless this chat chose otherwise: the same sparse rule as
 * every other per-chat override, kept here rather than in `SessionOverrides` because switching
 * the chat's agent drops those and must not drop this one.
 *
 * Interceptors never chain. The reviewer's reply is one bare completion streamed from here; it
 * never runs as a chat, so the reviewing agent's own interceptor is never consulted.
 */
export class ChatInterceptor {
  /**
   * What this chat deliberately chose. Null follows the agent; an empty `agentId` inside is an
   * explicit Off, which is a choice too and must survive the agent gaining a reviewer later.
   */
  public readonly override = ref<InterceptorChoice | null>(null)

  /** What the chat's agent would use, whether or not the chat currently follows it. */
  public readonly agentDefault = computed<InterceptorChoice>(
    () => this.host.defaultInterceptor?.() ?? NO_INTERCEPTOR
  )

  /** The choice in force. */
  public readonly choice = computed<InterceptorChoice>(
    () => this.override.value ?? this.agentDefault.value
  )

  /** Records `patch` over the choice in force as this chat's own. */
  private choose(patch: Partial<InterceptorChoice>): void {
    this.override.value = { ...NO_INTERCEPTOR, ...this.choice.value, ...patch }
  }

  /**
   * Empty means no review; the message goes straight to the main agent. Assigning records an
   * override, which is what every caller that assigns — the chat settings picker — means.
   * Choosing an agent drops a script: one interceptor at a time.
   */
  public readonly agentId: WritableComputedRef<string> = computed({
    get: () => (this.choice.value.script ? '' : this.choice.value.agentId),
    set: (agentId) => this.choose({ agentId, ...(agentId ? { script: '' } : {}) }),
  })

  /** The interceptor script by name; choosing one drops the reviewing agent. */
  public readonly script: WritableComputedRef<string> = computed({
    get: () => this.choice.value.script ?? '',
    set: (script) => this.choose({ script, ...(script ? { agentId: '' } : {}) }),
  })

  /** 0 sends only the draft, -1 the whole visible history, N the last N messages. */
  public readonly contextDepth: WritableComputedRef<number> = computed({
    get: () => this.choice.value.contextDepth,
    set: (contextDepth) => this.choose({ contextDepth }),
  })

  /** Only messages matching it are intercepted; empty means all. */
  public readonly pattern: WritableComputedRef<string> = computed({
    get: () => this.choice.value.pattern ?? '',
    set: (pattern) => this.choose({ pattern }),
  })

  /** Only agent interceptors use this; scripts keep deciding for themselves. */
  public readonly replyOnly: WritableComputedRef<boolean> = computed({
    get: () => this.choice.value.replyOnly === true,
    set: (replyOnly) => this.choose({ replyOnly }),
  })

  /** Independent progress keyed by the message reviewed, never by the last chat bubble. */
  public readonly replyReviews = ref<Record<string, ReviewProgress>>({})
  private readonly replyControllers = new Map<string, AbortController>()

  get followsAgent(): boolean {
    return this.override.value === null
  }

  /** Drops this chat's choice, so review follows the agent again. */
  followAgent(): void {
    this.override.value = null
  }

  public readonly streaming = ref(false)
  public readonly streamingContent = ref('')
  public readonly error = ref<string | null>(null)

  private abortController: AbortController | null = null
  private lastDraftId: string | null = null

  constructor(private readonly host: InterceptorHost) {}

  get isActive(): boolean {
    return Boolean(this.script.value || (this.agentId.value && this.agent))
  }

  get agentName(): string {
    if (this.script.value) return this.script.value
    return this.agent?.name || 'Interceptor'
  }

  /**
   * Where a message goes. A pattern that does not match sends it straight to the chat's agent;
   * one that does not compile intercepts it anyway and says why (`broken`).
   */
  route(text: string): InterceptRoute {
    if (!this.isActive) return { kind: 'none' }
    const { matches, broken } = matchesPattern(this.pattern.value, text)
    if (!matches) return { kind: 'none' }
    const extra = broken ? { broken } : {}
    return this.script.value
      ? { kind: 'script', script: this.script.value, ...extra }
      : { kind: 'agent', ...(this.replyOnly.value ? { replyOnly: true } : {}), ...extra }
  }

  /** True while a script decides about a message; the chat is busy for that long. */
  public readonly working = ref(false)
  private scriptController: AbortController | null = null

  /** Runs the chosen script on a message. Stopped by `abort()`. */
  async runScript(script: string, input: InterceptInput): Promise<InterceptOutcome> {
    const controller = new AbortController()
    this.scriptController = controller
    this.working.value = true
    try {
      return await runInterceptorScript(script, input, controller.signal)
    } finally {
      if (this.scriptController === controller) {
        this.scriptController = null
        this.working.value = false
      }
    }
  }

  private get agent() {
    if (!this.agentId.value) return null
    return AgentRegistry.getInstance().get(this.agentId.value)
  }

  /** Asks the reviewer for its opinion on a draft, appending the reply to the draft's sub-chat. */
  async review(draftMsgId: string): Promise<void> {
    const agent = this.agent
    if (!agent) return

    const draft = this.host.findMessage(draftMsgId)
    if (!draft) return

    this.lastDraftId = draftMsgId
    this.error.value = null

    await this.runTurn(draft, this.buildContext(draft))
  }

  /** Starts a non-blocking review with a snapshot of the reviewer and preceding context. */
  async reviewReply(messageId: string): Promise<void> {
    const message = this.host.findMessage(messageId)
    const agent = this.agent
    if (!message || !agent || this.replyControllers.has(messageId)) return

    const messages = this.buildContext(message)
    const controller = new AbortController()
    this.replyControllers.set(messageId, controller)
    this.replyReviews.value[messageId] = { streaming: true, streamingContent: '', error: null }
    const progress = toRefs(this.replyReviews.value[messageId])
    message.interceptorName = agent.name
    message.interceptorCollapsed = false
    message.interceptorChat ??= []
    this.host.updateVisibleMessages()
    try {
      await this.runTurn(message, messages, progress, controller, agent)
      if (!controller.signal.aborted && this.host.findMessage(messageId)) await this.host.save()
    } finally {
      if (this.replyControllers.get(messageId) === controller)
        this.replyControllers.delete(messageId)
    }
  }

  async retry(): Promise<void> {
    if (!this.lastDraftId) return
    this.error.value = null
    await this.review(this.lastDraftId)
    await this.host.save()
  }

  /** Replies to the reviewer inside the draft's sub-chat and asks for its next turn. */
  async sendMessage(draftMsgId: string, content: string): Promise<void> {
    if (this.streaming.value) return

    const agent = this.agent
    if (!agent) return

    const draft = this.host.findMessage(draftMsgId)
    if (!draft?.draft) return

    const userReply: InterceptorChatMessage = {
      id: nanoid(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    draft.interceptorChat = [...(draft.interceptorChat || []), userReply]
    this.host.updateVisibleMessages()

    const messages = this.buildContext(draft)
    for (const msg of draft.interceptorChat) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content, timestamp: msg.timestamp })
      } else {
        messages.push({
          role: 'assistant',
          content: [{ type: 'text', text: msg.content }],
          model: '',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: 'stop',
          timestamp: msg.timestamp,
        })
      }
    }

    await this.runTurn(draft, messages)
    await this.host.save()
  }

  abort(): void {
    this.abortController?.abort()
    this.scriptController?.abort()
    for (const controller of this.replyControllers.values()) controller.abort()
    this.replyControllers.clear()
    this.replyReviews.value = {}
  }

  /**
   * One streamed reply from the reviewer, appended to the draft's sub-chat.
   *
   * An aborted stream returns silently — the user cancelled, which is not an error to report.
   */
  private async runTurn(
    draft: ChatMessage,
    messages: Message[],
    progress: ReviewRefs = {
      streaming: this.streaming,
      streamingContent: this.streamingContent,
      error: this.error,
    },
    controller = new AbortController(),
    agent = this.agent
  ): Promise<void> {
    if (!agent) return
    const foreground = progress.streaming === this.streaming
    if (foreground) this.abortController = controller
    progress.streaming.value = true
    progress.streamingContent.value = ''
    progress.error.value = null
    try {
      const registry = AgentRegistry.getInstance()
      const model = registry.resolveModel(agent)
      if (!model) {
        progress.error.value = `Interceptor "${agent.name}" has no usable model configured`
        return
      }

      const systemPrompt = await registry.buildSystemPrompt(agent)

      console.debug('[Abele interceptor]', {
        agent: agent.name,
        modelId: model.id,
        baseUrl: model.baseUrl,
        hasKey: !!model.apiKey,
      })

      if (controller.signal.aborted) return
      const client = new OpenAIClient()
      let response = ''
      for await (const event of client.stream(model, systemPrompt, messages, [], {
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) return
        if (event.type === 'text_delta') {
          response += event.delta
          progress.streamingContent.value = response
        }
      }

      const current = this.host.findMessage(draft.id)
      if (!controller.signal.aborted && current && response.trim()) {
        const chatMsg: InterceptorChatMessage = {
          id: nanoid(),
          role: 'assistant',
          content: response.trim(),
          timestamp: Date.now(),
        }
        current.interceptorChat = [...(current.interceptorChat || []), chatMsg]
        this.host.updateVisibleMessages()
      }
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      console.error('[Abele interceptor error]', err)
      progress.error.value = message
    } finally {
      progress.streaming.value = false
      progress.streamingContent.value = ''
      if (foreground && this.abortController === controller) this.abortController = null
    }
  }

  /**
   * What the reviewer is shown: some of the conversation so far, then the draft under review.
   *
   * Prior messages are flattened into `[role]: text` user turns rather than replayed as a real
   * conversation, so the reviewer reads them as material to judge rather than as its own past.
   */
  private buildContext(draft: ChatMessage): Message[] {
    const msgs: Message[] = []
    const depth = this.contextDepth.value

    if (depth !== 0) {
      const history = this.host.messages.value
      const at = history.findIndex((m) => m.id === draft.id)
      // Only what preceded this message, even on retry after later turns have arrived.
      const visible = (at < 0 ? [] : history.slice(0, at)).filter(
        (m) => !m.draft && (m.role === 'user' || m.role === 'assistant')
      )
      const slice = depth === -1 ? visible : visible.slice(-depth)
      for (const m of slice) {
        msgs.push({ role: 'user', content: `[${m.role}]: ${m.content}`, timestamp: m.timestamp })
      }
    }

    msgs.push({ role: 'user', content: draft.content, timestamp: draft.timestamp })
    return msgs
  }
}
