import { computed, ref, toRefs, type Ref, type WritableComputedRef } from 'vue'
import { nanoid } from 'nanoid'
import { OpenAIClient } from './client/OpenAIClient'
import type { Message } from './client'
import { AgentRegistry } from './agents/AgentRegistry'
import type { InterceptorChecks, InterceptorEntry } from './agents/types'
import {
  chainFor,
  copyEntries,
  legacyFields,
  withLegacyPatch,
  type ChainSide,
  type LegacyInterceptorFields,
} from './interceptor/entries'
import type { ChatMessage, InterceptorChatMessage } from './types'
import { matchesPattern } from './interceptor/pattern'
import {
  runAnswerScript,
  runInterceptorScript,
  type AnswerOutcome,
  type InterceptOutcome,
} from './interceptor/runScript'
import type { InterceptInput } from './interceptor/context'

/**
 * What looks at a message before or alongside the chat's agent: a reviewing agent, or a script that
 * decides about it. Which messages it is shown is narrowed by `pattern`. This is the single
 * interceptor's shape, which the list's first entry still answers to; see `interceptor/entries.ts`.
 */
export interface InterceptorChoice {
  /** The reviewing agent. Empty means none. */
  agentId: string
  /** 0 sends only the draft, -1 the whole visible history, N the last N messages. */
  contextDepth: number
  /** Review without holding the message. Absent on older choices means hold. */
  replyOnly?: boolean
  /** What it checks; absent on older choices means the person's messages only. */
  checks?: InterceptorChecks
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
  | { kind: 'agent'; replyOnly?: boolean; broken?: string; entry?: InterceptorEntry }
  | {
      kind: 'script'
      script: string
      replyOnly?: boolean
      broken?: string
      entry?: InterceptorEntry
    }

export interface ReviewProgress {
  streaming: boolean
  streamingContent: string
  error: string | null
}

type ReviewRefs = { [K in keyof ReviewProgress]: Ref<ReviewProgress[K]> }

/** The slice of a chat the interceptor touches. */
export interface InterceptorHost {
  /** Advances before reset/load starts saving the outgoing conversation. */
  conversationVersion: Readonly<Ref<number>>
  messages: Ref<ChatMessage[]>
  findMessage(id: string): ChatMessage | undefined
  updateVisibleMessages(): void
  save(): Promise<void>
  /**
   * What the chat's agent says about review, read on every access so that switching the agent
   * or editing it reaches the chat. Absent, or answering none, means no default.
   */
  defaultInterceptors?(): InterceptorEntry[]
}

/**
 * The interceptors of one chat, and what each of them does to one message or answer.
 *
 * A reviewer is an ordinary agent — it gets its model and its composed system prompt from
 * `AgentRegistry` like any other. Which ones read, in which order and how much each sees, comes
 * from the chat's agent (`interceptors` on it) unless this chat chose its own list: the same
 * sparse rule as every other per-chat override, kept here rather than in `SessionOverrides`
 * because switching the chat's agent drops those and must not drop this one.
 *
 * Running several in a row is the chat's (`ChatSession`): this does one entry at a time. A
 * reviewer's reply is one bare completion streamed from here; it never runs as a chat, so the
 * reviewing agent's own interceptors are never consulted.
 */
export class ChatInterceptor {
  /**
   * What this chat deliberately chose. Null follows the agent; an empty list is an explicit Off,
   * which is a choice too and must survive the agent gaining a reviewer later.
   */
  public readonly override = ref<InterceptorEntry[] | null>(null)

  /** What the chat's agent would use, whether or not the chat currently follows it. */
  public readonly agentDefault = computed<InterceptorEntry[]>(
    () => this.host.defaultInterceptors?.() ?? []
  )

  /** The list in force. */
  public readonly entries = computed<InterceptorEntry[]>(
    () => this.override.value ?? this.agentDefault.value
  )

  /** The single interceptor of before lists: the list's first switched-on entry. */
  public readonly choice = computed<InterceptorChoice>(() => {
    const f = legacyFields(this.entries.value)
    return {
      agentId: f.interceptorAgentId,
      contextDepth: f.interceptorContextDepth,
      replyOnly: f.interceptorReplyOnly,
      checks: f.interceptorChecks,
      script: f.interceptorScript,
      pattern: f.interceptorPattern,
    }
  })

