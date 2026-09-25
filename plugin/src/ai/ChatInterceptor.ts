import { computed, ref, type Ref, type WritableComputedRef } from 'vue'
import { nanoid } from 'nanoid'
import { OpenAIClient } from './client/OpenAIClient'
import type { Message } from './client'
import { AgentRegistry } from './agents/AgentRegistry'
import type { ChatMessage, InterceptorChatMessage } from './types'

/** Which agent reviews drafts and how much of the conversation it is shown. */
export interface InterceptorChoice {
  /** Empty means no review. */
  agentId: string
  /** 0 sends only the draft, -1 the whole visible history, N the last N messages. */
  contextDepth: number
}

export const NO_INTERCEPTOR: InterceptorChoice = { agentId: '', contextDepth: 0 }

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
 * Reviews a message before it is sent to the main agent.
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

  /**
   * Empty means no review; the message goes straight to the main agent. Assigning records an
   * override, which is what every caller that assigns — the chat settings picker — means.
   */
  public readonly agentId: WritableComputedRef<string> = computed({
    get: () => this.choice.value.agentId,
    set: (agentId) => {
      this.override.value = { agentId, contextDepth: this.choice.value.contextDepth }
    },
  })

  /** 0 sends only the draft, -1 the whole visible history, N the last N messages. */
  public readonly contextDepth: WritableComputedRef<number> = computed({
    get: () => this.choice.value.contextDepth,
    set: (contextDepth) => {
      this.override.value = { agentId: this.choice.value.agentId, contextDepth }
    },
  })

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
    return Boolean(this.agentId.value && this.agent)
  }

  get agentName(): string {
    return this.agent?.name || 'Interceptor'
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

    await this.runTurn(draft, this.buildContext(draft.content))
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

    const messages = this.buildContext(draft.content)
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
  }

  /**
   * One streamed reply from the reviewer, appended to the draft's sub-chat.
   *
   * An aborted stream returns silently — the user cancelled, which is not an error to report.
   */
  private async runTurn(draft: ChatMessage, messages: Message[]): Promise<void> {
    const agent = this.agent
    if (!agent) return

    const registry = AgentRegistry.getInstance()
    const model = registry.resolveModel(agent)
    if (!model) {
      this.error.value = `Interceptor "${agent.name}" has no usable model configured`
      return
    }

    const systemPrompt = await registry.buildSystemPrompt(agent)

    console.debug('[Abele interceptor]', {
      agent: agent.name,
      modelId: model.id,
      baseUrl: model.baseUrl,
      hasKey: !!model.apiKey,
    })

    const client = new OpenAIClient()
    this.abortController = new AbortController()
    this.streaming.value = true
    this.streamingContent.value = ''

    try {
      let response = ''
      for await (const event of client.stream(model, systemPrompt, messages, [], {
        signal: this.abortController.signal,
      })) {
        if (event.type === 'text_delta') {
          response += event.delta
          this.streamingContent.value = response
        }
      }

      if (response.trim()) {
        const chatMsg: InterceptorChatMessage = {
          id: nanoid(),
          role: 'assistant',
          content: response.trim(),
          timestamp: Date.now(),
        }
        draft.interceptorChat = [...(draft.interceptorChat || []), chatMsg]
        this.host.updateVisibleMessages()
      }
    } catch (err) {
      if (this.abortController?.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      console.error('[Abele interceptor error]', err)
      this.error.value = message
    } finally {
      this.streaming.value = false
      this.streamingContent.value = ''
      this.abortController = null
    }
  }

  /**
   * What the reviewer is shown: some of the conversation so far, then the draft under review.
   *
   * Prior messages are flattened into `[role]: text` user turns rather than replayed as a real
   * conversation, so the reviewer reads them as material to judge rather than as its own past.
   */
  private buildContext(draftContent: string): Message[] {
    const msgs: Message[] = []
    const depth = this.contextDepth.value

    if (depth !== 0) {
      const visible = this.host.messages.value.filter(
        (m) => !m.draft && (m.role === 'user' || m.role === 'assistant')
      )
      const slice = depth === -1 ? visible : visible.slice(-depth)
      for (const m of slice) {
        msgs.push({ role: 'user', content: `[${m.role}]: ${m.content}`, timestamp: m.timestamp })
      }
    }

    msgs.push({ role: 'user', content: draftContent, timestamp: Date.now() })
    return msgs
  }
}
