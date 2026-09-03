import {
  computed,
  effectScope,
  ref,
  shallowRef,
  watch,
  type EffectScope,
  type ShallowRef,
} from 'vue'
import { TFile } from 'obsidian'
import { nanoid } from 'nanoid'
import dayjs from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_RETRY, backoffDelay, isTransient } from './retry'
import { AgentLoop } from './client/AgentLoop'
import type {
  AgentEvent,
  AgentTool,
  AgentToolResult,
  Message,
  ModelConfig,
  TextContent,
  ThinkingContent,
  ToolCallContent,
  ToolDefinition,
} from './client'
import { ChatStorage } from './ChatStorage'
import { ChatLogWriter, type ChatSnapshot } from './ChatLog'
import { ChatSummarizer, type SummarizerHost } from './ChatSummarizer'
import { ChatInterceptor, type InterceptorHost } from './ChatInterceptor'
import { AgentRegistry } from './agents/AgentRegistry'
import type { AgentDefinition, OverrideKey, ScopeEntry, SessionOverrides } from './agents/types'
import {
  ChatMessage,
  ChatMetadata,
  CORE_TOOLS,
  EDIT_SELECTION_TOOL,
  WRITE_TOOLS,
  migrateOldPermissions,
} from './types'
import type {
  CommentAnchor,
  ToolMode,
  PermissionMode,
  AiSettings,
  SubAgentRunRef,
  QueuedMessage,
} from './types'
import type { CommentState } from '@/editor/CommentPlugin'
import type { UserContentPart } from './client'
import { createAgentTools } from './tools'
import { createEditSelectionTool } from './tools/EditSelectionTool'
import { loadSkillContent } from './tools/SkillTool'
import { ScopeResolver } from './ScopeResolver'
import { resolveAttachmentsForApi } from './attachments'
import {
  getPathToLeaf,
  findDeepestLeaf,
  findDefaultLeaf,
  getInternalMessagesForPath,
  backfillParentIds,
  backfillChatMessageIds,
} from './chatTree'

import type { ChatService } from './ChatService'

/**
 * How long changes are gathered before they are written. Short enough that a crash costs at
 * most a fraction of a turn, long enough that a burst of updates in one tick makes one write.
 */
const PERSIST_INTERVAL_MS = 300

/** Shape returned by tools that provide diff details */
interface ToolDiffDetails {
  diff?: { old: string; new: string }
}

/** The call at the head of the pending queue that the reader has just let through by hand. */
interface ApprovedCall {
  /** What they approved it with, when they edited the arguments before saying yes. */
  args?: Record<string, unknown>
}

export type SessionKind = 'chat' | 'run' | 'comment'

export interface SessionParent {
  /** The session that delegated. */
  sessionId: string
  /** The tool call that started this run, so the branch renders under it. */
  toolCallId: string
}

export interface SessionOptions {
  kind?: SessionKind
  agentId?: string
  depth?: number
  parent?: SessionParent
  /** Called instead of writing a chat file, for a run whose coordinator owns persistence. */
  onPersist?: () => void
  /** Where a comment sits. Seeds the note into scope and travels in the file's meta record. */
  anchor?: CommentAnchor
}

export class ChatSession implements SummarizerHost, InterceptorHost {
  /**
   * The session currently executing a tool or agent loop.
   * Set before tool/loop execution so DelegateTool can access session context.
   */
  private static _activeSession: ChatSession | null = null

  static getActiveSession(): ChatSession | null {
    return ChatSession._activeSession
  }

  private static readonly TITLE_GENERATION_TRIGGERS = [1]
  private static readonly FALLBACK_TITLE_LENGTH = 50

  private static readonly READ_TOOLS = ['read', 'ls', 'find', 'workspace', 'skill']
  private static readonly EDIT_TOOLS = WRITE_TOOLS
  private static readonly SCOPED_TOOLS = [
    'read',
    'edit',
    'replace',
    'write',
    'rm',
    'mv',
    'cp',
    'read_image',
    'ls',
    'find',
  ]

  public readonly id: string

  private agentLoop: AgentLoop | null = null
  private unsubscribe: (() => void) | null = null
  private streamStartTime = 0
  private allInternalMessages: Message[] = []
  /** The countdown to an automatic retry, for the chat to show; null when nothing is waiting. */
  readonly retrying = ref<{ attempt: number; of: number; secondsLeft: number } | null>(null)
  private retryTimer: number | null = null
  private retryCancel: (() => void) | null = null
  private allChatMessages: ChatMessage[] = []
  private activeLeafId: string | null = null
  private userMessageCount = 0
  public readonly chatTitle = ref('')
  private chatCreated = ''
  private backgroundAbort: AbortController | null = null
  private toolAbortController: AbortController | null = null
  private generation = 0
  private lastModelId = ''

  /** What the chat's file already holds, so a save writes only the difference. */
  private readonly log = new ChatLogWriter()
  private dirty = false
  private writing: Promise<void> | null = null
  private persistTimer: number | null = null

  // Reactive state for Vue components
  public readonly messages = ref<ChatMessage[]>([])
  public readonly allMessages = ref<ChatMessage[]>([])
  public readonly isStreaming = ref(false)
  public readonly streamingContent = ref('')
  public readonly streamingThinking = ref('')
  public readonly pendingToolCalls = ref<ToolCallContent[]>([])
  /**
   * Messages typed while the model was already working.
   *
   * Sending used to be refused outright while a turn was running, so a correction thought of
   * mid-answer had to be held by the person until the agent stopped. These wait instead, and
   * go in at the next iteration of the loop — before the next reply or tool call — rather
   * than after the whole turn.
   */
  public readonly queuedMessages = ref<QueuedMessage[]>([])
  public readonly isGeneratingTitle = ref(false)
  public readonly isCompacting = ref(false)
  public readonly isExecutingTool = ref(false)
  public readonly currentChatFile = shallowRef<TFile | null>(null)
  public readonly error = ref<string | null>(null)

  // UI preferences
  public readonly hideReasoning = ref(false)

  // Questions tool state
  public readonly pendingQuestions = ref<{
    questions: { question: string; options: string[] }[]
    currentIndex: number
    answers: string[]
    resolve: (answers: string[] | null) => void
  } | null>(null)

  /** Which agent this chat runs on. Everything not overridden is resolved from it on each read. */
  public readonly agentId = ref('')
  /** Only what somebody deliberately changed in this chat. Empty means "follow the agent". */
  public readonly overrides = ref<SessionOverrides>({})

  /** The agent in force, falling back to the default one if this chat's agent was deleted. */
  public readonly agent = computed<AgentDefinition | null>(() => {
    const registry = AgentRegistry.getInstance()
    return registry.get(this.agentId.value) ?? registry.defaultAgent()
  })

  /**
   * True while the conversation must not be touched from outside.
   *
   * A `tool_use` and its `tool_result` are one pair as far as every provider is concerned, so
   * anything inserted between them is a history the next request is rejected for — and the
   * agent binding, the scope and the kind are all read by a turn already in flight. A turn
   * running, a turn paused on an approval, a turn waiting on an answer and a compaction
   * rewriting the history are the four states that means, and everything that would edit the
   * conversation under one of them asks here first.
   */
  get isMidTurn(): boolean {
    if (this.isStreaming.value || this.isCompacting.value) return true
    return this.pendingToolCalls.value.length > 0 || this.pendingQuestions.value !== null
  }

  isPinned(messageId: string): boolean {
    return this.pinned.value.includes(messageId)
  }

  /**
   * Puts a message in the note's margin and writes the file.
   *
   * Both mutators replace the array rather than pushing into it: `pinned` is a `shallowRef`,
   * and a push into the same array changes nothing anything is watching.
   */
  async pin(messageId: string): Promise<void> {
    if (this.isPinned(messageId)) return
    this.pinned.value = [...this.pinned.value, messageId]
    await this.save()
  }

  async unpin(messageId: string): Promise<void> {
    if (!this.isPinned(messageId)) return
    this.pinned.value = this.pinned.value.filter((id) => id !== messageId)
    await this.save()
  }

  /** The comment's id, which is its file's basename. Null for anything not anchored. */
  get commentId(): string | null {
    if (!this.anchor.value) return null
    return this.currentChatFile.value?.basename ?? null
  }

  /**
   * What the marker's icon shows. Pending comes first: a turn waiting on approval is still
   * streaming as far as the loop is concerned, and "answer me" is the more useful thing to say.
   */
  public readonly commentState = computed<CommentState>(() => {
    if (this.pendingToolCalls.value.length || this.pendingQuestions.value) return 'pending'
    if (this.isStreaming.value || this.isExecutingTool.value) return 'busy'
    if (this.error.value) return 'error'
    return 'idle'
  })