  /** Records this chat's own list. */
  setEntries(entries: InterceptorEntry[]): void {
    this.override.value = copyEntries(entries)
  }

  /** Records `patch` over the first entry of the list in force as this chat's own list. */
  private choose(patch: LegacyInterceptorFields): void {
    this.override.value = withLegacyPatch(copyEntries(this.entries.value), patch)
  }

  /**
   * The first entry's reviewing agent. Empty means no review; the message goes straight to the
   * main agent. Assigning records an override, which is what every caller that assigns — the
   * chat settings picker — means. Choosing an agent drops a script.
   */
  public readonly agentId: WritableComputedRef<string> = computed({
    get: () => (this.choice.value.script ? '' : this.choice.value.agentId),
    set: (agentId) => this.choose({ interceptorAgentId: agentId }),
  })

  /** The first entry's script by name; choosing one drops the reviewing agent. */
  public readonly script: WritableComputedRef<string> = computed({
    get: () => this.choice.value.script ?? '',
    set: (script) => this.choose({ interceptorScript: script }),
  })

  /** 0 sends only the draft, -1 the whole visible history, N the last N messages. */
  public readonly contextDepth: WritableComputedRef<number> = computed({
    get: () => this.choice.value.contextDepth,
    set: (contextDepth) => this.choose({ interceptorContextDepth: contextDepth }),
  })

  /** Only messages matching it are intercepted; empty means all. */
  public readonly pattern: WritableComputedRef<string> = computed({
    get: () => this.choice.value.pattern ?? '',
    set: (pattern) => this.choose({ interceptorPattern: pattern }),
  })

  /** Sends unchanged while the interceptor independently decides whether to reply. */
  public readonly replyOnly: WritableComputedRef<boolean> = computed({
    get: () => this.choice.value.replyOnly === true,
    set: (replyOnly) => this.choose({ interceptorReplyOnly: replyOnly }),
  })

  /** The person's messages, the agent's answers, or both. */
  public readonly checks: WritableComputedRef<InterceptorChecks> = computed({
    get: () => this.choice.value.checks ?? 'message',
    set: (checks) => this.choose({ interceptorChecks: checks }),
  })

  /** The entries that read this side and have someone there to read, in their order. */
  chain(side: ChainSide): InterceptorEntry[] {
    return chainFor(this.entries.value, side).filter((e) => this.canRead(e))
  }

  /** A script, or a reviewing agent that still exists. */
  canRead(entry: InterceptorEntry): boolean {
    return Boolean(entry.script || (entry.agentId && this.agentOf(entry)))
  }

  /** Who an entry is, as the chat names it. */
  nameOf(entry: InterceptorEntry): string {
    if (entry.script) return entry.script
    return this.agentOf(entry)?.name || 'Interceptor'
  }

  /** An entry as a route: what kind it is and whether it holds. */
  routeOf(entry: InterceptorEntry, broken?: string): Exclude<InterceptRoute, { kind: 'none' }> {
    const extra = {
      entry,
      ...(broken ? { broken } : {}),
      ...(entry.replyOnly ? { replyOnly: true } : {}),
    }
    return entry.script
      ? { kind: 'script', script: entry.script, ...extra }
      : { kind: 'agent', ...extra }
  }

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
  private lastReview: { draftId: string; entry: InterceptorEntry } | null = null

  constructor(private readonly host: InterceptorHost) {}

  /** Anyone reads anything in this chat. */
  get isActive(): boolean {
    return this.chain('message').length > 0 || this.chain('answer').length > 0
  }

  /** The first entry's name: the single interceptor of before lists. */
  get agentName(): string {
    const first = this.firstEntry()
    return first ? this.nameOf(first) : 'Interceptor'
  }

  private firstEntry(): InterceptorEntry | undefined {
    const list = this.entries.value
    return list.find((e) => e.enabled && this.canRead(e))
  }

  /**
   * Where a message goes, judged by the first interceptor that would read it. A pattern that does
   * not match passes it to the next one; one that does not compile reads it anyway and says why
   * (`broken`).
   */
  route(text: string): InterceptRoute {
    return this.firstRoute('message', text)
  }

  /** Where the agent's finished answer goes first. Reply only is about messages: answers hold. */
  answerRoute(text: string): InterceptRoute {
    const route = this.firstRoute('answer', text)
    if (route.kind === 'none') return route
    const { replyOnly: _ignored, ...held } = route
    return held
  }