  // Per-chat model selection. Writable: assigning records an override, which is what every
  // existing caller (the model picker, ChatService.switchModel) already means by assigning.
  public readonly activeProviderId = computed<string>({
    get: () => this.overrides.value.providerId ?? this.agent.value?.providerId ?? '',
    set: (value) => this.setOverride('providerId', value),
  })
  public readonly activeModelId = computed<string>({
    get: () => this.overrides.value.modelId ?? this.agent.value?.modelId ?? '',
    set: (value) => this.setOverride('modelId', value),
  })

  // Per-chat tool permissions
  public readonly permissionMode = computed<PermissionMode>({
    get: () =>
      this.overrides.value.permissionMode ?? this.agent.value?.permissionMode ?? 'confirm-all',
    set: (value) => this.setOverride('permissionMode', value),
  })
  public readonly toolModes = computed<Record<string, ToolMode>>({
    get: () => this.overrides.value.toolModes ?? this.agent.value?.toolModes ?? {},
    set: (value) => this.setOverride('toolModes', value),
  })
  public readonly customSystemPrompt = ref('')
  public readonly customSystemPromptNotePath = ref('')

  /** Draft review before a message reaches the main agent. */
  public readonly interceptor: ChatInterceptor

  // Per-session scope
  public readonly scopeResolver: ScopeResolver

  /** Title generation and compaction. Kept behind SummarizerHost, not reached into directly. */
  private readonly summarizer: ChatSummarizer

  /** Set while the resolver is being rewritten from the agent, so the watcher stays quiet. */
  private syncingScope = false
  private readonly effects: EffectScope

  /**
   * A chat a person talks to, a run some agent was handed by another, or a comment anchored
   * in a note. Not readonly: expanding a comment turns it into a chat in place, and returning
   * it turns it back.
   *
   * Reactive behind an accessor rather than a bare field, so that every `session.kind` already
   * written stays what it was while the views that switch on it follow the change. The card in
   * the margin is the one that must: it reads this to choose between a live thread and the
   * read-only summary of a conversation that has moved to the sidebar, and a plain field left
   * it showing whichever of the two it was mounted with.
   */
  private readonly kindRef: ShallowRef<SessionKind>

  get kind(): SessionKind {
    return this.kindRef.value
  }

  set kind(value: SessionKind) {
    this.kindRef.value = value
  }
  /** Where this session is anchored, for a comment and for a chat expanded from one. */
  public readonly anchor = shallowRef<CommentAnchor | null>(null)

  /**
   * The messages this comment keeps in the note's margin, oldest pin first.
   *
   * The one place a pin is recorded. The margin entry, the card and the action in the thread
   * all read this ref, so there is never a second answer to whether a message is pinned.
   */
  public readonly pinned = shallowRef<string[]>([])

  private destroyed = false

  /**
   * True once `destroy()` has run. Anything holding a session it does not own — the comment
   * service holds the ones it handed to `ChatService` — checks this before answering from it,
   * because a closed tab leaves a session that reports state nothing will ever update again.
   */
  get isDestroyed(): boolean {
    return this.destroyed
  }
  /** How many delegations deep this run sits. 0 for a chat a person opened. */
  public readonly depth: number
  /** Where a run came from, so its branch can be shown in the right place. */
  public readonly parent: SessionParent | null
  /** A run persists through its coordinator, never through ChatStorage. */
  private readonly onPersist: (() => void) | null

  constructor(
    private readonly chatService: ChatService,
    id?: string,
    options: SessionOptions = {}
  ) {
    this.id = id || nanoid()
    this.kindRef = shallowRef(options.kind ?? 'chat')
    this.depth = options.depth ?? 0
    this.parent = options.parent ?? null
    this.onPersist = options.onPersist ?? null
    this.scopeResolver = new ScopeResolver()
    this.summarizer = new ChatSummarizer(this)
    this.interceptor = new ChatInterceptor(this)
    this.agentId.value = options.agentId || AgentRegistry.getInstance().defaultAgent()?.id || ''
    this.anchor.value = options.anchor ?? null
    this.effects = effectScope(true)
    this.effects.run(() => {
      this.watchScope()
      this.watchCompaction()
      this.watchAnchoredNote()
    })
    this.syncScopeFromAgent()
  }

  // ── Agent binding ──────────────────────────────────────────────

  private setOverride<K extends OverrideKey>(key: K, value: SessionOverrides[K]): void {
    this.overrides.value = { ...this.overrides.value, [key]: value }
  }

  isOverridden(key: OverrideKey): boolean {
    return this.overrides.value[key] !== undefined
  }

  /** Drops a per-chat value so the field follows the agent again. */
  clearOverride(key: OverrideKey): void {
    if (!this.isOverridden(key)) return

    const next = { ...this.overrides.value }
    delete next[key]
    if (key === 'scope') delete next.fullVaultAccess
    this.overrides.value = next

    if (key === 'scope') this.syncScopeFromAgent()
  }

  /**
   * Points the chat at a different agent and says nothing about it.
   *
   * Overrides are dropped: they were expressed against the previous agent, and carrying, say,
   * a narrowed tool set onto an agent that never had those tools is meaningless.
   *
   * The half of `switchAgent` that leaves no trace, for a caller that may have to put the
   * binding back: the log only ever appends, so a divider written for a move that is then
   * undone can be taken out of memory but never out of the file.
   */
  bindAgent(agentId: string): void {
    if (agentId === this.agentId.value) return

    this.agentId.value = agentId
    this.overrides.value = {}
    this.syncScopeFromAgent()
  }

  /**
   * The record of a switch: a divider, the way a mid-chat model switch already leaves one —
   * the rest of the conversation was answered by something else, and that should be visible.
   *
   * Separate from the binding so that a caller whose move has to be persisted before it counts
   * can write it once the file has taken the change, and not at all if it has not.
   */
  noteAgentSwitch(agentId: string): void {
    const target = AgentRegistry.getInstance().get(agentId)
    if (!target || this.allChatMessages.length === 0) return

    this.appendChatMessage({
      id: nanoid(),
      role: 'system',
      content: `Agent: ${target.name}`,
      timestamp: Date.now(),
    })
    this.updateVisibleMessages()
    this.markDirty()
  }

  /** Points the chat at a different agent, and leaves the divider saying so. */
  switchAgent(agentId: string): void {
    if (agentId === this.agentId.value) return

    this.bindAgent(agentId)
    this.noteAgentSwitch(agentId)
  }

  /**
   * Keeps the scope resolver in step with the agent until this chat edits it.
   *
   * Scope cannot be a computed — `ScopeResolver` owns real state and resolves groups against
   * the vault — so it is mirrored instead, in both directions: agent edits flow down while the
   * chat has no scope override, and the first edit made here records one and stops the mirror.
   */
  private watchScope(): void {
    watch(
      () => this.agent.value?.scope,
      () => {
        if (!this.isOverridden('scope')) this.syncScopeFromAgent()
      },
      // Synchronous on purpose: a tool call checks scope the moment it runs, so a deferred
      // sync would leave a window where the agent says one thing and the resolver another.
      { deep: true, flush: 'sync' }
    )

    watch(
      [this.scopeResolver.entries, this.scopeResolver.fullVaultAccess],
      () => {
        if (this.syncingScope) return
        this.overrides.value = {
          ...this.overrides.value,
          scope: [...this.scopeResolver.entries.value],
          fullVaultAccess: this.scopeResolver.fullVaultAccess.value,
        }
      },
      { deep: true, flush: 'sync' }
    )
  }

  /**
   * Gives what was typed during a compaction a turn once it is over.
   *
   * Compaction is the other thing that makes a chat busy, and unlike a turn it has no loop to
   * hand a queued message to. It also runs detached from the turn that starts it, so that turn
   * has already drained the queue and finished by the time anything is typed into it — which
   * left such a message waiting for the next one sent by hand. Watching the flag rather than
   * draining where compaction is started covers the manual one too.
   */
  private watchCompaction(): void {
    // Both edges: `drainQueue` is the one that knows a chat still compacting is not ready.
    watch(this.isCompacting, () => void this.drainQueue())
  }

  /**
   * A comment whose note is renamed keeps that note in scope.
   *
   * `applyScope` is the only place the anchored file is added, so a rename that rewrote the
   * anchor would otherwise leave the resolver naming a path the vault no longer has. Watched
   * on the path rather than on the anchor: `edit_selection` replaces the anchor on every write
   * to move the quote, and rebuilding the scope for that would be waste.
   */
  private watchAnchoredNote(): void {
    // Synchronous, like `watchScope`: the resolver is read by the next tool call, and a scope
    // that is only correct after a microtask is a scope that is wrong when it is asked.
    watch(
      () => this.anchor.value?.note,
      () => this.syncScopeFromAgent(),
      { flush: 'sync' }
    )
  }