  private firstRoute(side: ChainSide, text: string): InterceptRoute {
    for (const entry of this.chain(side)) {
      const { matches, broken } = matchesPattern(entry.pattern, text)
      if (matches) return this.routeOf(entry, broken)
    }
    return { kind: 'none' }
  }

  private answerController: AbortController | null = null

  /**
   * Reads the agent's finished answer and says what takes its place. A script decides by what it
   * returns; a reviewing agent's whole reply is the new text, and an empty one keeps the answer.
   * Stopped by `abort()`; the caller keeps the answer then, as on any failure.
   */
  async checkAnswer(
    route: Exclude<InterceptRoute, { kind: 'none' }>,
    answer: ChatMessage,
    input: InterceptInput | null
  ): Promise<AnswerOutcome> {
    const controller = new AbortController()
    this.answerController = controller
    try {
      if (route.kind === 'script') {
        if (!input) return { kind: 'failed', reason: 'the answer could not be read' }
        return await runAnswerScript(route.script, input, controller.signal)
      }
      const entry = route.entry ?? this.firstEntry()
      const agent = entry ? this.agentOf(entry) : null
      if (!entry || !agent) return { kind: 'failed', reason: 'the reviewing agent is gone' }
      const said = await this.complete(
        agent,
        this.buildContext(answer, entry.contextDepth),
        controller.signal
      ).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }))
      if (controller.signal.aborted) return { kind: 'stopped' }
      if ('error' in said) return { kind: 'failed', reason: said.error }
      const text = said.text.trim()
      return text && text !== answer.content.trim() ? { kind: 'replace', text } : { kind: 'keep' }
    } finally {
      if (this.answerController === controller) this.answerController = null
    }
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

  private agentOf(entry: InterceptorEntry) {
    if (entry.script || !entry.agentId) return null
    return AgentRegistry.getInstance().get(entry.agentId)
  }

  /** The first reviewing agent's entry: what a draft from before lists is reviewed by. */
  private firstAgentEntry(side: ChainSide = 'message'): InterceptorEntry | undefined {
    return this.chain(side).find((e) => !e.script)
  }

  /** The entry a held draft waits at, or the first reviewing agent for one from before lists. */
  private entryFor(draft: ChatMessage): InterceptorEntry | undefined {
    const wait = draft.interceptorWait
    const listed = wait && this.entries.value.find((e) => e.id === wait.entry)
    return listed && !listed.script ? listed : this.firstAgentEntry()
  }

  /**
   * Asks a reviewer for its opinion on a draft, appending the reply to the draft's sub-chat. True
   * when it answered; false when it failed (the reason is in `error`) or was stopped.
   */
  async review(draftMsgId: string, entry = this.firstAgentEntry()): Promise<boolean> {
    const agent = entry ? this.agentOf(entry) : null
    if (!entry || !agent) return false

    const draft = this.host.findMessage(draftMsgId)
    if (!draft) return false

    this.lastReview = { draftId: draftMsgId, entry }
    this.error.value = null

    return this.runTurn(
      draft,
      this.buildContext(draft, entry.contextDepth),
      undefined,
      undefined,
      agent
    )
  }

  /** Each message's reply-only reviews, one after another in the list's order. */
  private readonly replyTails = new Map<string, Promise<void>>()
  /** The reviewer each message's latest reply-only review was by. */
  private readonly replyEntries = new Map<string, InterceptorEntry>()

  /**
   * Starts a non-blocking review with a snapshot of the reviewer and the text as it is now. A
   * second one on the same message waits for the first, so that they answer in their order.
   */
  reviewReply(
    messageId: string,
    entry = this.replyEntries.get(messageId) ?? this.firstAgentEntry()
  ): Promise<void> {
    const message = this.host.findMessage(messageId)
    const agent = entry ? this.agentOf(entry) : null
    if (!message || !entry || !agent) return Promise.resolve()
    if (this.replyControllers.has(messageId) && !this.replyTails.has(messageId))
      return Promise.resolve()

    const messages = this.buildContext(message, entry.contextDepth)
    const controller = this.replyControllers.get(messageId) ?? new AbortController()
    this.replyControllers.set(messageId, controller)
    const name = agent.name
    const run = async () => {
      if (controller.signal.aborted) return
      // Retry asks this one again, whichever of several it was.
      this.replyEntries.set(messageId, entry)
      this.replyReviews.value[messageId] = { streaming: true, streamingContent: '', error: null }
      const progress = toRefs(this.replyReviews.value[messageId])
      const current = this.host.findMessage(messageId)
      if (!current) return
      current.interceptorName = name
      current.interceptorCollapsed = false
      current.interceptorChat ??= []
      this.host.updateVisibleMessages()
      await this.runTurn(current, messages, progress, controller, agent)
      if (!controller.signal.aborted && this.host.findMessage(messageId)) await this.host.save()
    }
    return this.queueReply(messageId, controller, run)
  }

  /** A script's side reply: never a draft, rewrite or tool policy for the main turn. */
  reviewScriptReply(
    messageId: string,
    route: Extract<InterceptRoute, { kind: 'script' }>,
    input: InterceptInput
  ): Promise<void> {
    const version = this.host.conversationVersion.value
    const message = this.host.findMessage(messageId)
    if (!message) return Promise.resolve()
    if (this.replyControllers.has(messageId) && !this.replyTails.has(messageId))
      return Promise.resolve()
    const controller = this.replyControllers.get(messageId) ?? new AbortController()
    this.replyControllers.set(messageId, controller)
    const run = async () => {
      if (controller.signal.aborted) return
      this.replyReviews.value[messageId] = { streaming: true, streamingContent: '', error: null }
      const started = this.host.findMessage(messageId)
      if (!started) return
      started.interceptorName = route.script
      started.interceptorScript = true
      started.interceptorCollapsed = false
      this.host.updateVisibleMessages()
      const outcome = await runInterceptorScript(route.script, input, controller.signal)
      // Reset/load may still be saving the old bubble and have not aborted us yet.
      // Never enqueue another old-conversation save after that transition has begun.
      if (controller.signal.aborted || version !== this.host.conversationVersion.value) return
      const current = this.host.findMessage(messageId)
      if (!current) return
      const lines = route.broken
        ? [`The pattern does not compile (${route.broken}), so every message goes to the script.`]
        : []
      switch (outcome.kind) {
        case 'reply':
          lines.push(outcome.text)
          break
        case 'hold':
          lines.push(
            'Reply only: ignored the request to hold this message. It was sent as written.'
          )
          break
        case 'send':
          if (outcome.rewriteRequested || outcome.rewritten)
            lines.push(
              'Reply only: ignored the rewrite of this message or its attachments. It was sent as written.'
            )
          if (outcome.policy)
            lines.push(
              'Reply only: ignored tool-approval answers. The main turn keeps its own permissions.'
            )
          break
        case 'failed':
          lines.push(`Not checked: ${outcome.reason}. Sent as written.`)
          break
      }
      if (lines.length) {
        current.interceptorChat = [
          ...(current.interceptorChat ?? []),
          ...lines.map((content) => ({
            id: nanoid(),
            role: 'assistant' as const,
            content,
            timestamp: Date.now(),
            by: route.script,
          })),
        ]
        this.host.updateVisibleMessages()
        await this.host.save()
      }
    }
    return this.queueReply(messageId, controller, run)
  }

  /** Runs `run` after the message's earlier reply-only reviews, and tidies up after the last. */
  private queueReply(
    messageId: string,
    controller: AbortController,
    run: () => Promise<void>
  ): Promise<void> {
    const before = this.replyTails.get(messageId) ?? Promise.resolve()
    const tail: Promise<void> = before
      .catch((): void => undefined)
      .then(run)
      .finally(() => {
        if (this.replyTails.get(messageId) !== tail) return
        this.replyTails.delete(messageId)
        if (this.replyControllers.get(messageId) === controller) {
          this.replyControllers.delete(messageId)
          const progress = this.replyReviews.value[messageId]
          if (progress) progress.streaming = false
        }
      })
    this.replyTails.set(messageId, tail)
    return tail
  }

  /** The last foreground review again, after it failed. */
  async retry(): Promise<boolean> {
    if (!this.lastReview) return false
    this.error.value = null
    const ok = await this.review(this.lastReview.draftId, this.lastReview.entry)
    await this.host.save()
    return ok
  }

  /** Replies to the reviewer inside the draft's sub-chat and asks for its next turn. */
  async sendMessage(draftMsgId: string, content: string): Promise<void> {
    if (this.streaming.value) return

    const draft = this.host.findMessage(draftMsgId)
    if (!draft?.draft) return

    const entry = this.entryFor(draft)
    const agent = entry ? this.agentOf(entry) : null
    if (!entry || !agent) return

    const userReply: InterceptorChatMessage = {
      id: nanoid(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    draft.interceptorChat = [...(draft.interceptorChat || []), userReply]
    this.host.updateVisibleMessages()

    const messages = this.buildContext(draft, entry.contextDepth)
    const name = agent.name
    // Only this reviewer's side of the conversation: the others' lines are not its past.
    for (const msg of draft.interceptorChat) {
      if (msg.role === 'assistant' && msg.by && msg.by !== name) continue
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

    await this.runTurn(draft, messages, undefined, undefined, agent)
    await this.host.save()
  }

  abort(): void {
    this.abortController?.abort()
    this.scriptController?.abort()
    this.answerController?.abort()
    for (const controller of this.replyControllers.values()) controller.abort()
    this.replyControllers.clear()
    this.replyTails.clear()
    this.replyReviews.value = {}
  }

  /**
   * One streamed reply from the reviewer, appended to the draft's sub-chat. True when it answered.
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
    agent: NonNullable<ReturnType<ChatInterceptor['agentOf']>> | null = null
  ): Promise<boolean> {
    if (!agent) return false
    const foreground = progress.streaming === this.streaming
    if (foreground) this.abortController = controller
    progress.streaming.value = true
    progress.streamingContent.value = ''
    progress.error.value = null
    try {
      const said = await this.complete(agent, messages, controller.signal, (text) => {
        progress.streamingContent.value = text
      })
      if (controller.signal.aborted) return false
      if ('error' in said) {
        progress.error.value = said.error
        return false
      }
      const response = said.text

      const current = this.host.findMessage(draft.id)
      if (!controller.signal.aborted && current && response.trim()) {
        const chatMsg: InterceptorChatMessage = {
          id: nanoid(),
          role: 'assistant',
          content: response.trim(),
          timestamp: Date.now(),
          by: agent.name,
        }
        current.interceptorChat = [...(current.interceptorChat || []), chatMsg]
        this.host.updateVisibleMessages()
      }
      return true
    } catch (err) {
      if (controller.signal.aborted) return false
      const message = err instanceof Error ? err.message : String(err)
      console.error('[Abele interceptor error]', err)
      progress.error.value = message
      return false
    } finally {
      progress.streaming.value = false
      progress.streamingContent.value = ''
      if (foreground && this.abortController === controller) this.abortController = null
    }
  }

  /**
   * One streamed reply from `agent`: its text, or why there is none. An aborted stream returns
   * whatever had arrived; the caller reads its own signal.
   */
  private async complete(
    agent: NonNullable<ReturnType<ChatInterceptor['agentOf']>>,
    messages: Message[],
    signal: AbortSignal,
    onText?: (text: string) => void
  ): Promise<{ text: string } | { error: string }> {
    const registry = AgentRegistry.getInstance()
    const model = registry.resolveModel(agent)
    if (!model) return { error: `Interceptor "${agent.name}" has no usable model configured` }

    const systemPrompt = await registry.buildSystemPrompt(agent)

    console.debug('[Abele interceptor]', {
      agent: agent.name,
      modelId: model.id,
      baseUrl: model.baseUrl,
      hasKey: !!model.apiKey,
    })

    let text = ''
    if (signal.aborted) return { text }
    const client = new OpenAIClient()
    for await (const event of client.stream(model, systemPrompt, messages, [], { signal })) {
      if (signal.aborted) return { text }
      if (event.type === 'error') {
        return { error: event.error || event.message?.errorMessage || 'Interceptor request failed' }
      }
      if (event.type === 'text_delta') {
        text += event.delta
        onText?.(text)
      }
    }
    return { text }
  }

  /**
   * What the reviewer is shown: some of the conversation so far, then the draft under review.
   *
   * Prior messages are flattened into `[role]: text` user turns rather than replayed as a real
   * conversation, so the reviewer reads them as material to judge rather than as its own past.
   */
  private buildContext(draft: ChatMessage, depth: number): Message[] {
    const msgs: Message[] = []

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