  private syncScopeFromAgent(): void {
    const entries = this.overrides.value.scope ?? this.agent.value?.scope ?? []
    const fullVault =
      this.overrides.value.fullVaultAccess ?? this.agent.value?.fullVaultAccess ?? false
    this.applyScope(entries, fullVault)
  }

  /**
   * Adds a delegating chat's scope on top of this run's own.
   *
   * Union, not replacement: the agent's scope says where it normally works, while the parent
   * holds the task and therefore the files the task is about. Either alone leaves a run unable
   * to do what it was asked.
   */
  applyScopeUnion(entries: ScopeEntry[], options: { fullVaultAccess?: boolean } = {}): void {
    const own = this.overrides.value.scope ?? this.agent.value?.scope ?? []
    const seen = new Set(own.map((e) => `${e.type}:${e.path}`))
    const merged = [...own]

    for (const entry of entries) {
      const key = `${entry.type}:${entry.path}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(entry)
    }

    const fullVault =
      Boolean(options.fullVaultAccess) ||
      (this.overrides.value.fullVaultAccess ?? this.agent.value?.fullVaultAccess ?? false)

    this.overrides.value = { ...this.overrides.value, scope: merged, fullVaultAccess: fullVault }
    this.applyScope(merged, fullVault)
  }

  /** The text the conversation ended on — what a delegated run reports back. */
  lastAssistantText(): string {
    for (let i = this.allChatMessages.length - 1; i >= 0; i--) {
      const msg = this.allChatMessages[i]
      if (msg.role === 'assistant' && msg.content.trim()) return msg.content.trim()
    }
    return ''
  }

  /** Replaces the resolver contents without the change reading as a user edit. */
  private applyScope(entries: ScopeEntry[], fullVaultAccess: boolean): void {
    this.syncingScope = true
    try {
      this.scopeResolver.clear()
      this.scopeResolver.setFullVaultAccess(fullVaultAccess)
      for (const entry of entries) {
        switch (entry.type) {
          case 'file':
            this.scopeResolver.addFile(entry.path)
            break
          case 'folder':
            this.scopeResolver.addFolder(entry.path)
            break
          case 'pattern':
            this.scopeResolver.addPattern(entry.path)
            break
          case 'group':
            this.scopeResolver.addGroup(entry.path)
            break
        }
      }

      // The note a comment is anchored to is part of what the session *is*, not something
      // anyone chose in it — so it goes on top of the agent's scope and survives a switch,
      // and it is added inside `syncingScope` so it is never recorded as an override.
      if (this.anchor.value) this.scopeResolver.addFile(this.anchor.value.note)
    } finally {
      this.syncingScope = false
    }
  }

  // ── SummarizerHost ─────────────────────────────────────────────

  messagesForModel(): Message[] {
    return this.getMessagesForModel()
  }

  toolDefs(): ToolDefinition[] {
    return this.getTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }

  hasInternalMessages(): boolean {
    return this.allInternalMessages.length > 0
  }

  /**
   * Records a compaction summary in both places it has to appear: as a divider the user sees,
   * and as an internal system marker that `getMessagesForModel` truncates the history at.
   */
  applyCompactSummary(summary: string): void {
    const divider: ChatMessage = {
      id: nanoid(),
      role: 'system',
      content: summary,
      timestamp: Date.now(),
    }
    this.appendChatMessage(divider)
    this.updateVisibleMessages()

    this.allInternalMessages.push({
      role: 'system',
      content: `${ChatSummarizer.COMPACT_MARKER}\n\n${summary}`,
      timestamp: Date.now(),
      chatMessageId: divider.id,
    })
  }

  backgroundSignal(): AbortSignal {
    return this.getBackgroundSignal()
  }

  auxiliaryModel(): ModelConfig {
    return this.chatService.getAuxiliaryModelConfig(this)
  }

  activeModel(): ModelConfig | null {
    return this.resolveModel()
  }

  /**
   * The model this chat will actually send to, with any per-chat override applied.
   *
   * Returns null when it cannot be resolved rather than substituting whatever model happens to
   * be first: a chat quietly running on the wrong model is worse than one that says it cannot
   * start.
   */
  resolveModel(options: { fallback?: boolean } = {}): ModelConfig | null {
    const agent = this.agent.value
    if (!agent) return null

    const effective: AgentDefinition = options.fallback
      ? agent
      : { ...agent, providerId: this.activeProviderId.value, modelId: this.activeModelId.value }

    return AgentRegistry.getInstance().resolveModel(effective, options)
  }

  /**
   * Sends the conversation again, unchanged, after a failed request.
   *
   * Nothing is appended: the failure produced no assistant turn, so the history the model needs
   * is exactly what it was a moment ago.
   */
  async retryRequest(): Promise<void> {
    // Pressing it during a countdown means now, not in eight seconds.
    this.cancelAutoRetry()
    if (this.isStreaming.value || this.isExecutingTool.value) return
    if (this.allInternalMessages.length === 0) return

    this.error.value = null
    await this.runAgentLoop()
    // A turn just ended: a natural point to be sure the disk has it.
    await this.save()
  }

  /** Whether a fallback model is configured, so the UI knows to offer it after a failure. */
  get hasFallbackModel(): boolean {
    return Boolean(this.resolveModel({ fallback: true }))
  }

  /** Moves this chat onto the agent's fallback model and leaves it there. */
  useFallbackModel(): boolean {
    const agent = this.agent.value
    const fallback = this.resolveModel({ fallback: true })
    if (!agent || !fallback) return false

    this.activeProviderId.value = agent.fallbackProviderId ?? ''
    this.activeModelId.value = agent.fallbackModelId ?? ''
    return true
  }

  /** Summarizes the conversation so far and continues from the summary. */
  async compact(): Promise<void> {
    return this.summarizer.compact()
  }

  getToolMode(toolName: string): ToolMode {
    return this.toolModes.value[toolName] ?? 'off'
  }

  // ── Tools with session scope ────────────────────────────────────

  private getTools(): AgentTool[] {
    const agent = this.agent.value
    const allTools = createAgentTools()

    // Overrides win over the agent's own tool modes, so a chat that narrowed its permissions
    // stays narrowed. Falls back to the agent when nothing was overridden here.
    const effective = agent
      ? { ...agent, toolModes: this.toolModes.value, maxDelegateDepth: agent.maxDelegateDepth }
      : null
    const filtered = effective
      ? AgentRegistry.getInstance().filterTools(effective, allTools)
      : allTools.filter(
          (tool) => CORE_TOOLS.has(tool.name) || this.getToolMode(tool.name) !== 'off'
        )

    // Appended after the agent's filter, not through it: `filterTools` drops any non-core
    // tool the agent has no mode for, and this one belongs to the session's kind rather than
    // to the agent. `toolModes` still governs whether it needs approval — and `off` there is
    // an answer too, or a comment agent set to never rewrite the note would be handed the one
    // tool that does.
    const offered =
      this.kind === 'comment' &&
      this.anchor.value?.quote &&
      (this.toolModes.value[EDIT_SELECTION_TOOL] ?? 'ask') !== 'off'
    const withSelection = offered ? [...filtered, createEditSelectionTool(this)] : filtered

    return this.wrapToolsForSession(withSelection)
  }

  /**
   * Wrap tools so that ScopeResolver.getInstance() returns this session's
   * scope resolver during tool execution.
   */
  private wrapToolsForSession(tools: AgentTool[]): AgentTool[] {
    return tools.map((tool) => ({
      ...tool,
      execute: async (
        id: string,
        params: Record<string, unknown>,
        signal?: AbortSignal
      ): Promise<AgentToolResult> => {
        ScopeResolver.setActiveInstance(this.scopeResolver)
        ChatSession._activeSession = this
        try {
          return await tool.execute(id, params, signal)
        } finally {
          ScopeResolver.setActiveInstance(null)
          ChatSession._activeSession = null
        }
      },
    }))
  }

  // ── Approval logic ──────────────────────────────────────────────

  /**
   * Why a run refused a tool, phrased so the agent can act on it.
   *
   * The distinction matters: out of scope is about *this* file, while a permission mode is
   * about the whole run. Told apart, an agent can retry with a different path in the first
   * case and stop asking in the second.
   */
  private refusalReason(toolName: string, args?: Record<string, unknown>): string {
    const denied = this.outOfScopePath(toolName, args)
    if (denied) {
      return `Access denied: ${denied} is not in this run's workspace scope`
    }

    if (ChatSession.EDIT_TOOLS.includes(toolName)) {
      return `Write operations are not permitted in this run (permission mode: ${this.permissionMode.value})`
    }

    return `${toolName} needs approval, which a delegated run cannot ask for`
  }

  /** The path a call reads or changes, when the session's scope does not cover it. */
  private outOfScopePath(toolName: string, args?: Record<string, unknown>): string | null {
    if (!args || !ChatSession.SCOPED_TOOLS.includes(toolName)) return null
    const path = (args.path || args.from) as string
    return path && !this.scopeResolver.isInScope(path) ? path : null
  }

  needsApproval(toolName: string, args?: Record<string, unknown>): boolean {
    const mode = this.permissionMode.value

    // Out-of-scope file access always requires approval, whatever the mode says about writes.
    if (this.outOfScopePath(toolName, args)) return true

    // Core read tools: never need approval
    if (ChatSession.READ_TOOLS.includes(toolName)) return false
    if (toolName === 'read_image' || toolName === 'questions') return false

    // The one write with a mode of its own. It touches a single passage the person pointed
    // at, so letting it run unattended is a reasonable thing to want without opening up
    // `edit` on the whole vault. Anything short of `auto` falls through to the write rule.
    if (toolName === EDIT_SELECTION_TOOL) {
      if ((this.toolModes.value[EDIT_SELECTION_TOOL] ?? 'ask') === 'auto') return false
    }

    // Core edit tools: governed by permissionMode
    if (ChatSession.EDIT_TOOLS.includes(toolName)) {
      if (mode === 'allow-edit' || mode === 'allow-all') return false
      return true
    }
    if (['rm', 'mv', 'cp'].includes(toolName)) {
      if (mode === 'allow-all') return false
      return true
    }

    // Feature tools: governed by toolModes
    return this.getToolMode(toolName) !== 'auto'
  }

  // ── Event handling ───────────────────────────��──────────────────

  private handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'stream_event': {
        const se = event.event
        if (se.type === 'text_delta') {
          if (!this.streamStartTime) this.streamStartTime = Date.now()
          this.streamingContent.value += se.delta
        } else if (se.type === 'thinking_delta') {
          this.streamingThinking.value += se.delta
        } else if (se.type === 'error') {
          this.error.value = se.error || 'Unknown streaming error'
          console.error('[Abele AI]', se.error)
        }
        break
      }

      case 'message_end': {
        const msg = event.message
        if (msg.role === 'assistant') {
          const am = msg

          if (am.errorMessage) {
            this.error.value = am.errorMessage
            console.error('[Abele AI]', am.errorMessage)
          }

          /*
           * A failed turn is an error to show, not a message to keep.
           *
           * The provider gave no answer, so appending its empty shell put a blank bubble at
           * the end of the chat — and the loop kept it in the history too, which made "retry"
           * send the conversation *plus* an empty assistant turn. Providers refuse that.
           * The loop now leaves it out of the history; this leaves it out of the chat.
           */
          if (am.stopReason === 'error') {
            this.streamingContent.value = ''
            this.streamingThinking.value = ''
            this.streamStartTime = 0
            break
          }

          const textParts = am.content.filter((c): c is TextContent => c.type === 'text')
          const thinkingParts = am.content.filter(
            (c): c is ThinkingContent => c.type === 'thinking'
          )

          const chatMsg: ChatMessage = {
            id: nanoid(),
            role: 'assistant',
            content: textParts.map((t) => t.text).join(''),
            thinking: thinkingParts.length
              ? thinkingParts.map((t) => t.thinking).join('')
              : undefined,
            usage: am.usage
              ? {
                  input: am.usage.input,
                  output: am.usage.output,
                  total: am.usage.totalTokens,
                  speed:
                    this.streamStartTime && am.usage.output
                      ? Math.round((am.usage.output / (Date.now() - this.streamStartTime)) * 1000)
                      : undefined,
                }
              : undefined,
            timestamp: Date.now(),
          }
          this.appendChatMessage(chatMsg)
          this.updateVisibleMessages()
          this.streamingContent.value = ''
          this.streamingThinking.value = ''
          this.streamStartTime = 0
        } else if (msg.role === 'toolResult') {
          if (msg.isError) {
            const chatMsg: ChatMessage = {
              id: nanoid(),
              role: 'tool-result',
              content: msg.content.map((c) => c.text).join(''),
              toolName: msg.toolName,
              toolStatus: 'rejected',
              timestamp: Date.now(),
            }
            this.appendChatMessage(chatMsg)
            this.updateVisibleMessages()
          }
        }
        break
      }

      case 'tool_start': {
        const chatMsg: ChatMessage = {
          id: nanoid(),
          role: 'tool-call',
          content: `Calling ${event.toolName}`,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          toolParams: event.args,
          toolStatus: 'pending',
          timestamp: Date.now(),
        }
        this.appendChatMessage(chatMsg)
        this.updateVisibleMessages()
        break
      }

      case 'tool_end': {
        this.updateChatMessage(
          (m) =>
            m.role === 'tool-call' &&
            m.toolCallId === event.toolCallId &&
            m.toolStatus === 'pending',
          (m) => {
            const resultText = event.result.content?.map((c) => c.text).join('') || ''
            const diff = (event.result.details as ToolDiffDetails)?.diff
            return {
              ...m,
              toolResult: resultText,
              toolDiff: diff ? { old: diff.old, new: diff.new } : undefined,
              toolStatus: event.isError ? 'rejected' : 'approved',
            }
          }
        )
        break
      }
    }
  }

  // ── Tree helpers ─────────────────────────────────────────────────

  private appendChatMessage(msg: ChatMessage): void {
    msg.parentId = this.activeLeafId || undefined
    this.allChatMessages.push(msg)
    this.activeLeafId = msg.id
  }

  updateVisibleMessages(): void {
    if (!this.activeLeafId) {
      this.messages.value = []
    } else {
      this.messages.value = getPathToLeaf(this.allChatMessages, this.activeLeafId)
    }
    this.allMessages.value = [...this.allChatMessages]
  }

  private updateChatMessage(
    predicate: (m: ChatMessage) => boolean,
    updater: (m: ChatMessage) => ChatMessage
  ): void {
    for (let i = this.allChatMessages.length - 1; i >= 0; i--) {
      if (predicate(this.allChatMessages[i])) {
        this.allChatMessages[i] = updater(this.allChatMessages[i])
        break
      }
    }
    this.updateVisibleMessages()
  }

  private linkInternalMessages(newMsgs: Message[]): void {
    const visiblePath = this.messages.value
    let lastUserIdx = -1
    for (let i = visiblePath.length - 1; i >= 0; i--) {
      if (visiblePath[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    const runChatMsgs = lastUserIdx >= 0 ? visiblePath.slice(lastUserIdx + 1) : visiblePath
    const assistantChatMsgs = runChatMsgs.filter((m) => m.role === 'assistant')

    // Match from the end: new assistant messages correspond to the last N chat messages
    const newAssistantCount = newMsgs.filter((m) => m.role === 'assistant').length
    let assistantIdx = assistantChatMsgs.length - newAssistantCount
    let lastLinkedId: string | undefined
    for (const msg of newMsgs) {
      if (msg.role === 'assistant') {
        if (assistantIdx >= 0 && assistantIdx < assistantChatMsgs.length) {
          msg.chatMessageId = assistantChatMsgs[assistantIdx].id
        }
        assistantIdx++
        if (msg.chatMessageId) lastLinkedId = msg.chatMessageId
      } else if (msg.role === 'toolResult') {
        const chatMsg = runChatMsgs.find((m) => m.toolCallId === msg.toolCallId)
        if (chatMsg) msg.chatMessageId = chatMsg.id
        if (msg.chatMessageId) lastLinkedId = msg.chatMessageId
      } else if (!msg.chatMessageId && lastLinkedId) {
        // Link injected messages (e.g. from read_image) to the preceding tool-call
        msg.chatMessageId = lastLinkedId
      }
    }
  }

  // ── Agent loop execution ──────────────────────────────────────

  private getMessagesForModel(): Message[] {
    const path = this.activeLeafId
      ? getPathToLeaf(this.allChatMessages, this.activeLeafId)
      : this.allChatMessages
    const internal = getInternalMessagesForPath(path, this.allInternalMessages)

    for (let i = internal.length - 1; i >= 0; i--) {
      const m = internal[i]
      if (m.role === 'system' && m.content.startsWith(ChatSummarizer.COMPACT_MARKER)) {
        return internal.slice(i)
      }
    }
    return internal
  }

  /**
   * A turn, tried again by itself when the failure was the sort that passes on its own.
   *
   * Off unless asked for. What it repeats is decided by `isTransient`: a rate limit or a
   * dropped connection is worth another go, a rejected key is not — that would be the same
   * refusal five times over with a growing wait between them.
   */
  private async runAgentLoop(): Promise<void> {
    const settings = { ...DEFAULT_RETRY, ...(AbeleConfig.getInstance().ai.autoRetry ?? {}) }

    for (let attempt = 0; ; attempt++) {
      await this.runAgentLoopOnce()

      const failure = this.error.value
      if (!failure || attempt >= settings.attempts || !isTransient(failure)) return
      // The reader is in charge: a pending tool call or a stopped turn is not retried behind
      // their back.
      if (this.pendingToolCalls.value.length) return

      const carryOn = await this.waitBeforeRetry(
        backoffDelay(attempt + 1, settings.firstDelayMs),
        attempt + 1,
        settings.attempts
      )
      if (!carryOn) return
    }
  }

  /** Counts down out loud, so a chat that looks stuck says what it is waiting for. */
  private waitBeforeRetry(ms: number, attempt: number, of: number): Promise<boolean> {
    return new Promise((resolve) => {
      let left = Math.ceil(ms / 1000)
      this.retrying.value = { attempt, of, secondsLeft: left }

      const finish = (carryOn: boolean) => {
        if (this.retryTimer !== null) window.clearTimeout(this.retryTimer)
        this.retryTimer = null
        this.retryCancel = null
        this.retrying.value = null
        resolve(carryOn)
      }

      const tick = () => {
        left -= 1
        if (left <= 0) return finish(true)
        this.retrying.value = { attempt, of, secondsLeft: left }
        this.retryTimer = window.setTimeout(tick, 1000)
      }

      this.retryCancel = () => finish(false)
      this.retryTimer = window.setTimeout(tick, 1000)
    })
  }

  /** Stops a countdown: the reader asked for something else, or gave up on it. */
  cancelAutoRetry(): void {
    this.retryCancel?.()
  }

  private async runAgentLoopOnce(): Promise<void> {
    this.isStreaming.value = true
    this.streamingContent.value = ''
    this.streamingThinking.value = ''
    this.error.value = null

    try {
      const model = this.resolveModel()
      if (!model) {
        this.error.value = this.agent.value
          ? `Agent "${this.agent.value.name}" has no usable model configured`
          : 'No agent is configured'
        return
      }
      const tools = this.getTools()

      // Show model indicator when model changes between messages
      if (this.lastModelId && this.lastModelId !== model.id) {
        const sysMsg: ChatMessage = {
          id: nanoid(),
          role: 'system',
          content: model.name || model.id,
          timestamp: Date.now(),
        }
        this.appendChatMessage(sysMsg)
        this.updateVisibleMessages()
      }
      this.lastModelId = model.id

      this.agentLoop = new AgentLoop()
      this.unsubscribe = this.agentLoop.subscribe((event) => this.handleAgentEvent(event))

      const toSend = this.getMessagesForModel()
      const result = await this.agentLoop.run({
        model,
        systemPrompt: await this.chatService.getSystemPrompt(this),
        tools,
        messages: toSend,
        streamOptions: model.reasoningEffort
          ? { reasoningEffort: model.reasoningEffort }
          : undefined,
        beforeIteration: () => this.takeQueued(),
        beforeToolCall: async (toolName, _id, args) => {
          if (!this.needsApproval(toolName, args)) return

          // A run has nobody to ask, so a tool that would need approval is refused with a
          // reason the agent can read and work around, rather than hanging forever.
          if (this.kind === 'run') {
            return { block: true, reason: this.refusalReason(toolName, args) }
          }
          return { pause: true }
        },
      })

      // Append only new messages to the full history
      const newMsgs = result.messages.slice(toSend.length)
      this.linkInternalMessages(newMsgs)
      this.allInternalMessages.push(...newMsgs)

      if (result.pausedAt?.length) {
        this.pendingToolCalls.value = result.pausedAt
        await this.processAllPendingToolCalls()
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const errObj = err instanceof Error ? err : new Error(String(err))
      if (errObj.name === 'AbortError') return
      this.error.value = errObj.message || 'An unknown error occurred'
      console.error('[Abele AI]', err)
    } finally {
      this.isStreaming.value = false
      this.unsubscribe?.()
      this.unsubscribe = null
      this.agentLoop = null
    }
  }

  // ── Pending tool calls processing ──────────────────────────────

  /**
   * Works down the queue of calls a paused turn left behind, stopping at the first that has
   * to be asked about.
   *
   * The chat stays marked as working for the whole run of them, and every one of them gets a
   * controller the stop button can reach. Only the call approved by hand used to be marked:
   * a model asks for several at a time, so under "allow all" everything behind the first one
   * ran with the composer showing its idle buttons — no spinner, a greyed send arrow where
   * the stop square belongs, and nothing to press to call off a script taking its time.
   *
   * `approved` is the call at the head of the queue that the reader has just allowed, with
   * the arguments they allowed it with. It runs without being asked about again, whatever
   * the mode still says; everything behind it is checked as usual.
   */
  private async processAllPendingToolCalls(approved?: ApprovedCall): Promise<void> {
    let head = approved

    try {
      while (this.pendingToolCalls.value.length > 0) {
        const tc = this.pendingToolCalls.value[0]

        if (!head && this.needsApproval(tc.name, tc.arguments)) {
          this.ensurePendingToolCallMessage(tc)
          this.markDirty()
          return // Wait for user approve/reject
        }

        this.ensurePendingToolCallMessage(tc)

        const controller = new AbortController()
        this.toolAbortController = controller
        this.isExecutingTool.value = true
        try {
          await this.executeCurrentPendingTool(head?.args, controller.signal)
        } finally {
          this.toolAbortController = null
        }
        head = undefined

        if (controller.signal.aborted) {
          this.markDirty()
          return
        }
      }
    } finally {
      // Cleared here rather than around each call: between two of them the flag would drop
      // for long enough to render, and the composer would blink back to its idle buttons.
      this.isExecutingTool.value = false
    }

    // All pending tools resolved — restart loop. `runAgentLoop` raises the streaming flag
    // before it yields, so the chat never reads as idle in between.
    await this.runAgentLoop()
  }

  private ensurePendingToolCallMessage(tc: ToolCallContent): void {
    const exists = this.allChatMessages.some((m) => m.toolCallId === tc.id)
    if (exists) return

    const chatMsg: ChatMessage = {
      id: nanoid(),
      role: 'tool-call',
      content: `Calling ${tc.name}`,
      toolCallId: tc.id,
      toolName: tc.name,
      toolParams: tc.arguments,
      toolStatus: 'pending',
      timestamp: Date.now(),
    }
    this.appendChatMessage(chatMsg)
    this.updateVisibleMessages()
  }

  private async executeCurrentPendingTool(
    modifiedArgs?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<void> {
    const tc = this.pendingToolCalls.value[0]
    if (!tc) return

    const tools = this.getTools()
    const tool = tools.find((t) => t.name === tc.name)
    const args = modifiedArgs || tc.arguments

    if (!tool) {
      const errText = `Tool "${tc.name}" not found`
      const toolChatMsg = this.allChatMessages.find(
        (m) => m.role === 'tool-call' && m.toolCallId === tc.id
      )
      this.updateChatMessage(
        (m) => m.role === 'tool-call' && m.toolCallId === tc.id,
        (m) => ({ ...m, toolResult: errText, toolStatus: 'rejected' as const })
      )
      this.allInternalMessages.push({
        role: 'toolResult',
        toolCallId: tc.id,
        toolName: tc.name,
        content: [{ type: 'text', text: errText }],
        isError: true,
        timestamp: Date.now(),
        chatMessageId: toolChatMsg?.id,
      })
      this.pendingToolCalls.value = this.pendingToolCalls.value.slice(1)
      return
    }

    // Execute
    let toolResult: AgentToolResult
    let isError = false
    try {
      toolResult = await tool.execute(tc.id, args, signal)
    } catch (err: unknown) {
      toolResult = {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
      }
      isError = true
    }

    const toolChatMsg = this.allChatMessages.find(
      (m) => m.role === 'tool-call' && m.toolCallId === tc.id
    )

    this.updateChatMessage(
      (m) => m.role === 'tool-call' && m.toolCallId === tc.id,
      (m) => {
        const resultText = toolResult.content.map((c) => c.text).join('')
        const diff = (toolResult.details as ToolDiffDetails)?.diff
        return {
          ...m,
          toolResult: resultText,
          toolDiff: diff ? { old: diff.old, new: diff.new } : undefined,
          toolStatus: isError ? ('rejected' as const) : ('approved' as const),
        }
      }
    )

    this.allInternalMessages.push({
      role: 'toolResult',
      toolCallId: tc.id,
      toolName: tc.name,
      content: toolResult.content,
      isError,
      timestamp: Date.now(),
      chatMessageId: toolChatMsg?.id,
    })

    if (toolResult.injectMessages?.length) {
      for (const injected of toolResult.injectMessages) {
        injected.chatMessageId = toolChatMsg?.id
      }
      this.allInternalMessages.push(...toolResult.injectMessages)
    }

    this.pendingToolCalls.value = this.pendingToolCalls.value.slice(1)
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Words the person put into the conversation without asking the agent anything.
   *
   * This is the first half of `sendMessage` and nothing else: the bubble appears, the message
   * joins the history the model is built from, the file is written. No loop, no title, no
   * compaction — nothing that would make a request. Whatever is asked next carries the notes
   * with it as ordinary user turns, which is the point of keeping them here rather than
   * somewhere the agent will never see them.
   *
   * `sendMessage` cannot do this with a flag: everything after the push is what it is for.
   *
   * Returns whether the note was kept, so a caller can say why it was not.
   */
  async addUserNote(content: string): Promise<boolean> {
    // Nothing may be pushed into the middle of a turn — see `isMidTurn`. `sendMessage` can
    // queue instead; a note has nothing to be queued for, since nothing is going to run.
    if (this.isMidTurn) return false

    const text = content.trim()
    if (!text) return false

    this.allInternalMessages.push(await this.userMessage(text))
    await this.save()
    return true
  }

  async sendMessage(content: string, attachments?: string[]): Promise<void> {
    // Busy is not a reason to lose what was typed: it waits its turn instead. `takeQueued`
    // hands it to the loop that is already running, at its next iteration.
    if (this.isStreaming.value || this.isCompacting.value) {
      this.queuedMessages.value = [
        ...this.queuedMessages.value,
        { id: nanoid(), content, attachments: attachments?.length ? attachments : undefined },
      ]
      return
    }

    // Draft mode: interceptor is active → create draft, don't send to main AI
    if (this.interceptor.isActive) {
      return this.sendDraftMessage(content, attachments)
    }

    const gen = this.generation
    this.error.value = null
    this.userMessageCount++

    this.allInternalMessages.push(await this.userMessage(content, attachments))

    await this.runAgentLoop()

    if (gen !== this.generation) return

    // A turn just ended: a natural point to be sure the disk has it.
    await this.save()

    const sequential = AbeleConfig.getInstance().ai.sequentialAuxiliary

    // A run is never listed anywhere, so naming it would be a request nobody reads the answer to.
    const wantsTitle =
      this.kind === 'chat' && ChatSession.TITLE_GENERATION_TRIGGERS.includes(this.userMessageCount)
    if (wantsTitle) {
      if (sequential) {
        await this.summarizer.generateTitle()
      } else {
        this.summarizer.generateTitle().catch(() => {
          return
        })
      }
    }

    if (sequential) {
      await this.summarizer.autoCompactIfNeeded()
    } else {
      this.summarizer.autoCompactIfNeeded().catch(() => {
        return
      })
    }

    await this.drainQueue()
  }

  /**
   * Starts a turn for the next queued message, when nothing is running to take it.
   *
   * Most of what is queued reaches the model through `beforeIteration`, handed to the loop
   * that is already running. What is left was typed when there was no such loop — after its
   * last iteration, or while the chat was being compacted — so it needs a turn of its own.
   * Waiting on approval is not the moment: the loop resumes once the tool is answered, and
   * takes the queue with it.
   */
  private async drainQueue(): Promise<void> {
    if (this.isStreaming.value || this.isCompacting.value) return
    if (this.pendingToolCalls.value.length) return

    const [next, ...rest] = this.queuedMessages.value
    if (!next) return

    this.queuedMessages.value = rest
    await this.sendMessage(next.content, next.attachments)
  }

  /**
   * Put a message from the person into the conversation.
   *
   * The chat bubble is appended here; the message the model will be shown is returned rather
   * than stored, because where it belongs depends on whether a loop is already running — a
   * fresh turn pushes it into the history, an injected one lets the loop carry it.
   */
  private async userMessage(content: string, attachments?: string[]): Promise<Message> {
    const userMsg: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content,
      attachments: attachments?.length ? attachments : undefined,
      timestamp: Date.now(),
    }
    this.appendChatMessage(userMsg)
    this.updateVisibleMessages()

    if (attachments?.length) {
      const parts = await resolveAttachmentsForApi(attachments)
      const allParts: UserContentPart[] = [{ type: 'text', text: content }, ...parts]
      return {
        role: 'user',
        content: allParts,
        timestamp: Date.now(),
        chatMessageId: userMsg.id,
      }
    }
    return { role: 'user', content, timestamp: Date.now(), chatMessageId: userMsg.id }
  }

  /**
   * Everything queued since the loop started, as messages for the model.
   *
   * Emptied before the messages are built so that anything typed while this is running waits
   * for the iteration after, rather than being handed over twice.
   */
  private async takeQueued(): Promise<Message[]> {
    const queued = this.queuedMessages.value
    if (!queued.length) return []
    this.queuedMessages.value = []

    const messages: Message[] = []
    for (const q of queued) messages.push(await this.userMessage(q.content, q.attachments))
    return messages
  }

  /** Drop what is waiting and hand it back, for whoever stopped the agent to keep. */
  takeQueuedMessages(): QueuedMessage[] {
    const queued = this.queuedMessages.value
    this.queuedMessages.value = []
    return queued
  }

  removeQueuedMessage(id: string): void {
    this.queuedMessages.value = this.queuedMessages.value.filter((m) => m.id !== id)
  }

  async approveToolCall(modifiedArgs?: Record<string, unknown>): Promise<void> {
    if (this.isStreaming.value || this.isExecutingTool.value || this.isCompacting.value) return
    const tc = this.pendingToolCalls.value[0]
    if (!tc) return

    this.updateChatMessage(
      (m) => m.toolCallId === tc.id && m.toolStatus === 'pending',
      (m) => ({ ...m, toolStatus: 'approved' as const })
    )

    // Add out-of-scope file paths to scope on approval
    const approvedArgs = modifiedArgs || tc.arguments
    if (approvedArgs) {
      const path = (approvedArgs.path || approvedArgs.from) as string
      if (path && !this.scopeResolver.isInScope(path)) {
        this.scopeResolver.addFile(path)
      }
    }

    await this.processAllPendingToolCalls({ args: modifiedArgs })
    this.markDirty()
  }

  abortToolExecution(): void {
    this.toolAbortController?.abort()
  }

  async rejectToolCall(reason?: string): Promise<void> {
    if (this.isStreaming.value) return
    const tc = this.pendingToolCalls.value[0]
    if (!tc) return

    const reasonText = reason || 'User rejected this action'

    const toolChatMsg = this.allChatMessages.find(
      (m) => m.toolCallId === tc.id && m.toolStatus === 'pending'
    )
    this.updateChatMessage(
      (m) => m.toolCallId === tc.id && m.toolStatus === 'pending',
      (m) => ({ ...m, toolResult: reasonText, toolStatus: 'rejected' as const })
    )

    this.allInternalMessages.push({
      role: 'toolResult',
      toolCallId: tc.id,
      toolName: tc.name,
      content: [{ type: 'text', text: reasonText }],
      isError: true,
      timestamp: Date.now(),
      chatMessageId: toolChatMsg?.id,
    })

    this.pendingToolCalls.value = this.pendingToolCalls.value.slice(1)

    await this.processAllPendingToolCalls()
    this.markDirty()
  }

  // ── Questions tool ──────────────────────────────────────────────

  askQuestions(questions: { question: string; options: string[] }[]): Promise<string[] | null> {
    return new Promise((resolve) => {
      this.pendingQuestions.value = {
        questions,
        currentIndex: 0,
        answers: [],
        resolve,
      }
    })
  }

  answerCurrentQuestion(answer: string): void {
    const pq = this.pendingQuestions.value
    if (!pq) return

    const answers = [...pq.answers, answer]
    if (pq.currentIndex + 1 < pq.questions.length) {
      this.pendingQuestions.value = {
        ...pq,
        currentIndex: pq.currentIndex + 1,
        answers,
      }
    } else {
      pq.resolve(answers)
      this.pendingQuestions.value = null
    }
  }

  abortQuestions(): void {
    const pq = this.pendingQuestions.value
    if (!pq) return
    pq.resolve(null)
    this.pendingQuestions.value = null
  }

  async injectSkill(skillName: string, args?: string): Promise<void> {
    if (this.isStreaming.value || this.isCompacting.value) return

    const content = await loadSkillContent(skillName)
    if (!content) return

    const chatMsg: ChatMessage = {
      id: nanoid(),
      role: 'system',
      content: `Skill loaded: ${skillName}`,
      timestamp: Date.now(),
    }
    this.appendChatMessage(chatMsg)
    this.updateVisibleMessages()

    this.allInternalMessages.push({
      role: 'system',
      content: `[Skill: ${skillName}]\n\n${content}`,
      timestamp: Date.now(),
      chatMessageId: chatMsg.id,
    })

    if (args?.trim()) {
      await this.sendMessage(args.trim())
    } else {
      this.markDirty()
    }
  }

  abort(): void {
    this.cancelAutoRetry()
    this.agentLoop?.abort()
    this.isStreaming.value = false
    // Stopping stops what was lined up behind it too. Whoever stopped it keeps the text —
    // the chat hands it back to the input rather than dropping it.
    this.queuedMessages.value = []
  }

  // ── Reset (new chat within this session / tab) ─────────────────

  async reset(): Promise<void> {
    this.generation++
    this.queuedMessages.value = []
    await this.save()
    this.log.forget()
    this.dirty = false
    this.abort()
    this.abortBackground()
    this.allInternalMessages = []
    this.allChatMessages = []
    this.activeLeafId = null
    this.messages.value = []
    this.allMessages.value = []
    this.streamingContent.value = ''
    this.streamingThinking.value = ''
    this.pendingToolCalls.value = []
    this.currentChatFile.value = null
    this.error.value = null
    this.userMessageCount = 0
    this.chatTitle.value = ''
    this.chatCreated = ''
    this.lastModelId = ''
    this.customSystemPrompt.value = ''
    this.customSystemPromptNotePath.value = ''
    this.interceptor.abort()
    this.interceptor.agentId.value = ''
    this.interceptor.contextDepth.value = 0
    this.interceptor.error.value = null
    this.agentId.value = AgentRegistry.getInstance().defaultAgent()?.id ?? ''
    this.overrides.value = {}
    this.anchor.value = null
    this.pinned.value = []
    this.syncScopeFromAgent()
  }

  /**
   * Restores which agent a chat runs on and what it changed relative to that agent.
   *
   * Chats saved before agents existed carry a full snapshot — model, permission mode, tool
   * modes, scope — that was a copy of the global defaults at the moment the chat started, not
   * a deliberate choice. They are restored as overrides rather than left to track the agent:
   * turning them live would silently change how an old conversation behaves when reopened,
   * which is exactly the surprise this design is meant to avoid.
   */
  private restoreAgentBinding(metadata: ChatMetadata | null | undefined): void {
    const registry = AgentRegistry.getInstance()
    const config = AbeleConfig.getInstance().ai

    const storedAgent = metadata?.agentId ? registry.get(metadata.agentId) : null
    this.agentId.value = storedAgent?.id ?? registry.defaultAgent()?.id ?? ''

    if (metadata?.agentId && !storedAgent) {
      console.warn(
        `[Abele] Chat references a deleted agent (${metadata.agentId}); falling back to the default`
      )
    }

    if (metadata?.overrides) {
      this.overrides.value = { ...metadata.overrides }
      this.syncScopeFromAgent()
      return
    }

    this.overrides.value = metadata ? this.legacyOverrides(metadata, config) : {}
    this.syncScopeFromAgent()
  }

  /** Converts a pre-agent chat's stored snapshot into overrides. */
  private legacyOverrides(metadata: ChatMetadata, config: AiSettings): SessionOverrides {
    const overrides: SessionOverrides = {}

    if (metadata.providerId) overrides.providerId = metadata.providerId
    if (metadata.modelId) overrides.modelId = metadata.modelId
    if (metadata.permissionMode) overrides.permissionMode = metadata.permissionMode

    if (metadata.toolModes) {
      overrides.toolModes = { ...metadata.toolModes }
    } else if (metadata.allowWebSearch !== undefined) {
      // Older still: booleans per tool, from before toolModes existed.
      overrides.toolModes = migrateOldPermissions(metadata, config)
    }

    if (metadata.scopeEntries) {
      overrides.scope = [...metadata.scopeEntries]
      overrides.fullVaultAccess = metadata.fullVaultAccess ?? false
    }

    return overrides
  }

  // ── Save / Load ────────────────────────────────────────────────

  /**
   * Notes that the chat has changed, without waiting for the disk.
   *
   * The agent loop calls this after every tool call, so it must not block: a save used to be
   * awaited in that path, and cost time proportional to the whole conversation. Writes are
   * coalesced over a short window and then append only what changed.
   */
  markDirty(): void {
    if (this.kind === 'run') {
      this.onPersist?.()
      return
    }

    this.dirty = true
    if (this.persistTimer !== null) return

    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null
      void this.flush()
    }, PERSIST_INTERVAL_MS)
  }

  /** Writes anything outstanding now. Called wherever losing the last change would matter. */
  async flush(): Promise<void> {
    // A run has no file of its own; its coordinator owns one and does its own coalescing.
    if (this.kind === 'run') {
      this.onPersist?.()
      return
    }

    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer)
      this.persistTimer = null
    }

    // Never two writes at once: an append that overtook its predecessor would reorder records.
    while (this.writing) await this.writing
    if (!this.dirty) return

    this.dirty = false
    this.writing = this.writeNow()
    try {
      await this.writing
    } catch (err) {
      // The change is still only in memory, so it stays pending rather than being dropped:
      // the next save retries it, and a flush at close gets one more chance.
      this.dirty = true
      console.error('[Abele] Failed to save chat', err)
    } finally {
      this.writing = null
    }
  }

  /** Marks the chat changed and writes it immediately. */
  async save(): Promise<void> {
    this.markDirty()
    await this.flush()
  }

  private snapshot(): ChatSnapshot {
    const config = AbeleConfig.getInstance().ai
    const overrides = this.overrides.value

    const metadata: ChatMetadata = {
      type: 'abele-chat',
      agentId: this.agentId.value || undefined,
      // Written whenever there is an anchor, expanded comments included: the marker in the
      // note has to keep finding this file, and `kind` is how a reopened one knows what it is.
      kind: this.anchor.value ? (this.kind === 'comment' ? 'comment' : 'chat') : undefined,
      anchor: this.anchor.value ?? undefined,
      // Absent rather than empty when nothing is pinned: an unpin should leave the file the
      // way it was before the pin, not carrying a field that says nothing.
      pinned: this.pinned.value.length ? [...this.pinned.value] : undefined,
      // Only what this chat actually changed. Writing the resolved values instead would freeze
      // the chat against today's agent and defeat the whole point of resolving on read.
      overrides: Object.keys(overrides).length ? { ...overrides } : undefined,
      // Kept for chats reopened by an older build, and for the history list, which shows the
      // model a chat ran on without loading the session.
      providerId: this.activeProviderId.value || config.activeProviderId,
      modelId: this.activeModelId.value || config.activeModelId,
      created: this.chatCreated || (this.chatCreated = dayjs().format('YYYY-MM-DD')),
      title: this.chatTitle.value || this.fallbackTitle(),
      pendingToolCalls:
        this.pendingToolCalls.value.length > 0
          ? this.pendingToolCalls.value.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            }))
          : undefined,
      activeLeafId: this.activeLeafId || undefined,
      customSystemPrompt: this.customSystemPrompt.value || undefined,
      customSystemPromptNotePath: this.customSystemPromptNotePath.value || undefined,
      interceptorAgentId: this.interceptor.agentId.value || undefined,
      interceptorContextDepth: this.interceptor.agentId.value
        ? this.interceptor.contextDepth.value
        : undefined,
    }

    return {
      metadata,
      messages: this.allChatMessages,
      internalMessages: this.allInternalMessages,
    }
  }

  private async writeNow(): Promise<void> {
    // Nothing to write and nowhere to write it: a tab nobody has typed into yet. Once a file
    // exists — a comment's, written before its first turn — a meta change is worth a save.
    if (this.allChatMessages.length === 0 && !this.currentChatFile.value) return

    const snapshot = this.snapshot()
    const plan = this.log.plan(snapshot)
    if (plan.kind === 'noop') return

    const file = await ChatStorage.getInstance().saveChat(
      snapshot,
      plan,
      this.currentChatFile.value || undefined
    )
    if (!file) return

    this.log.commit(snapshot, plan)
    this.currentChatFile.value = file

    // Update tab state so new chats get persisted
    this.chatService.saveTabs()
  }

  async load(file: TFile): Promise<void> {
    await this.reset()
    const result = await ChatStorage.getInstance().loadChat(file)

    this.allChatMessages = result.messages.map((m) => (m.id ? m : { ...m, id: nanoid() }))
    this.allInternalMessages = result.internalMessages || []
    // Seeds the writer with what the file already holds, so the first save of a reopened chat
    // appends rather than rewriting it. A file in the older format is not adopted, so that
    // first save rewrites it as a log — which is how a chat migrates.
    this.log.adopt(result)
    this.currentChatFile.value = file
    this.chatTitle.value = result.metadata?.title || ''
    this.chatCreated = result.metadata?.created || ''
    // Before `restoreAgentBinding`, which rebuilds the scope: the anchor has to be in place
    // by then or the note is left out until the next agent change.
    if (result.metadata?.kind) this.kind = result.metadata.kind
    this.anchor.value = result.metadata?.anchor ?? null
    this.pinned.value = result.metadata?.pinned ?? []

    // Migrate old flat format → tree format once
    const needsMigration =
      this.allChatMessages.length > 1 && !this.allChatMessages.some((m) => m.parentId)
    if (needsMigration) {
      backfillParentIds(this.allChatMessages)
      backfillChatMessageIds(this.allChatMessages, this.allInternalMessages)
    }

    this.activeLeafId =
      result.metadata?.activeLeafId || findDefaultLeaf(this.allChatMessages)?.id || null
    this.updateVisibleMessages()

    if (needsMigration) {
      await this.save()
    }

    this.userMessageCount = this.messages.value.filter((m) => m.role === 'user').length

    this.restoreAgentBinding(result.metadata)

    this.customSystemPrompt.value = result.metadata?.customSystemPrompt || ''
    this.customSystemPromptNotePath.value = result.metadata?.customSystemPromptNotePath || ''
    // `activeInterceptorId` is what pre-agent chats stored. Migration reuses each
    // interceptor's own id as its agent id, so the old value maps across unchanged.
    this.interceptor.agentId.value =
      result.metadata?.interceptorAgentId || result.metadata?.activeInterceptorId || ''
    this.interceptor.contextDepth.value = result.metadata?.interceptorContextDepth ?? 0

    // Restore pending tool calls
    if (result.metadata?.pendingToolCalls?.length) {
      this.pendingToolCalls.value = result.metadata.pendingToolCalls.map((tc) => ({
        type: 'toolCall' as const,
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      }))
    }
  }

  // ── Branching ──────────────────────────────────────────────────

  createBranch(messageId: string): void {
    if (this.isStreaming.value || this.pendingToolCalls.value.length > 0) return
    this.activeLeafId = messageId
    this.updateVisibleMessages()
  }

  repeatMessage(messageId: string): void {
    if (this.isStreaming.value || this.isExecutingTool.value) return

    const msg = this.allChatMessages.find((m) => m.id === messageId)
    if (!msg || msg.role !== 'user') return

    // Dismiss any pending tool approvals
    this.pendingToolCalls.value = []

    this.activeLeafId = msg.parentId || null
    this.updateVisibleMessages()

    this.sendMessage(msg.content, msg.attachments)
  }

  async retryFromMessage(messageId: string): Promise<void> {
    if (this.isStreaming.value || this.isExecutingTool.value) return

    const msg = this.allChatMessages.find((m) => m.id === messageId)
    if (!msg) return

    // For tool-call messages: walk up to find the assistant message that generated the tool calls,
    // then find the user message before it and repeat from there.
    // For assistant messages: find the user message before it and repeat.
    let current: ChatMessage | undefined = msg
    while (current && current.role !== 'user') {
      current = current.parentId
        ? this.allChatMessages.find((m) => m.id === current.parentId)
        : undefined
    }

    if (current) {
      this.repeatMessage(current.id)
    }
  }

  switchBranch(messageId: string): void {
    if (this.isStreaming.value) return
    const leaf = findDeepestLeaf(this.allChatMessages, messageId)
    this.activeLeafId = leaf.id
    this.updateVisibleMessages()
    this.markDirty()
  }

  // ── Delegate support ──────────────────────────────────────────

  updateDelegateProgress(status: string): void {
    this.updateChatMessage(
      (m) => m.role === 'tool-call' && m.toolName === 'delegate' && m.toolStatus === 'approved',
      (m) => ({
        ...m,
        toolResult: `Processing: ${status}`,
      })
    )
  }

  /**
   * Records where a delegated run's transcript lives, on the tool call that started it.
   *
   * Only a pointer: a few dozen bytes, so the parent chat's write cost is unchanged no matter
   * how much conversation the sub-agents produce.
   */
  attachSubAgentRun(toolCallId: string, run: SubAgentRunRef): void {
    this.updateChatMessage(
      (m) => m.toolCallId === toolCallId,
      (m) => ({ ...m, subAgentRun: run })
    )
    this.markDirty()
  }

  /** Every run this chat started, so they can be cleaned up with it. */
  subAgentRunIds(): string[] {
    return this.allChatMessages
      .map((m) => m.subAgentRun?.runId)
      .filter((id): id is string => Boolean(id))
  }

  // ── Interceptor ────────────────────────────────────────────────

  private async sendDraftMessage(content: string, attachments?: string[]): Promise<void> {
    this.error.value = null

    const userMsg: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content,
      attachments: attachments?.length ? attachments : undefined,
      timestamp: Date.now(),
      draft: true,
      interceptorName: this.interceptor.agentName,
      interceptorChat: [],
    }
    this.appendChatMessage(userMsg)
    this.updateVisibleMessages()

    await this.interceptor.review(userMsg.id)
    this.markDirty()
  }

  abortInterceptor(): void {
    this.interceptor.abort()
  }

  async retryInterceptor(): Promise<void> {
    await this.interceptor.retry()
  }

  async sendInterceptorMessage(draftMsgId: string, content: string): Promise<void> {
    await this.interceptor.sendMessage(draftMsgId, content)
  }

  /** Looks up a message anywhere in the tree, not only on the visible branch. */
  findMessage(id: string): ChatMessage | undefined {
    return this.allChatMessages.find((m) => m.id === id)
  }

  updateDraftContent(draftMsgId: string, content: string): void {
    this.updateChatMessage(
      (m) => m.id === draftMsgId && !!m.draft,
      (m) => ({ ...m, content })
    )
  }

  async confirmDraft(draftMsgId: string): Promise<void> {
    if (this.isStreaming.value || this.isCompacting.value) return

    const draftMsg = this.allChatMessages.find((m) => m.id === draftMsgId)
    if (!draftMsg || !draftMsg.draft) return

    // Mark as confirmed and collapse interceptor chat
    this.updateChatMessage(
      (m) => m.id === draftMsgId,
      (m) => ({ ...m, draft: false, interceptorCollapsed: true })
    )

    // Now add to internal messages and run agent loop
    const gen = this.generation
    this.error.value = null
    this.userMessageCount++

    if (draftMsg.attachments?.length) {
      const parts = await resolveAttachmentsForApi(draftMsg.attachments)
      const allParts: UserContentPart[] = [{ type: 'text', text: draftMsg.content }, ...parts]
      this.allInternalMessages.push({
        role: 'user',
        content: allParts,
        timestamp: draftMsg.timestamp,
        chatMessageId: draftMsg.id,
      })
    } else {
      this.allInternalMessages.push({
        role: 'user',
        content: draftMsg.content,
        timestamp: draftMsg.timestamp,
        chatMessageId: draftMsg.id,
      })
    }

    await this.runAgentLoop()

    if (gen !== this.generation) return

    this.markDirty()

    const sequential = AbeleConfig.getInstance().ai.sequentialAuxiliary

    // A run is never listed anywhere, so naming it would be a request nobody reads the answer to.
    const wantsTitle =
      this.kind === 'chat' && ChatSession.TITLE_GENERATION_TRIGGERS.includes(this.userMessageCount)
    if (wantsTitle) {
      if (sequential) {
        await this.summarizer.generateTitle()
      } else {
        this.summarizer.generateTitle().catch(() => {
          return
        })
      }
    }

    if (sequential) {
      await this.summarizer.autoCompactIfNeeded()
    } else {
      this.summarizer.autoCompactIfNeeded().catch(() => {
        return
      })
    }

    await this.drainQueue()
  }

  getDraftMessage(): ChatMessage | null {
    return this.messages.value.find((m) => m.draft) || null
  }

  // ── Background tasks ──────────────────────────────────────────

  private getBackgroundSignal(): AbortSignal {
    if (!this.backgroundAbort) this.backgroundAbort = new AbortController()
    return this.backgroundAbort.signal
  }

  private abortBackground(): void {
    this.backgroundAbort?.abort()
    this.backgroundAbort = null
  }

  // ── Other ─────────────────────────────────────────────────────

  private fallbackTitle(): string {
    const firstUser = this.messages.value.find((m) => m.role === 'user')
    const snippet = firstUser
      ? firstUser.content.slice(0, ChatSession.FALLBACK_TITLE_LENGTH).replace(/\n/g, ' ')
      : 'Chat'
    return `${dayjs().format('YYYY-MM-DD HH-mm')} ${snippet}`
  }

  getDebugData(): Record<string, unknown> {
    const tools = this.getTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
    return {
      systemPrompt: this.chatService.getSystemPrompt(this),
      tools,
      internalMessages: this.allInternalMessages,
      pendingToolCalls: this.pendingToolCalls.value.length
        ? this.pendingToolCalls.value
        : undefined,
    }
  }

  destroy(): void {
    this.destroyed = true
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.abort()
    this.abortBackground()
    this.allInternalMessages = []
    this.allChatMessages = []
    this.activeLeafId = null
    this.messages.value = []
    this.allMessages.value = []
    this.pendingToolCalls.value = []
    this.currentChatFile.value = null
    this.effects.stop()
    this.scopeResolver.destroy()
  }
}
