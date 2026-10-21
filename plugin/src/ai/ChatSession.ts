import { NODE_COMMAND_TOOLS } from './tools/NodeManagerTools'
import { uiErrorMessage, type UiMessage, UiError, uiMessage } from '@/i18n/streamBErrors'

import { t } from '@/i18n'
import {
  computed,
  effectScope,
  ref,
  shallowRef,
  watch,
  type EffectScope,
  type ShallowRef,
} from 'vue'
import { TFile, Notice } from 'obsidian'
import { mergeAttentionTruth, settledAttention, type LocalAttention } from '@/agents/attention'
import { AgentsService } from '@/agents/AgentsService'
import { needsSecretApproval } from './tools/secretUtils'
import {
  interruptedToolResult,
  projectInterruptedTools,
  type ToolInterruption,
} from './client/toolInterruption'
import { nanoid } from 'nanoid'
import dayjs from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import type { MapBlock } from '@/helpers/mapConfig'
import { DEFAULT_RETRY, backoffDelay, isTransient } from './retry'
import { AgentLoop, failedToolResult } from './client/AgentLoop'
import { nodeAccessRefusalOf } from './tools/node/accessRefusal'
import { mobileBackground } from './mobileBackground'
import {
  type AgentEvent,
  type AgentTool,
  type AgentToolResult,
  type Message,
  type ModelConfig,
  type ReadMark,
  type TextContent,
  type ThinkingContent,
  type ToolCallContent,
  type ToolDefinition,
  type UserContentPart,
} from './client'
import { projectBranchCuts } from './chatBranchCuts'
import { ChatStorage } from './ChatStorage'
import { cloneChatPath } from './chatClone'
import { claimDelegationIdentity, ownsDelegationIdentity } from './delegationIdentity'
import {
  NODE_AGENT_TOOL_NAMES,
  NODE_EDIT_TOOLS,
  NODE_FILE_OPERATIONS,
  NODE_MUTATION_TOOLS,
} from './tools/node/agent'
import { reconcileNodeScopeApproval } from './tools/node/owner'
import { nodeRepositoryToolsHost } from './tools/node'
import { hasNodeScope } from './nodeScope'
import { NodeService } from '@/node/NodeService'
import {
  prepareSelectionRevision,
  ensureCapturedAnchor,
  type ChatBindingRecovery,
} from './chatAnchorStore'
import type {
  AnchorStoragePort,
  ChatAnchor,
  ChatRevision,
  ChatSelectionSnapshot,
  RevisionPorts,
  RevisionReference,
} from '@/selection/types'
import { sameRevision } from '@/selection/revisionMapping'
import { BindingWriteFailure, type BindingState, type BindingStateChange } from './chatBindingWrite'
import { projectBindingHistory } from './chatBindingHistory'
import {
  ChatLogWriter,
  parseChat,
  serializeChat,
  type ChatSnapshot,
  type ParsedChat,
} from './ChatLog'
import {
  closedSectionHint,
  emulatedTools,
  mergeOpen,
  offerSections,
  openSectionsOnPath,
  type ToolOffer,
} from './ToolDiscovery'
import {
  LEGACY_NODE_TOOLS,
  agentSectionOverrides,
  alwaysOpenSections,
  isSectionToolName,
  nodeSectionLive,
  sectionsOfLegacyGroups,
} from './toolSections'
import { inspectMainChat, readChat } from './chatCopy'
import {
  compatibleReplyHistory,
  interceptorRevision,
  isReplyCorrection,
  projectReplyHistory,
  undoRevision,
  type ReplyProposal,
  type ReplyHighlight,
} from './replyAnnotations'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@/reader/highlights'
import { createReplyRevisionTool, REPLY_REVISION_TOOL } from './tools/ReplyRevisionTool'
import { CommentService } from './CommentService'
import { ChatSummarizer, type SummarizerHost } from './ChatSummarizer'
import { ChatInterceptor, type InterceptorHost } from './ChatInterceptor'
import {
  toolPermissionKey,
  migrateMcpModes,
  pendingMcpToolRefusal,
  unresolvedMcpPermissionKey,
} from './mcp/permissions'
import { notifyMcpPermissionReset } from './mcp/settings'
import { AgentRegistry } from './agents/AgentRegistry'
import {
  normaliseChecks,
  normaliseContextDepth,
  type AgentDefinition,
  type OverrideKey,
  type ScopeEntry,
  type SessionOverrides,
  toolDiscoveryMode,
  type InterceptorEntry,
} from './agents/types'
import {
  ChatMessage,
  ChatMetadata,
  CORE_TOOLS,
  BOOK_READ_TOOLS,
  EDIT_SELECTION_TOOL,
  TOUCHING_TOOLS,
  type TouchedNote,
  WRITE_TOOLS,
  DECK_WRITE_TOOLS,
  migrateOldPermissions,
  type CommentAnchor,
  type ChatDraft,
  type MessageComment,
  type ToolMode,
  type PermissionMode,
  type AiSettings,
  type SubAgentRunRef,
  type QueuedMessage,
  type DelegationWakeFence,
  type ChatReplyTo,
} from './types'

import type { CommentState } from '@/editor/CommentPlugin'

import { createAgentTools, getToolRegistry } from './tools'
import { isScriptPath } from '@/scripting/scriptPath'
import { createEditSelectionTool } from './tools/EditSelectionTool'
import { loadSkillContent, skillNeedsApproval, offeredSkills } from './tools/SkillTool'
import type { ToolContext } from './toolContext'
import { snapshotZipRequest } from '@/archive/vaultZip'
import { ScopeResolver } from './ScopeResolver'
import { resolveAttachmentsForApi } from './attachments'
import { isImagePath } from './tools/ReadImageTool'
import { isHeicImport } from '@/media/imageImport'
import { ReadGuard } from './readGuard'
import { ChatRewind } from './rewind/ChatRewind'
import { ResultStore, createReadResultTool, READ_RESULT } from './resultStore'
import { linkedNotesNote } from './linkedNotes'
import { agentReplyText, composerText } from './replyLinks'
import { TurnPolicy } from './interceptor/turnPolicy'
import type { ToolPolicy } from './interceptor/policy'
import { buildAnswerInput, buildInterceptInput, type InterceptSource } from './interceptor/context'
import {
  retryHeld,
  sendHeld,
  sendThroughChain,
  type ScriptSendHost,
} from './interceptor/scriptSend'
import { anyReads, runChain } from './interceptor/chain'
import {
  copyEntries,
  entriesOf,
  legacyFields,
  normaliseEntries,
  SINGLE_ENTRY_ID,
  withLegacyPatch,
} from './interceptor/entries'

import { matchesPattern } from './interceptor/pattern'
import {
  getPathToLeaf,
  findDeepestLeaf,
  findDefaultLeaf,
  reattachOrphans,
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

/** What a map tool hands back beside its text, for the chat to draw. */
interface ToolMapDetails {
  map?: MapBlock
}

/** Shape returned by tools that say what they changed: the diff, and the file it landed in. */
interface ToolWriteDetails {
  diff?: { old: string; new: string }
  /** The file the call actually wrote. Absent from a tool that changed nothing. */
  path?: string
}

/** The call at the head of the pending queue that the reader has just let through by hand. */
interface ApprovedCall {
  /** Approval belongs to this immutable request, never a later queue head. */
  id: string
  args: Record<string, unknown>
}

const copyToolArgs = (args: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(args)) as Record<string, unknown>
const copyPendingCall = (call: ToolCallContent): ToolCallContent => ({
  ...call,
  arguments: copyToolArgs(call.arguments),
})

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
  root?: ChatSession
  parent?: SessionParent
  /** Called instead of writing a chat file, for a run whose coordinator owns persistence. */
  onPersist?: () => void
  /** Where a comment sits. Seeds the note into scope and travels in the file's meta record. */
  anchor?: CommentAnchor
}

export class ChatSession implements SummarizerHost, InterceptorHost, AnchorStoragePort {
  private static readonly TITLE_GENERATION_TRIGGERS = [1]
  /**
   * The turns after which the history summary is written again.
   *
   * Early, so a new chat's card says something at once; then twice more as the conversation
   * becomes what it is about. Never per turn: each one is a background request, and a chat
   * that is still going on is the one somebody needs a summary of least.
   */
  private static readonly SUMMARY_TRIGGERS = [1, 4, 12]
  private static readonly FALLBACK_TITLE_LENGTH = 50

  /**
   * Reads that never stop the chat. `query_docs` and `list_templates` are here because they
   * are core — handed to every agent — while approval is decided by the tool modes further
   * down, where a tool nobody configured reads as `off`. Left out, the reference an agent is
   * told to consult before touching anything asked permission on every call.
   */
  private static readonly READ_TOOLS = [
    'read',
    READ_RESULT,
    'ls',
    'find',
    'workspace',
    'skill',
    'query_docs',
    'list_templates',
  ]
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
    'look_at_drawing',
    'deck_read',
    'deck_edit',
    'deck_check',
    'present',
    'canvas_read',
    'canvas_edit',
    'canvas_layout',
    'canvas_steps',
    'canvas_export',
    'look_at_canvas',
    'ls',
    'find',
  ]

  public readonly id: string

  private agentLoop: AgentLoop | null = null
  private turnAbortController: AbortController | null = null
  private turnAborted = false
  /** Stop pressed during a streamed reply: its mark follows the partial text the loop keeps. */
  private stopMarkPending = false
  private delegationWakeStopped = false
  private delegationStopEpoch = 0
  private unsubscribe: (() => void) | null = null
  private streamStartTime = 0
  private allInternalMessages: Message[] = []
  /** The countdown to an automatic retry, for the chat to show; null when nothing is waiting. */
  readonly retrying = ref<{ attempt: number; of: number; secondsLeft: number } | null>(null)
  /** A retry countdown handing back to its loop is still the same unfinished turn. */
  private readonly activeAgentTurns = ref(0)
  private retryTimer: number | null = null
  private retryCancel: (() => void) | null = null
  private allChatMessages: ChatMessage[] = []
  private activeLeafId: string | null = null
  private pendingBranchCut: string | undefined
  private branchSelectionRevision = 0
  private userMessageCount = 0
  public readonly chatTitle = ref('')
  private chatCreated = ''
  private readonly chatIdentityRef = ref<string>()
  private get chatIdentity(): string | undefined {
    return this.chatIdentityRef.value
  }
  private set chatIdentity(value: string | undefined) {
    this.chatIdentityRef.value = value
  }
  /** Existing durable chat identity, not the transient tab/AgentLoop ID. */
  get delegationParentId(): string | undefined {
    const file = this.currentChatFile.value
    return file && this.chatIdentity && ownsDelegationIdentity(this.chatIdentity, file.path)
      ? this.chatIdentity
      : undefined
  }
  public readonly bindingRecoveries = shallowRef<ChatBindingRecovery[]>([])
  private get bindingRecovery(): ChatBindingRecovery[] | undefined {
    return this.bindingRecoveries.value.length ? this.bindingRecoveries.value : undefined
  }
  private set bindingRecovery(value: ChatBindingRecovery[] | undefined) {
    this.bindingRecoveries.value = value ?? []
  }
  private bindingWriteBlocked = false
  private backgroundAbort: AbortController | null = null
  private toolAbortController: AbortController | null = null
  /** Changes before replacing a conversation; saving its first file does not change it. */
  public readonly conversationVersion = ref(0)
  /** The reserved clone tab is read-only until its independent snapshot has been adopted. */
  public readonly preparingClone = ref(false)
  /** The live conversation owns this draft, including imports, independently of every view. */
  public readonly draft = ref<ChatDraft>({ text: '', attachments: [] })
  private get generation(): number {
    return this.conversationVersion.value
  }
  /** What an interceptor script said about the tool calls of the turn running now. */
  private readonly turnPolicy = new TurnPolicy()
  /**
   * The finished answer the interceptor is reading now, and who reads it. The chat is busy for
   * that long: what is typed waits, and Stop cancels the check and keeps the answer.
   */
  public readonly answerCheck = ref<{ id: string; by: string; at?: number; of?: number } | null>(
    null
  )
  /** When the latest agent loop started; only an answer written since then is checked. */
  private turnStartedAt = 0
  /** Answers already checked here, so a turn resumed twice never checks one twice. */
  private readonly answersChecked = new Set<string>()
  private lastModelId = ''

  /** What the chat's file already holds, so a save writes only the difference. */
  private readonly log = new ChatLogWriter()
  /** Refuses a write to a file this conversation has not seen as it is now. See `readGuard.ts`. */
  private readonly readGuard = new ReadGuard({
    history: () => this.getMessagesForModel(),
    scope: () => this.scopeResolver,
  })
  /** Keeps a result too big to send whole, for `read_result`. See `resultStore.ts`. */
  private readonly results = new ResultStore({
    messages: () => {
      const path = this.activeLeafId
        ? getPathToLeaf(this.allChatMessages, this.activeLeafId)
        : this.allChatMessages
      // Keep the existing conversation-wide store on ordinary paths; explicit cuts narrow it.
      return this.pendingBranchCut || path.some((message) => message.branchCutAfter)
        ? this.getBranchInternalMessages()
        : this.allInternalMessages
    },
  })
  /**
   * What this chat's agent changed in the vault, turn by turn, and the way back. See
   * `rewind/ChatRewind.ts`. Built on first use: a session made before the app is known — a
   * test's — has no vault to watch.
   */
  private rewindLog: ChatRewind | null = null
  /** Local publications/settings and writes, including edits that never call markDirty. */
  private localRevision = 0
  private dirty = false
  private writing: Promise<void> | null = null
  private lastWriteRevision: number | null = null
  private persistTimer: number | null = null

  // Reactive state for Vue components
  public readonly messages = ref<ChatMessage[]>([])
  public readonly allMessages = ref<ChatMessage[]>([])
  public readonly isStreaming = ref(false)
  public readonly reconnecting = ref<'waiting' | 'connecting' | null>(null)
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
  public readonly errorPresentation = shallowRef<UiMessage | null>(null)
  public readonly attention = ref<LocalAttention>({})
  private restoringAttention = false
  private readonly attentionAcks = new Set<string>()
  private committedAttention: LocalAttention = {}
  private persistFailed = false

  get attentionBusy(): boolean {
    return this.isBusy
  }

  /** Disk-confirmed decisions update the holder without saving, approving, or resuming it. */
  applyAttentionTruth(metadata: ChatMetadata, reconcileRequests = true): void {
    const previous = this.restoringAttention
    this.restoringAttention = true
    try {
      this.committedAttention = mergeAttentionTruth(
        metadata.attention ?? {},
        this.committedAttention
      )
      const merged = mergeAttentionTruth(this.attention.value, this.committedAttention)
      if (!this.isBusy) {
        if (merged.tools)
          merged.tools = Object.fromEntries(
            Object.entries(merged.tools ?? {}).map(([id, status]) => [
              id,
              status === 'executing' ? 'interrupted' : status,
            ])
          )
        if (merged.run?.status === 'running') merged.run = { ...merged.run, status: 'interrupted' }
        if (merged.question?.status === 'waiting' && !this.pendingQuestions.value)
          merged.question = { ...merged.question, status: 'interrupted' }
      }
      this.attention.value = merged
      if (!reconcileRequests) return
      const settled = settledAttention(merged)
      const pending = this.pendingToolCalls.value.filter((tc) => !settled.has(tc.id))
      // Scans can land during a selection return. An equal filtered list is not a local
      // change: replacing it would trip the synchronous revision watcher on every scan.
      if (pending.length !== this.pendingToolCalls.value.length)
        this.pendingToolCalls.value = pending
      if (
        !this.isBusy &&
        !this.pendingToolCalls.value.length &&
        metadata.pendingToolCalls?.length
      ) {
        const restored = metadata.pendingToolCalls
          .filter((tc) => !settled.has(tc.id) && !merged.tools?.[tc.id])
          .map((tc) => ({ ...tc, type: 'toolCall' as const }))
        if (restored.length) this.pendingToolCalls.value = restored
      }
    } finally {
      this.restoringAttention = previous
    }
  }

  recordAttentionError(text: string): void {
    this.attention.value = {
      ...this.attention.value,
      errors: [
        ...(this.attention.value.errors ?? []),
        {
          id: nanoid(),
          at: Date.now(),
          text,
          target: this.activeLeafId ?? undefined,
        },
      ],
    }
    // The ordinary end-of-turn save commits this together with the conversation.
    this.dirty = true
  }

  async markFailuresSeen(indexedIds: string[] = []): Promise<void> {
    const settled = settledAttention(this.attention.value)
    const ids = [
      ...new Set([
        ...(this.attention.value.errors ?? []).filter((e) => !e.seen).map((e) => e.id),
        ...indexedIds.filter((id) => !settled.has(id)),
      ]),
    ]
    if (ids.length) await this.acknowledgeAttention(ids)
  }

  async markAttentionSeen(id: string): Promise<void> {
    await this.acknowledgeAttention([id])
  }

  private async acknowledgeAttention(ids: string[]): Promise<void> {
    // The visible state and its ledger remain unresolved until storage confirms this ack.
    for (const id of ids) this.attentionAcks.add(id)
    try {
      await this.save()
      const settled = settledAttention(this.committedAttention)
      if (ids.some((id) => !settled.has(id)))
        throw new UiError(uiMessage('streamBError.d132590f46'))
    } finally {
      for (const id of ids) this.attentionAcks.delete(id)
    }
  }

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
  get nodeScopeIdentity(): string | undefined {
    return this.delegationParentId
  }

  noteNodeWorktreeSwitch(label: string): void {
    this.appendChatMessage({
      id: nanoid(),
      role: 'system',
      content: `Node worktree: ${label}`,
      timestamp: Date.now(),
    })
    this.updateVisibleMessages()
    this.markDirty()
  }

  /** The agent in force, falling back to the default one if this chat's agent was deleted. */
  public readonly agent = computed<AgentDefinition | null>(() => {
    const registry = AgentRegistry.getInstance()
    return registry.get(this.agentId.value) ?? registry.defaultAgent()
  })

  /**
   * Whether something is running that a message typed now would land in the middle of.
   *
   * Streaming is only one of them. A tool approved by hand runs outside the loop, and a failed
   * request counting down to its next attempt has no loop at all — in both the conversation
   * is half-way through a turn, so a message has to wait for it rather than start another.
   */
  private get isBusy(): boolean {
    return (
      this.preparingClone.value ||
      this.replyChanging ||
      this.isStreaming.value ||
      this.isCompacting.value ||
      this.isExecutingTool.value ||
      this.retrying.value !== null ||
      // A script deciding about a message: what is sent meanwhile waits for its decision.
      this.interceptor.working.value ||
      // The interceptor reading the finished answer: the next message waits for what stays.
      this.answerCheck.value !== null
    )
  }

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
    if (this.preparingClone.value) return true
    if (this.replyChanging || this.isStreaming.value || this.isCompacting.value) return true
    if (this.interceptor.working.value || this.answerCheck.value) return true
    return this.pendingToolCalls.value.length > 0 || this.pendingQuestions.value !== null
  }

  /**
   * True while `CommentService` is carrying this conversation between the margin and a tab.
   *
   * A move rewrites what the file says this is, waits on the write, and only then moves the
   * maps that answer for the id — so a second press landing inside that gap works from a
   * conversation half of which has already moved: two history entries, or a session dropped
   * from `sessions` and never filed in `expanded`. Reactive, because both the card and the
   * sidebar draw their button from it while the move is in flight.
   */
  public readonly moving = ref(false)

  /**
   * Records that this chat wrote to `path`.
   *
   * Called by the tool wrapper on every successful write, and public so a live check can drive
   * a link without a model behind it. Only notes and scripts are kept: a footer exists under a
   * note and the code view lists a script's chats the same way, so a chat that wrote a
   * `.canvas` or another chat file has nothing to appear under.
   */
  noteTouched(path: string): void {
    const clean = path.trim().replace(/^\.?\//, '')
    if (
      !clean.endsWith('.md') &&
      !isScriptPath(clean) &&
      !clean.split('/').some((part) => part.startsWith('.'))
    )
      return
    if (clean === this.currentChatFile.value?.path) return

    this.wroteThisTurn = true
    const at = new Date().toISOString()
    const existing = this.touched.value.find((note) => note.path === clean)
    this.touched.value = existing
      ? this.touched.value.map((note) => (note.path === clean ? { path: clean, at } : note))
      : [...this.touched.value, { path: clean, at }]
    this.markDirty()
  }

  /** Committed file-owned identity; never inferred from a session's basename. */
  private commentIdentity?: string
  bindCommentIdentity(id: string, renamedLocation?: string): void {
    this.commentIdentity = id
    if (renamedLocation) this.log.relocateDiscussion(id, renamedLocation)
  }
  get commentId(): string | null {
    return this.commentIdentity ?? null
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
    get: () => {
      const modes = { ...this.folderToolAccess.value.modes }
      if (this.overrides.value.nodeScope?.length) {
        for (const name of [
          'node_git_commit',
          'node_worktree_remove',
          'node_command_run',
          'node_git_integrate',
        ])
          modes[name] ??= 'ask'
        for (const name of [
          'node_delegations',
          'node_delegation_status',
          'node_command_status',
          'node_command_cancel',
        ])
          if (modes[name] !== 'off') modes[name] = 'auto'
      }
      return modes
    },
    set: (value) => this.setOverride('toolModes', value),
  })

  public readonly folderToolAccess = computed(() =>
    this.chatService.folders.accessFor(
      this.chatService.folderLocation(this),
      this.overrides.value.toolModes ?? this.agent.value?.toolModes ?? {}
    )
  )
  public readonly ownToolModes = computed(
    () => this.overrides.value.toolModes ?? this.agent.value?.toolModes ?? {}
  )
  public readonly folderToolFloor = computed(() => {
    const modes = this.chatService.folders.accessFor(
      this.chatService.folderLocation(this),
      {}
    ).modes
    return Object.keys(modes).length ? modes : undefined
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
   * The notes this chat wrote to, oldest first write first.
   *
   * Replaced, never pushed into: a `shallowRef` does not see a push, and every view of this
   * list is downstream of the ref.
   */
  public readonly touched = shallowRef<TouchedNote[]>([])

  /**
   * Comments asked about passages of this chat's answers, kept in its metadata because an
   * answer has no text of ours to carry a marker in. Replaced, never pushed into.
   */
  public readonly messageComments = shallowRef<MessageComment[]>([])

  /** Files a comment on one of this chat's answers and writes the chat, so the file has it. */
  async addMessageComment(comment: MessageComment): Promise<void> {
    this.messageComments.value = [...this.messageComments.value, comment]
    await this.save()
  }

  /** Takes a comment off this chat. False when it was not on it. */
  async removeMessageComment(id: string): Promise<boolean> {
    const kept = this.messageComments.value.filter((comment) => comment.id !== id)
    if (kept.length === this.messageComments.value.length) return false
    this.messageComments.value = kept
    await this.save()
    return true
  }

  /** One sentence on what this chat did, for the card under a note it changed. */
  public readonly recap = ref('')

  /** What the chat is about, for its card in the history. */
  public readonly summary = ref('')

  /** Set by `noteTouched`, read at the end of a turn to decide whether to recap. */
  private wroteThisTurn = false

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
  public readonly root: ChatSession
  public depthLimit = Number.POSITIVE_INFINITY
  public delegatedRuns = 0
  public skillCeiling: ReadonlySet<string> | undefined
  public githubConnectionCeiling: Record<string, ToolMode> | undefined
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
    this.root = options.root ?? this
    this.parent = options.parent ?? null
    this.onPersist = options.onPersist ?? null
    this.scopeResolver = new ScopeResolver()
    this.summarizer = new ChatSummarizer(this)
    this.interceptor = new ChatInterceptor(this)
    this.agentId.value = options.agentId || AgentRegistry.getInstance().defaultAgent()?.id || ''
    this.anchor.value = options.anchor ?? null
    this.effects = effectScope(true)
    this.effects.run(() => {
      watch(
        () => JSON.stringify(this.overrides.value.nodeScope),
        (_value, before) => {
          if (before !== undefined || hasNodeScope(this)) {
            reconcileNodeScopeApproval(this)
            nodeRepositoryToolsHost.revokeAll(this)
          }
        },
        { flush: 'sync' }
      )
      watch(
        [
          this.chatTitle,
          this.agentId,
          this.overrides,
          this.kindRef,
          this.anchor,
          this.touched,
          this.messageComments,
          this.queuedMessages,
          this.pendingToolCalls,
          this.recap,
          this.summary,
          this.customSystemPrompt,
          this.customSystemPromptNotePath,
          () => this.interceptor.override.value,
        ],
        () => {
          this.localRevision++
        },
        { deep: true, flush: 'sync' }
      )
      watch(
        () => this.isStreaming.value || this.isExecutingTool.value || !!this.retrying.value,
        (working) => {
          if (this.restoringAttention || this.destroyed || this.kind === 'run') return
          const run = this.attention.value.run
          this.attention.value = {
            ...this.attention.value,
            run: working
              ? run?.status === 'running'
                ? run
                : {
                    id: nanoid(),
                    at: Date.now(),
                    status: 'running',
                    target: this.activeLeafId ?? undefined,
                  }
              : run
                ? { ...run, status: 'done' }
                : undefined,
          }
          if (run && (!working || run.status !== 'running'))
            this.attention.value.resolved = [
              ...new Set([...(this.attention.value.resolved ?? []), run.id]),
            ]
          // The device-local index records this immediately; the next normal chat write
          // carries it too, without an extra write per state change within a turn.
          this.dirty = true
        },
        { flush: 'sync' }
      )
      watch(
        this.pendingToolCalls,
        (calls, previousCalls) => {
          if (this.restoringAttention || this.destroyed || this.kind === 'run') return
          if (!calls.length && !this.attention.value.approvals) return
          this.attention.value = {
            ...this.attention.value,
            approvals: Object.fromEntries(
              calls.map((p) => [p.id, this.attention.value.approvals?.[p.id] ?? Date.now()])
            ),
            resolved: [
              ...new Set([
                ...(this.attention.value.resolved ?? []),
                ...previousCalls
                  .filter((tc) => !calls.some((next) => next.id === tc.id))
                  .map((tc) => tc.id),
              ]),
            ],
          }
          this.markDirty()
        },
        { flush: 'sync' }
      )
      this.watchScope()
      this.watchCompaction()
      this.watchAnchoredNote()
    })
    this.syncScopeFromAgent()
    if (this.kind !== 'run') AgentsService.getInstance().track(this)
  }

  // ── Agent binding ──────────────────────────────────────────────

  /**
   * The reviewer this chat's agent asks for. A delegated run has none whatever its agent says:
   * nobody is there to read a draft, and a run that waited for one would never finish.
   */
  defaultInterceptors(): InterceptorEntry[] {
    if (this.kind === 'run') return []
    const agent = this.agent.value
    if (!agent) return []
    // Never the agent reading for itself, whatever the settings say.
    return entriesOf(agent).filter((e) => e.script || e.agentId !== agent.id)
  }

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
   *
   * Returns whether anything moved, which is what a caller writing the divider itself has to
   * gate on: a chat already on that agent has not switched to it, and saying that it has puts
   * a line into the conversation for a thing that did not happen.
   */
  bindAgent(agentId: string, options: { keepNodeScope?: boolean } = {}): boolean {
    if (agentId === this.agentId.value) return false

    this.agentId.value = agentId
    this.overrides.value =
      options.keepNodeScope && hasNodeScope(this)
        ? { nodeScope: this.overrides.value.nodeScope }
        : {}
    this.syncScopeFromAgent()
    return true
  }

  /**
   * Puts back the per-chat values a binding dropped, the resolver with them.
   *
   * `bindAgent` clears the overrides because they were expressed against the agent being left
   * — but a move that had to be undone was never a move, and the narrowed scope or tool set
   * somebody set in this chat is theirs. The scope is re-read rather than only recorded: it
   * was applied to the resolver from the agent when the overrides went.
   */
  restoreOverrides(overrides: SessionOverrides): void {
    this.overrides.value = { ...overrides }
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
    if (!this.bindAgent(agentId)) return

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

  /** Restrict a run to the delegating parent's access, beneath its own selected scope. */
  applyRunScope(entries: ScopeEntry[], fullVaultAccess: boolean, ceiling: ScopeResolver): void {
    this.overrides.value = { ...this.overrides.value, scope: [...entries], fullVaultAccess }
    this.scopeResolver.setCeiling(ceiling)
    this.applyScope(entries, fullVaultAccess)
  }

  offeredSkillNames(): ReadonlySet<string> {
    return new Set(
      offeredSkills(this.agent.value, this.scopeResolver)
        .filter((skill) => !this.skillCeiling || this.skillCeiling.has(skill.name))
        .map((skill) => skill.name)
    )
  }

  /** Per-connection rights are runtime-bound too, not just the GitHub tool switches. */
  githubAgent(): AgentDefinition | null {
    const agent = this.agent.value
    if (!agent || !this.githubConnectionCeiling) return agent
    const modes: Record<string, ToolMode> = {}
    const rank = { off: 0, ask: 1, auto: 2 }
    for (const id of Object.keys(agent.githubConnections ?? {})) {
      const own = agent.githubConnections?.[id] ?? 'off'
      const parent = this.githubConnectionCeiling[id] ?? 'off'
      modes[id] = rank[own] <= rank[parent] ? own : parent
    }
    return { ...agent, githubConnections: modes }
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
      // Not a chat, though: a comment on an answer is told about that chat in its prompt, and a
      // chat reaches another agent only as the words said in it, never as a file it may read.
      if (this.anchor.value && !this.anchor.value.message) {
        this.scopeResolver.addFile(this.anchor.value.note)
      }
    } finally {
      this.syncingScope = false
    }
  }

  // ── SummarizerHost ─────────────────────────────────────────────

  messagesForModel(): Message[] {
    return this.getMessagesForModel()
  }

  toolDefs(): ToolDefinition[] {
    return this.getTools().map((translationItem) => ({
      name: translationItem.name,
      description: translationItem.description,
      parameters: translationItem.parameters,
    }))
  }

  hasInternalMessages(): boolean {
    return this.allInternalMessages.length > 0
  }

  /**
   * Records a compaction summary in both places it has to appear: as a divider the user sees,
   * and as an internal system marker that `getMessagesForModel` truncates the history at.
   */
  applyCompactSummary(summary: string, retained: Message[] = []): void {
    // What was read before the summary is out of the model's sight from here on.
    this.readGuard.settle()
    const divider: ChatMessage = {
      id: nanoid(),
      role: 'system',
      content: summary,
      timestamp: Date.now(),
    }
    this.appendChatMessage(divider)
    this.updateVisibleMessages()

    this.rememberInternal({
      role: 'system',
      content: `${ChatSummarizer.COMPACT_MARKER}\n\n${summary}`,
      timestamp: Date.now(),
      chatMessageId: divider.id,
    })
    // Keep the unfinished exchange verbatim after the marker. Link these copies to the
    // divider, so rewinding before it sees the original exchange once, not twice.
    this.rememberInternal(
      ...retained
        // Corrections are re-projected from the reviewed reply. Copying them under the
        // divider's id would hide their source id and make the next projection duplicate them.
        .filter((message) => !isReplyCorrection(message))
        .map((message) => ({ ...message, chatMessageId: divider.id }))
    )
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

    this.errorPresentation.value = null
    this.error.value = null
    try {
      await this.runAgentLoop()
      // A turn just ended: a natural point to be sure the disk has it.
      await this.save()
      await this.checkAnswer()
    } finally {
      await this.drainQueue()
    }
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

  getToolPermissionKey(toolName: string, toolCallId?: string): string {
    if (toolCallId && toolName.startsWith('mcp_')) {
      const call = this.pendingToolCalls.value.find(
        (tc) => tc.id === toolCallId && tc.name === toolName
      )
      return call?.permissionKey ?? unresolvedMcpPermissionKey(toolName)
    }
    return toolPermissionKey(toolName, AbeleConfig.getInstance().ai.mcpServers)
  }

  getToolMode(toolName: string, toolCallId?: string): ToolMode {
    const saved = this.toolModes.value[this.getToolPermissionKey(toolName, toolCallId)]
    if (saved !== undefined) return saved
    if (this.overrides.value.nodeScope?.length && NODE_AGENT_TOOL_NAMES.includes(toolName))
      return this.needsApproval(toolName) ? 'ask' : 'auto'
    return 'off'
  }

  // ── Tools with session scope ────────────────────────────────────

  /**
   * Sections open before this chat's own history: inherited by a delegated run from its parent,
   * or carried over from a chat saved with revealed tool groups. Everything else is derived.
   */
  private initialSections: string[] = []
  /** The last section offer, so a call to a closed section's tool can say which one to open. */
  private lastOffer: ToolOffer | null = null

  /**
   * The sections open on the active branch, in the order they were opened. Derived from the
   * branch's own open calls, so a sibling branch does not share them and a rewind closes them.
   * A chat with node scope has the node section open from the start.
   */
  openToolSections(): string[] {
    const path = this.activeLeafId
      ? getPathToLeaf(this.allChatMessages, this.activeLeafId)
      : this.allChatMessages
    return mergeOpen(
      alwaysOpenSections(this.agent.value),
      this.overrides.value.nodeScope?.length ? ['nodes'] : [],
      this.initialSections,
      openSectionsOnPath(path)
    )
  }

  /** A delegated run starts with the sections its parent had open. */
  inheritToolSections(ids: readonly string[]): void {
    this.initialSections = mergeOpen(this.initialSections, ids)
  }

  /** Tools this chat answers but does not offer: old names an agent may still call. */
  private hiddenTools: AgentTool[] = []

  /** An allowed tool that is answered without being offered, by name. */
  hiddenTool(name: string): AgentTool | undefined {
    this.getTools()
    return this.hiddenTools.find((tool) => tool.name === name)
  }

  /** Why a called tool is missing, when it only waits for its section to be opened. */
  missingToolHint(name: string): string | undefined {
    this.getTools()
    return this.lastOffer ? closedSectionHint(name, this.lastOffer) : undefined
  }

  private getTools(): AgentTool[] {
    const agent = this.agent.value
    // Bound to this chat's agent, so `remember` writes where this chat's prompt reads from.
    const allTools = createAgentTools({
      session: this,
      agentId: agent?.id,
      scope: this.scopeResolver,
      skillCeiling: this.skillCeiling,
      githubAgent: () => this.githubAgent(),
      nodeRepositoryApproval:
        this.kind === 'run'
          ? undefined
          : async (target, signal) =>
              (await import('@/node/repositoryReadApproval')).repositoryReadApproval()(
                target,
                signal
              ),
      githubApproval:
        this.kind === 'run'
          ? undefined
          : async (connection, signal) =>
              (await import('@/github/approveConnection')).connectionApproval()(connection, signal),
    })

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
      // An answer in a chat is what the model said, not a note anyone may rewrite; a book is
      // never written to at all.
      !this.anchor.value.message &&
      !this.anchor.value.cfi &&
      (this.toolModes.value[EDIT_SELECTION_TOOL] ?? 'ask') !== 'off'
    // Node scope is an explicit owner surface, independent of optional feature-tool defaults.
    const sectioned = toolDiscoveryMode(agent) === 'sections'
    const delegationTools = [
      'node_delegations',
      'node_delegate',
      'node_delegation_send',
      'node_delegation_status',
      'node_delegation_cancel',
      ...NODE_COMMAND_TOOLS,
    ]
    const scopeTools = [...NODE_AGENT_TOOL_NAMES, ...delegationTools]
    const scopeFiltered = this.overrides.value.nodeScope?.length
      ? filtered
      : filtered.filter((tool) => !delegationTools.includes(tool.name))
    const withNode = this.overrides.value.nodeScope?.length
      ? [
          ...scopeFiltered,
          ...allTools.filter(
            (tool) =>
              scopeTools.includes(tool.name) &&
              this.toolModes.value[tool.name] !== 'off' &&
              !scopeFiltered.some((value) => value.name === tool.name)
          ),
        ]
      : scopeFiltered
    const withSelection = offered ? [...withNode, createEditSelectionTool(this)] : withNode
    if (this.kind === 'comment' && this.anchor.value?.message && this.anchor.value.quote)
      withSelection.push(createReplyRevisionTool(this))

    // A discussion about words in a book reads that book, whatever its agent's own tools: the
    // read-only book tools come with the anchor, as the note comes into a note comment's scope.
    // The scope holds the book, and they answer only for books in scope.
    const withBook = this.bookAnchored()
      ? [
          ...withSelection,
          ...allTools.filter(
            (tool) =>
              BOOK_READ_TOOLS.has(tool.name) &&
              !withSelection.some((translationItem) => translationItem.name === tool.name)
          ),
        ]
      : withSelection

    // Every agent can read on in a result it was sent only the start of. Old node names stay
    // callable for an agent that still uses them, but are never offered (`LEGACY_NODE_TOOLS`).
    const everything = [...withBook, createReadResultTool(this.results)]
    this.hiddenTools = this.wrapToolsForSession(
      everything.filter((tool) => LEGACY_NODE_TOOLS.has(tool.name))
    )
    const allowed = everything.filter((tool) => !LEGACY_NODE_TOOLS.has(tool.name))
    if (!sectioned) {
      this.lastOffer = null
      return this.wrapToolsForSession(allowed)
    }
    // Context tools belong to the passage or the conversation, not to a section. The node tools
    // a scope brings wait in the node section, open from the start (`openToolSections`).
    const context = new Set([REPLY_REVISION_TOOL, READ_RESULT])
    if (offered) context.add(EDIT_SELECTION_TOOL)
    if (this.bookAnchored()) for (const name of BOOK_READ_TOOLS) context.add(name)
    const offer = offerSections({
      allowed,
      metadata: getToolRegistry(allTools),
      context,
      open: this.openToolSections(),
      asks: (tool) => this.needsApproval(tool.name, undefined, tool.permissionKey),
      live: (id) =>
        id === 'nodes'
          ? nodeSectionLive(
              this.overrides.value.nodeScope,
              this.overrides.value.nodeTarget,
              this.permissionMode.value
            )
          : undefined,
      // The agent's own words for a section win over the vault-wide ones.
      overrides: {
        ...AbeleConfig.getInstance().ai.prompts?.toolDescriptions,
        ...agentSectionOverrides(agent),
      },
    })
    this.lastOffer = offer
    return this.wrapToolsForSession(emulatedTools(offer))
  }

  /** Whether this is a discussion about words in a book: its anchor names a place in one. */
  private bookAnchored(): boolean {
    return !!this.anchor.value?.cfi && !this.anchor.value.message
  }

  /**
   * Bind each call to this chat explicitly, including across awaits and concurrent calls.
   */
  private wrapToolsForSession(tools: AgentTool[]): AgentTool[] {
    return tools.map((tool) => ({
      ...tool,
      execute: async (
        id: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
        callerCtx?: ToolContext
      ): Promise<AgentToolResult> => {
        // ZIP's selected array and invocation owner must not change during approval/tracker awaits.
        const invocationParams =
          tool.name === 'zip'
            ? { ...snapshotZipRequest(params) }
            : tool.name === 'node_propose_edit' || NODE_MUTATION_TOOLS.includes(tool.name)
              ? structuredClone(params)
              : params
        const ownerAgent = this.agent.value
        const version = this.conversationVersion.value
        const invocationApp = GlobalStore.getInstance().app
        const ctx: ToolContext = {
          scope: this.scopeResolver,
          session: this,
          onNodeFileTarget: (target) => {
            if (this.destroyed || this.conversationVersion.value !== version) return
            this.updateChatMessage(
              (m) => m.role === 'tool-call' && m.toolCallId === id,
              (m) => ({ ...m, toolNodeTarget: structuredClone(target) })
            )
          },
          agentId: tool.name === 'zip' ? ownerAgent?.id : this.agent.value?.id,
          app: invocationApp,
          validateWrite: () => {
            if (
              this.destroyed ||
              this.conversationVersion.value !== version ||
              !ownerAgent ||
              this.agent.value !== ownerAgent ||
              GlobalStore.getInstance().app !== invocationApp
            )
              throw new UiError(uiMessage('streamBError.e4184853d0'))
            if (!(ctx.interactive && ctx.approved) && this.needsApproval('zip', invocationParams))
              throw new UiError(uiMessage('streamBError.960fe81dfd'))
          },
          skillCeiling: this.skillCeiling,
          interactive: this.kind !== 'run',
          approved:
            callerCtx?.approved === true ||
            (tool.name !== 'node_propose_edit' &&
              (await this.turnPolicy.isApproved(id, tool.permissionKey, tool.destinationKey))),
        }
        // Delegated branches write to their root chat, with the branch's own run identity.
        const recording = this.root.rewind.track(
          tool.name,
          `${this.id}:${this.currentTurnId() ?? id}`
        )
        ctx.app = recording.app
        try {
          // Before anything is written, so a refused call changes nothing at all.
          const refused = await this.readGuard.check(tool.name, params)
          if (refused) throw new Error(refused)
          signal?.throwIfAborted()
          const identityRefusal = pendingMcpToolRefusal(
            tool,
            AbeleConfig.getInstance().ai.mcpServers
          )
          if (identityRefusal) throw new Error(identityRefusal)
          const result = await tool.execute(id, invocationParams, signal, ctx)
          await this.readGuard.record(tool.name, params, result)
          // After the guard, which has to see a file's text as the tool gave it.
          this.results.keep(tool.name, id, result)
          // The one place that sees a tool's name, its arguments and its result together, so
          // the one place a successful write becomes a link. A run is skipped: it is never
          // listed anywhere, and its writes belong to the chat that delegated them.
          // A call that failed threw, and never reaches this line — which is the whole check
          // that a write that did not happen links nothing.
          if (this.kind !== 'run' && TOUCHING_TOOLS.includes(tool.name)) {
            // The tool says what it wrote, and only when it wrote something. Falling back to
            // the `path` argument instead would link a call that came to nothing — a `replace`
            // whose actions all matched nothing asks about a file it then leaves alone.
            const details = result.details as ToolWriteDetails | undefined
            this.noteTouched(details?.path ?? '')
          }
          return result
        } finally {
          await recording.close()
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

  needsApproval(toolName: string, args?: Record<string, unknown>, permissionKey?: string): boolean {
    if (toolName === 'node_git_commit' || toolName === 'node_worktree_remove') return true
    if (
      [
        'node_delegations',
        'node_delegation_status',
        'node_command_run',
        'node_command_status',
        'node_command_cancel',
        'node_git_integrate',
      ].includes(toolName)
    )
      return false
    if (toolName === 'node_propose_edit' || needsSecretApproval(toolName, args)) return true
    const mode = this.permissionMode.value
    if (NODE_EDIT_TOOLS.includes(toolName)) return mode !== 'allow-edit' && mode !== 'allow-all'
    if (NODE_FILE_OPERATIONS.includes(toolName)) return mode !== 'allow-all'
    if (NODE_AGENT_TOOL_NAMES.includes(toolName)) return false

    // This tool only records a proposal. Accepting it is a separate owner action, never a
    // permission mode, tool call or automatic approval.
    if (toolName === REPLY_REVISION_TOOL || isSectionToolName(toolName)) return false

    // Listing is filtered by the tool itself, including ancestors of scoped files. It never
    // grants access to the directory or needs approval to extend the scope.
    if (toolName === 'ls') return false

    // Out-of-scope file access always requires approval, whatever the mode says about writes.
    if (this.outOfScopePath(toolName, args)) return true

    if (
      toolName === 'skill' &&
      skillNeedsApproval(args?.name, this.agent.value, this.scopeResolver, this.skillCeiling)
    )
      return true

    // Core read tools: never need approval
    if (ChatSession.READ_TOOLS.includes(toolName)) return false
    // The book tools a discussion in a book comes with only read, and only that book.
    if (this.bookAnchored() && BOOK_READ_TOOLS.has(toolName)) return false
    if (toolName === 'read_image' || toolName === 'look_at_drawing' || toolName === 'questions')
      return false

    // The one write with a mode of its own. It touches a single passage the person pointed
    // at, so letting it run unattended is a reasonable thing to want without opening up
    // `edit` on the whole vault. Anything short of `auto` falls through to the write rule.
    if (toolName === EDIT_SELECTION_TOOL) {
      if ((this.toolModes.value[EDIT_SELECTION_TOOL] ?? 'ask') === 'auto') return false
    }

    // Feature writes need both their own mode and the ordinary write permission.
    if (DECK_WRITE_TOOLS.includes(toolName) && this.getToolMode(toolName) !== 'auto') return true

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
    return (
      (permissionKey ? this.toolModes.value[permissionKey] : this.getToolMode(toolName)) !== 'auto'
    )
  }

  // ── Event handling ───────────────────────────��──────────────────

  private handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'reconnecting':
        this.reconnecting.value = event.state
        break
      case 'message_start':
        this.streamingContent.value = ''
        this.streamingThinking.value = ''
        this.streamStartTime = 0
        break
      case 'stream_event': {
        const se = event.event
        if (se.type === 'text_delta') {
          if (!this.streamStartTime) this.streamStartTime = Date.now()
          this.streamingContent.value += se.delta
        } else if (se.type === 'thinking_delta') {
          this.streamingThinking.value += se.delta
        } else if (se.type === 'error') {
          this.errorPresentation.value = se.error ? null : uiMessage('streamBError.545311af41')
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
            content: textParts.map((translationItem) => translationItem.text).join(''),
            thinking: thinkingParts.length
              ? thinkingParts.map((translationItem) => translationItem.thinking).join('')
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
          if (msg.isError && !msg.interruption) {
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

      case 'tool_interrupted': {
        this.showInterruptedCall(event.call, event.interruption)
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
          // tool_start follows the permission check; running is not a request for approval.
          toolStatus: 'approved',
          timestamp: Date.now(),
        }
        this.appendChatMessage(chatMsg)
        this.updateVisibleMessages()
        break
      }

      case 'tool_end': {
        this.updateChatMessage(
          (m) => m.role === 'tool-call' && m.toolCallId === event.toolCallId,
          (m) => {
            const resultText = event.result.content?.map((c) => c.text).join('') || ''
            const diff = (event.result.details as ToolWriteDetails)?.diff
            return {
              ...m,
              toolResult: resultText,
              toolExecution: undefined,
              toolDiff: diff ? { old: diff.old, new: diff.new } : undefined,
              toolMap: (event.result.details as ToolMapDetails)?.map,
              replyProposal: (event.result.details as { replyProposal?: ReplyProposal })
                ?.replyProposal,
              nodeAccessRefusal: event.isError
                ? nodeAccessRefusalOf(event.result.details)
                : undefined,
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
    this.localRevision++
    msg.parentId = this.activeLeafId || undefined
    if (this.pendingBranchCut) {
      if (msg.parentId !== this.pendingBranchCut)
        throw new UiError(uiMessage('streamBError.cf2e4ddaac'))
      msg.branchCutAfter = this.pendingBranchCut
      this.pendingBranchCut = undefined
    }
    this.allChatMessages.push(msg)
    this.activeLeafId = msg.id
  }

  private rememberInternal(...messages: Message[]): void {
    this.localRevision++
    this.allInternalMessages.push(...messages)
  }

  updateVisibleMessages(): void {
    this.localRevision++
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
        if (msg.chatMessageId) {
          lastLinkedId = msg.chatMessageId
          // Results checkpoint before their injections enter history. Bind ownership now,
          // while the result is present, so later checkpoints and persisted branches keep it.
          for (const injected of msg.injectMessages ?? [])
            injected.chatMessageId = msg.chatMessageId
        }
      } else if (!msg.chatMessageId && lastLinkedId) {
        // Batch injections follow all results, but still belong to their originating call.
        const owner = newMsgs.find(
          (m) => m.role === 'toolResult' && m.injectMessages?.includes(msg)
        )
        msg.chatMessageId = owner?.chatMessageId || lastLinkedId
      }
    }
  }

  // ── Agent loop execution ──────────────────────────────────────

  private getBranchInternalMessages(): Message[] {
    const path = this.activeLeafId
      ? getPathToLeaf(this.allChatMessages, this.activeLeafId)
      : this.allChatMessages
    const projected = projectBranchCuts(path, this.allInternalMessages, this.pendingBranchCut)
    return getInternalMessagesForPath(path, projected)
  }

  private getMessagesForModel(): Message[] {
    const path = this.activeLeafId
      ? getPathToLeaf(this.allChatMessages, this.activeLeafId)
      : this.allChatMessages
    const internal = projectInterruptedTools(
      this.getBranchInternalMessages(),
      new Map(
        path.flatMap((m) =>
          m.toolCallId && m.toolExecution ? [[m.toolCallId, m.toolExecution]] : []
        )
      )
    )

    for (let i = internal.length - 1; i >= 0; i--) {
      const m = internal[i]
      if (m.role === 'system' && m.content.startsWith(ChatSummarizer.COMPACT_MARKER)) {
        return projectBindingHistory(path, projectReplyHistory(path, internal.slice(i)))
      }
    }
    return projectBindingHistory(path, projectReplyHistory(path, internal))
  }

  /**
   * A turn, tried again by itself when the failure was the sort that passes on its own.
   *
   * Off unless asked for. What it repeats is decided by `isTransient`: a rate limit or a
   * dropped connection is worth another go, a rejected key is not — that would be the same
   * refusal five times over with a growing wait between them.
   */
  private async runAgentLoop(): Promise<void> {
    this.turnStartedAt = Date.now()
    this.activeAgentTurns.value++
    const endBackgroundTurn = mobileBackground.beginTurn()
    const interruptedTools = Object.entries(this.attention.value.tools ?? {})
      .filter(([, phase]) => phase === 'interrupted')
      .map(([id]) => id)
    const generation = this.generation
    this.turnAborted = false
    const question = this.attention.value.question
    if (question?.status === 'interrupted') {
      // An explicit new turn ends a lost questionnaire; there is no old resolver to answer.
      this.attention.value = {
        ...this.attention.value,
        question: { ...question, status: 'cancelled' },
        resolved: [...new Set([...(this.attention.value.resolved ?? []), question.id])],
      }
    }
    try {
      const settings = { ...DEFAULT_RETRY, ...(AbeleConfig.getInstance().ai.autoRetry ?? {}) }
      for (let attempt = 0; ; attempt++) {
        await this.runAgentLoopOnce()

        const failure = this.error.value
        if (
          interruptedTools.length &&
          !failure &&
          !this.turnAborted &&
          !this.destroyed &&
          generation === this.generation &&
          !this.pendingToolCalls.value.length &&
          !this.pendingQuestions.value
        ) {
          this.attention.value = {
            ...this.attention.value,
            tools: {
              ...this.attention.value.tools,
              ...Object.fromEntries(interruptedTools.map((id) => [id, 'done' as const])),
            },
            resolved: [...new Set([...(this.attention.value.resolved ?? []), ...interruptedTools])],
          }
        }
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
    } finally {
      this.activeAgentTurns.value--
      endBackgroundTurn()
      if (this.error.value && !this.destroyed && !this.turnAborted)
        this.recordAttentionError(this.error.value)
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
    const controller = new AbortController()
    this.turnAbortController = controller
    this.turnAborted = false
    this.resumeDelegationWake()
    const generation = this.generation
    this.isStreaming.value = true
    this.streamingContent.value = ''
    this.streamingThinking.value = ''
    this.errorPresentation.value = null
    this.error.value = null
    // Give a new conversation a durable reference during a long first request. Fast turns
    // still use their ordinary single save; later transitions use the small local index.
    if (!this.currentChatFile.value && this.allChatMessages.length) this.markDirty()

    try {
      const model = this.resolveModel()
      if (!model) {
        this.errorPresentation.value = this.agent.value
          ? uiMessage('streamBError.338214ff83', { v0: this.agent.value.name })
          : uiMessage('streamBError.a07cc0a057')
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

      // Whatever the last turn read is in the history now, or went with a turn that was stopped.
      this.readGuard.settle()
      this.results.settle()
      this.agentLoop = new AgentLoop()
      this.unsubscribe = this.agentLoop.subscribe((event) => {
        if (!this.destroyed && generation === this.generation) this.handleAgentEvent(event)
      })

      const toSend = this.getMessagesForModel()
      let committed = toSend.length
      const checkpoint = (messages: Message[]) => {
        const added = messages.slice(committed)
        this.linkInternalMessages(added)
        this.rememberInternal(...added)
        committed = messages.length
      }
      const systemPrompt = await this.chatService.getSystemPrompt(this)
      const result = await this.agentLoop.run({
        model,
        systemPrompt,
        tools,
        getTools: () => this.getTools(),
        hiddenTool: (name) => this.hiddenTool(name),
        missingTool: (name) => this.missingToolHint(name),
        messages: toSend,
        onHistory: (messages) => {
          if (this.destroyed || generation !== this.generation) return
          checkpoint(messages)
          this.markDirty()
        },
        streamOptions: {
          ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
          signal: controller.signal,
        },
        beforeIteration: () => this.takeQueued(),
        prepareMessages: async (messages) => {
          if (this.destroyed || generation !== this.generation || controller.signal.aborted)
            return messages
          // The loop has completed all calls and their injected messages. Publish them
          // before summarizing, not only when the entire agent turn eventually ends.
          checkpoint(messages)
          await this.summarizer.autoCompactIfNeeded({
            atIterationBoundary: true,
            systemPrompt,
            signal: controller.signal,
          })
          return this.getMessagesForModel()
        },
        beforeToolCall: async (toolName, _id, args, permissionKey, destinationKey) => {
          // Refused before anyone is asked: approving a write that cannot run wastes a click.
          const refused = await this.readGuard.check(toolName, args)
          if (refused) return { block: true, reason: refused }
          if (!this.needsApproval(toolName, args, permissionKey)) return

          // A run has nobody to ask, so a tool that would need approval is refused with a
          // reason the agent can read and work around, rather than hanging forever.
          if (this.kind === 'run') {
            return { block: true, reason: this.refusalReason(toolName, args) }
          }
          const decided = await this.policyFor(_id, toolName, args, permissionKey, destinationKey)
          // Stopped while the script decided: ask, which a stopped turn never gets to.
          if (!this.turnPolicy.active) return { pause: true }
          if (decided.kind === 'deny') return { block: true, reason: decided.reason }
          if (decided.kind === 'approve') {
            this.widenScopeFor(toolName, args)
            return
          }
          return { pause: true }
        },
      })

      if (this.destroyed || generation !== this.generation) return
      // Requests may have used compacted context; the loop result remains the full history.
      checkpoint(result.messages)

      if (result.pausedAt?.length) {
        this.pendingToolCalls.value = result.pausedAt.map((tc) => ({
          ...tc,
          permissionKey:
            tc.permissionKey ?? tools.find((tool) => tool.name === tc.name)?.permissionKey,
          destinationKey:
            tc.destinationKey ?? tools.find((tool) => tool.name === tc.name)?.destinationKey,
        }))
        await this.processAllPendingToolCalls()
      }
    } catch (err: unknown) {
      if (controller.signal.aborted || this.destroyed || generation !== this.generation) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      const errObj = err instanceof Error ? err : new Error(String(err))
      if (errObj.name === 'AbortError') return
      this.errorPresentation.value = errObj.message
        ? uiErrorMessage(errObj)
        : uiMessage('streamBError.0f56130f3d')
      this.error.value = errObj.message || 'An unknown error occurred'
      console.error('[Abele AI]', err)
    } finally {
      if (this.turnAbortController === controller) this.turnAbortController = null
      this.reconnecting.value = null
      this.isStreaming.value = false
      // The caller commits the completed turn. Do not leave a second delayed write behind
      // or retry a failed write within the same turn merely because this timer was pending.
      if (this.persistTimer !== null) {
        window.clearTimeout(this.persistTimer)
        this.persistTimer = null
      }
      this.unsubscribe?.()
      this.unsubscribe = null
      this.agentLoop = null
      if (this.stopMarkPending) {
        this.stopMarkPending = false
        if (!this.destroyed) this.appendStopMark()
      }
    }
  }

  private appendStopMark() {
    this.appendChatMessage({
      id: nanoid(),
      role: 'system',
      content: t('streamB.stoppedByYou'),
      timestamp: Date.now(),
    })
    this.updateVisibleMessages()
    this.markDirty()
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
      // Busy from the first look at the queue: an interceptor script may take a moment to
      // answer for a call, and the chat must not read as idle while it does.
      this.isExecutingTool.value = true
      while (this.pendingToolCalls.value.length > 0) {
        const tc = copyPendingCall(this.pendingToolCalls.value[0])
        if (head && head.id !== tc.id) {
          this.ensurePendingToolCallMessage(tc)
          this.markDirty()
          return
        }
        const args = head?.args ?? copyToolArgs(tc.arguments)

        const identityRefusal = pendingMcpToolRefusal(tc, AbeleConfig.getInstance().ai.mcpServers)
        if (identityRefusal) {
          this.ensurePendingToolCallMessage(tc)
          this.recordRefusal(tc, identityRefusal)
          head = undefined
          continue
        }

        if (!head && this.needsApproval(tc.name, tc.arguments, tc.permissionKey)) {
          // The interceptor script may answer for the person: the same question, decided once.
          const gen = this.generation
          let decided = await this.policyFor(
            tc.id,
            tc.name,
            tc.arguments,
            tc.permissionKey,
            tc.destinationKey
          )
          if (!this.samePendingCall(tc)) {
            this.showRemainingPending()
            return
          }
          // Stopped or cleared while the script decided: its answer no longer holds.
          if (gen !== this.generation || !this.turnPolicy.active) decided = { kind: 'ask' }
          if (decided.kind === 'deny') {
            this.ensurePendingToolCallMessage(tc)
            this.recordRefusal(tc, decided.reason)
            continue
          }
          if (decided.kind === 'ask') {
            this.ensurePendingToolCallMessage(tc)
            this.markDirty()
            return // Wait for user approve/reject
          }
          this.widenScopeFor(tc.name, tc.arguments)
          this.updateChatMessage(
            (m) => m.toolCallId === tc.id && m.toolStatus === 'pending',
            (m) => ({ ...m, toolStatus: 'approved' as const })
          )
        }

        // Reevaluate before publishing the next call: automatic and interceptor-approved
        // calls must never enter the pending state, even while execution is awaiting I/O.
        this.ensurePendingToolCallMessage(tc, 'approved')

        const controller = new AbortController()
        this.toolAbortController = controller
        this.isExecutingTool.value = true
        try {
          this.attention.value = {
            ...this.attention.value,
            tools: { ...this.attention.value.tools, [tc.id]: 'executing' },
          }
          this.markDirty()
          // Commit the accepted identity before admitting an operation. A crash must not
          // offer the same already-started tool as a fresh approval after restart.
          await this.save()
          if (!this.samePendingCall(tc)) {
            this.showRemainingPending()
            return
          }
          if (
            this.kind !== 'run' &&
            (this.persistFailed ||
              (this.currentChatFile.value &&
                this.committedAttention.tools?.[tc.id] !== 'executing'))
          ) {
            const tools = { ...this.attention.value.tools }
            delete tools[tc.id]
            this.attention.value = { ...this.attention.value, tools }
            this.updateChatMessage(
              (m) => m.toolCallId === tc.id,
              (m) => ({ ...m, toolStatus: 'pending' })
            )
            throw new UiError(uiMessage('streamBError.55409a75b4'))
          }
          if (controller.signal.aborted) {
            this.settleInterruptedCall(tc, 'not-run')
            this.markDirty()
            return
          }
          await this.executeCurrentPendingTool(tc, args, controller.signal, !!head)
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

  private ensurePendingToolCallMessage(
    tc: ToolCallContent,
    status: 'pending' | 'approved' = 'pending'
  ): void {
    // Provider IDs may repeat across responses. Only reuse a row from this response's
    // visible batch; an older completed call must never become the stopped request.
    const path = this.messages.value
    const assistantIndex = path.findLastIndex((m) => m.role === 'assistant')
    const exists = path.slice(assistantIndex + 1).some((m) => m.toolCallId === tc.id)
    if (exists) {
      if (status === 'approved')
        this.updateChatMessage(
          (m) => m.toolCallId === tc.id && m.toolStatus === 'pending',
          (m) => ({ ...m, toolStatus: 'approved' as const })
        )
      return
    }

    const chatMsg: ChatMessage = {
      id: nanoid(),
      role: 'tool-call',
      content: `Calling ${tc.name}`,
      toolCallId: tc.id,
      toolName: tc.name,
      toolParams: tc.arguments,
      toolStatus: status,
      timestamp: Date.now(),
    }
    this.appendChatMessage(chatMsg)
    this.updateVisibleMessages()
  }

  private showInterruptedCall(tc: ToolCallContent, interruption: ToolInterruption): void {
    this.ensurePendingToolCallMessage(tc)
    this.updateChatMessage(
      (m) => m.role === 'tool-call' && m.toolCallId === tc.id,
      (m) => ({ ...m, toolStatus: 'rejected', toolExecution: interruption, toolResult: undefined })
    )
  }

  private settleInterruptedCall(tc: ToolCallContent, interruption: ToolInterruption): void {
    this.showInterruptedCall(tc, interruption)
    const chatMessageId = this.messages.value.findLast((m) => m.toolCallId === tc.id)?.id
    this.rememberInternal({ ...interruptedToolResult(tc, interruption), chatMessageId })
    this.pendingToolCalls.value = this.pendingToolCalls.value.filter((call) => call.id !== tc.id)
    this.attention.value = {
      ...this.attention.value,
      tools: { ...this.attention.value.tools, [tc.id]: 'done' },
    }
    this.markDirty()
  }

  private samePendingCall(call: ToolCallContent): boolean {
    const queued = this.pendingToolCalls.value.find((tc) => tc.id === call.id)
    return (
      !!queued &&
      queued.name === call.name &&
      queued.permissionKey === call.permissionKey &&
      queued.destinationKey === call.destinationKey &&
      JSON.stringify(queued.arguments) === JSON.stringify(call.arguments)
    )
  }

  private showRemainingPending(): void {
    const next = this.pendingToolCalls.value[0]
    if (next) this.ensurePendingToolCallMessage(next)
    this.markDirty()
  }

  private async executeCurrentPendingTool(
    tc: ToolCallContent,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    approved = false
  ): Promise<void> {
    if (!this.samePendingCall(tc)) {
      this.showRemainingPending()
      return
    }

    const tools = this.getTools()
    // The person approved this very call: a tool its modes allow runs even if its section is
    // not in the current offer, as a call stopped for approval before the open was saved.
    const tool =
      tools.find((translationItem) => translationItem.name === tc.name) ??
      this.hiddenTool(tc.name) ??
      this.wrapToolsForSession(
        (this.lastOffer?.sections ?? [])
          .flatMap((s) => s.tools)
          .filter((translationItem) => translationItem.name === tc.name)
      )[0]
    const identityRefusal = pendingMcpToolRefusal(tc, AbeleConfig.getInstance().ai.mcpServers)
    if (
      identityRefusal ||
      (tc.permissionKey &&
        (tool?.permissionKey !== tc.permissionKey || tool?.destinationKey !== tc.destinationKey))
    ) {
      this.recordRefusal(
        tc,
        identityRefusal || 'The MCP tool changed or no longer exists. Ask for a new tool call.'
      )
      return
    }
    if (!tool) {
      const errText = this.missingToolHint(tc.name) ?? `Tool "${tc.name}" not found`
      const toolChatMsg = this.allChatMessages.find(
        (m) => m.role === 'tool-call' && m.toolCallId === tc.id
      )
      this.updateChatMessage(
        (m) => m.role === 'tool-call' && m.toolCallId === tc.id,
        (m) => ({ ...m, toolResult: errText, toolStatus: 'rejected' as const })
      )
      this.rememberInternal({
        role: 'toolResult',
        toolCallId: tc.id,
        toolName: tc.name,
        content: [{ type: 'text', text: errText }],
        isError: true,
        timestamp: Date.now(),
        chatMessageId: toolChatMsg?.id,
      })
      this.pendingToolCalls.value = this.pendingToolCalls.value.filter((next) => next.id !== tc.id)
      return
    }

    // Execute
    let toolResult: AgentToolResult
    let isError = false
    if (signal?.aborted) {
      this.settleInterruptedCall(tc, 'not-run')
      return
    }
    try {
      toolResult = await tool.execute(tc.id, args, signal, {
        scope: this.scopeResolver,
        interactive: this.kind !== 'run',
        approved,
      })
    } catch (err: unknown) {
      if (signal?.aborted) {
        this.settleInterruptedCall(tc, 'interrupted')
        return
      }
      toolResult = failedToolResult(err)
      isError = true
    }

    const modelContent = [...toolResult.content]
    if (JSON.stringify(args) !== JSON.stringify(tc.arguments)) {
      // Guidance for the model, never shown to the person, so it stays in English.
      const editedNote = `The user edited the approved action. Actual arguments executed: ${JSON.stringify(args)}. Describe the actual result, using these values rather than the original proposal.`
      modelContent.push({ type: 'text', text: editedNote })
    }

    const toolChatMsg = this.allChatMessages.find(
      (m) => m.role === 'tool-call' && m.toolCallId === tc.id
    )

    this.updateChatMessage(
      (m) => m.role === 'tool-call' && m.toolCallId === tc.id,
      (m) => {
        const resultText = toolResult.content.map((c) => c.text).join('')
        const diff = (toolResult.details as ToolWriteDetails)?.diff
        const imagePath = (toolResult.details as { imagePath?: unknown } | undefined)?.imagePath
        return {
          ...m,
          toolParams: copyToolArgs(args),
          toolResult: resultText,
          toolExecution: undefined,
          toolImagePath: !isError && typeof imagePath === 'string' ? imagePath : undefined,
          toolDiff: diff ? { old: diff.old, new: diff.new } : undefined,
          toolMap: (toolResult.details as ToolMapDetails)?.map,
          replyProposal: (toolResult.details as { replyProposal?: ReplyProposal })?.replyProposal,
          nodeAccessRefusal: isError ? nodeAccessRefusalOf(toolResult.details) : undefined,
          toolStatus: isError ? ('rejected' as const) : ('approved' as const),
        }
      }
    )

    this.rememberInternal({
      role: 'toolResult',
      toolCallId: tc.id,
      toolName: tc.name,
      content: modelContent,
      isError,
      timestamp: Date.now(),
      chatMessageId: toolChatMsg?.id,
      ...(toolResult.reads?.length ? { reads: toolResult.reads } : {}),
      ...(toolResult.stored ? { stored: toolResult.stored } : {}),
    })

    if (toolResult.injectMessages?.length) {
      for (const injected of toolResult.injectMessages) {
        injected.chatMessageId = toolChatMsg?.id
      }
      this.rememberInternal(...toolResult.injectMessages)
    }

    this.attention.value = {
      ...this.attention.value,
      tools: { ...this.attention.value.tools, [tc.id]: 'done' },
    }
    this.pendingToolCalls.value = this.pendingToolCalls.value.filter((next) => next.id !== tc.id)
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
  async addUserNote(content: string, replyTo?: ChatReplyTo[]): Promise<boolean> {
    // Nothing may be pushed into the middle of a turn — see `isMidTurn`. `sendMessage` can
    // queue instead; a note has nothing to be queued for, since nothing is going to run.
    if (this.isMidTurn) return false

    const text = replyTo?.length ? content : content.trim()
    if (!text.trim() && !replyTo?.length) return false

    this.rememberInternal(await this.userMessage(text, undefined, false, replyTo))
    await this.save()
    return true
  }

  /** An automatic result notification is not permission to resume a stopped chat. */
  wakeDelegationResult(id: string, notice?: string): boolean {
    if (this.destroyed || this.delegationWakeStopped || this.preparingClone.value) return false
    const wake: DelegationWakeFence = {
      sessionId: this.id,
      generation: this.generation,
      stopEpoch: this.delegationStopEpoch,
    }
    void this.sendMessage(
      notice ??
        `The result for node delegation ${id} has arrived. Call node_delegation_status to read the durable mailbox result.`,
      undefined,
      wake
    ).catch((error) => {
      console.error('[Abele] Delegation result notification failed', error)
    })
    return true
  }

  private isDelegationWakeCurrent(wake: DelegationWakeFence): boolean {
    return (
      !this.destroyed &&
      !this.delegationWakeStopped &&
      wake.sessionId === this.id &&
      wake.generation === this.generation &&
      wake.stopEpoch === this.delegationStopEpoch
    )
  }

  /** Keep ordinary user messages, but drop wakes from a stopped or replaced session. */
  private currentQueuedMessages(): QueuedMessage[] {
    const queued = this.queuedMessages.value
    const current = queued.filter(
      (q) => !q.delegationWake || this.isDelegationWakeCurrent(q.delegationWake)
    )
    if (current.length !== queued.length) {
      this.queuedMessages.value = current
      this.markDirty()
    }
    return current
  }

  private resumeDelegationWake(): void {
    this.delegationWakeStopped = false
    const parent = this.delegationParentId
    if (parent) NodeService.resumeDelegationWaiters(parent)
  }

  async sendMessage(
    content: string,
    attachments?: string[],
    delegationWake?: DelegationWakeFence,
    replyTo?: ChatReplyTo[]
  ): Promise<void> {
    const isCurrent = delegationWake
      ? () => this.isDelegationWakeCurrent(delegationWake)
      : undefined
    if (isCurrent && !isCurrent()) return
    if (this.preparingClone.value) {
      new Notice(t('streamB.waitForTheChatCopyToFinish.389500'))
      return
    }
    // Only a new explicit send can resume after Stop; automatic mailbox sends carry a fence.
    if (!isCurrent) this.resumeDelegationWake()
    // Busy is not a reason to lose what was typed: it waits its turn instead. `takeQueued`
    // hands it to the loop that is already running, at its next iteration; `drainQueue` gives
    // it a turn of its own when the one it waited behind ends without another iteration.
    if (this.isBusy) {
      this.queuedMessages.value = [
        ...this.queuedMessages.value,
        {
          id: nanoid(),
          content,
          attachments: attachments?.length ? [...attachments] : undefined,
          ...(replyTo?.length ? { replyTo: replyTo.map((to) => ({ ...to })) } : {}),
          ...(delegationWake ? { delegationWake: { ...delegationWake } } : {}),
        },
      ]
      await this.save()
      return
    }

    // The interceptor looks first, when there is one and the message is its kind. Never in a
    // run, where nobody is there to send a draft on.
    if (!isCurrent && this.interceptorHolds(content)) {
      this.errorPresentation.value = null
      this.error.value = null
      return sendThroughChain(this.scriptSendHost(), content, attachments, replyTo)
    }

    const gen = this.generation
    this.errorPresentation.value = null
    this.error.value = null
    this.userMessageCount++
    this.wroteThisTurn = false
    this.turnPolicy.clear()

    const message = await this.userMessage(content, attachments, !isCurrent, replyTo)
    // Stop may arrive while attachments/message preparation is awaiting I/O.
    if (isCurrent && !isCurrent()) return
    this.rememberInternal(message)

    try {
      await this.runAgentLoop()

      if (gen !== this.generation) return

      // A turn just ended: a natural point to be sure the disk has it.
      await this.save()

      await this.checkAnswer()
      await this.afterTurn()
    } finally {
      this.endTurnPolicy()
      // Whatever became of the turn — an answer, a bare tool call, an error, a title that
      // failed to generate — what was typed while it ran is what comes next.
      await this.drainQueue()
    }
  }

  /** The interceptors that would read a message as typed, in their order. Never in a run. */
  private messageReaders(content: string): InterceptorEntry[] {
    if (this.kind === 'run') return []
    return this.interceptor
      .chain('message')
      .filter((e) => matchesPattern(e.pattern, content).matches)
  }

  /** Some interceptor would hold the message, rather than only comment beside it. */
  private interceptorHolds(content: string): boolean {
    return this.messageReaders(content).some((e) => !e.replyOnly)
  }

  /**
   * The interceptor reads the answer a turn just finished and may put its own text in its place,
   * by itself, asking nobody. The replacement is a revision of the reply, so the next turn, a
   * retry, a branch and the reply window all see it, and the agent's own text stays beside it.
   * A failure, a timeout or Stop keeps the answer and says why under it. Only the final text
   * changes; what the turn's tools did stays done. Delegated runs never check: nobody is there.
   */
  private async checkAnswer(): Promise<void> {
    if (this.kind === 'run' || this.destroyed || this.turnAborted || this.error.value) return
    if (this.pendingToolCalls.value.length || this.pendingQuestions.value) return
    const answer = this.messages.value.at(-1)
    if (answer?.role !== 'assistant' || answer.draft || !answer.content.trim()) return
    if (answer.timestamp < this.turnStartedAt || this.answersChecked.has(answer.id)) return
    const chain = this.interceptor.chain('answer')
    if (!anyReads(chain, answer.content)) return
    this.answersChecked.add(answer.id)

    const generation = this.generation
    const gone = () => this.destroyed || generation !== this.generation
    try {
      await this.save()
      // One after another, each given the answer as the one before left it. One that fails or is
      // stopped keeps the answer as it stands, and the ones after it do not read it.
      await runChain<null>(chain, 0, answer.content, async ({ entry, at, of, broken }, text) => {
        if (gone()) return { kind: 'stop', result: null }
        const by = this.interceptor.nameOf(entry)
        const { replyOnly: _held, ...route } = this.interceptor.routeOf(entry, broken)
        const current = this.findMessage(answer.id) ?? answer
        const input =
          route.kind === 'script'
            ? buildAnswerInput(current, this.interceptSource(this.messages.value))
            : null
        this.answerCheck.value = { id: answer.id, by, ...(of > 1 ? { at, of } : {}) }
        const outcome = await this.interceptor.checkAnswer(route, current, input)
        if (gone()) return { kind: 'stop', result: null }
        console.debug('[Abele interceptor] answer', { by, at, of, outcome: outcome.kind })
        const lines = broken
          ? [`The pattern does not compile (${broken}), so every answer is checked.`]
          : []
        if ('note' in outcome && outcome.note) lines.push(outcome.note)
        let next: string | null = text
        if (outcome.kind === 'replace') {
          try {
            await this.writeReplyChange(answer.id, (message) =>
              interceptorRevision(message, outcome.text, by, Date.now())
            )
            next = outcome.text
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err)
            lines.push(`Not replaced: ${reason} The answer stays as it was.`)
            next = null
          }
        } else if (outcome.kind === 'failed') {
          lines.push(`Not checked: ${outcome.reason}. The answer stays as it was.`)
          next = null
        } else if (outcome.kind === 'stopped') {
          lines.push('Not checked: stopped. The answer stays as it was.')
          next = null
        }
        if (next === null && at < of) lines.push('The interceptors after it did not read it.')
        if (lines.length) await this.noteUnderAnswer(answer.id, by, route.kind === 'script', lines)
        return next === null ? { kind: 'stop', result: null } : { kind: 'pass', text: next }
      })
    } finally {
      this.answerCheck.value = null
    }
  }

  /** The interceptor's lines under an answer it checked, in the side conversation messages use. */
  private async noteUnderAnswer(
    id: string,
    by: string,
    script: boolean,
    lines: string[]
  ): Promise<void> {
    const at = Date.now()
    this.updateChatMessage(
      (m) => m.id === id,
      (m) => ({
        ...m,
        interceptorName: by,
        ...(script ? { interceptorScript: true } : {}),
        interceptorCollapsed: false,
        interceptorChat: [
          ...(m.interceptorChat ?? []),
          ...lines.map((content) => ({
            id: nanoid(),
            role: 'assistant' as const,
            content,
            timestamp: at,
            by,
          })),
        ],
      })
    )
    this.updateVisibleMessages()
    await this.save()
  }

  /**
   * The work a finished turn leaves behind: a title, a summary, a recap, a compaction.
   */
  private async afterTurn(): Promise<void> {
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

    if (this.kind === 'chat' && ChatSession.SUMMARY_TRIGGERS.includes(this.userMessageCount)) {
      if (sequential) await this.summarizer.generateSummary()
      else {
        this.summarizer.generateSummary().catch(() => {
          return
        })
      }
    }

    // A recap describes what the chat did to a note, so unlike a title it is regenerated on
    // every turn that wrote, not once. The mirror follows it, since the sentence is part of
    // what the card under the note shows.
    if (this.wantsRecap()) {
      if (sequential) await this.summarizer.generateRecap()
      else {
        this.summarizer.generateRecap().catch(() => {
          return
        })
      }
      // Ahead of the recap rather than after it: the links are already known, and the
      // sentence, when it lands, mirrors itself through the save `generateRecap` makes.
      this.mirrorNoteLinks()
    }

    if (this.turnAborted) return
    if (sequential) {
      await this.summarizer.autoCompactIfNeeded()
    } else {
      this.summarizer.autoCompactIfNeeded().catch(() => {
        return
      })
    }
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
    if (this.isBusy) return
    if (this.pendingToolCalls.value.length) return

    const [next, ...rest] = this.currentQueuedMessages()
    if (!next) return

    this.queuedMessages.value = rest
    await this.sendMessage(next.content, next.attachments, next.delegationWake, next.replyTo)
  }

  /**
   * Put a message from the person into the conversation.
   *
   * The chat bubble is appended here; the message the model will be shown is returned rather
   * than stored, because where it belongs depends on whether a loop is already running — a
   * fresh turn pushes it into the history, an injected one lets the loop carry it.
   */
  private async userMessage(
    content: string,
    attachments?: string[],
    review = true,
    replyTo?: ChatReplyTo[]
  ): Promise<Message> {
    const userMsg: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content,
      attachments: attachments?.length ? attachments : undefined,
      ...(replyTo?.length ? { replyTo: replyTo.map((to) => ({ ...to })) } : {}),
      timestamp: Date.now(),
    }
    // Reply-only interceptors comment beside it, one after another, the turn never waiting.
    const readers = review ? this.messageReaders(content).filter((e) => e.replyOnly) : []
    // Snapshot before this bubble joins the conversation, just like a blocking script sees it.
    const input = readers.some((e) => e.script)
      ? buildInterceptInput(
          { text: content, attachments: attachments ?? [] },
          this.interceptSource(this.messages.value)
        )
      : null
    this.appendChatMessage(userMsg)
    this.updateVisibleMessages()
    for (const entry of readers) {
      const route = this.interceptor.routeOf(entry)
      // A separate request, never awaited by the main turn (including queued injections).
      const reviewing =
        route.kind === 'script' && input
          ? this.interceptor.reviewScriptReply(userMsg.id, route, input)
          : this.interceptor.reviewReply(userMsg.id, entry)
      void reviewing.catch((err) => {
        console.error('[Abele interceptor save]', err)
      })
    }
    return this.modelMessage(userMsg)
  }

  /**
   * The message the model is shown for a person's bubble: what it says, where its links point,
   * and what is attached to it, read. One builder for a message sent at once and for a draft
   * sent after its interceptor, so the two never differ in what the agent is told.
   */
  private async modelMessage(bubble: ChatMessage): Promise<Message> {
    const content = bubble.content
    const attachments = bubble.attachments
    // The model is told where each link points, and which places of earlier answers the
    // question replies to; the bubble keeps what was typed.
    const text =
      agentReplyText(content, bubble.replyTo) +
      linkedNotesNote(content, GlobalStore.getInstance().app, this.scopeResolver)

    if (attachments?.length) {
      // A picture explicitly sent to the agent is also a file its editing tools may use.
      for (const path of attachments) {
        if (isImagePath(path) || isHeicImport(path)) this.scopeResolver.addFile(path)
      }
      // An attached note is read: its text is in the message.
      const reads: ReadMark[] = []
      const parts = await resolveAttachmentsForApi(attachments, (seen) =>
        reads.push({ ...seen, at: Date.now(), via: 'attachment' })
      )
      const allParts: UserContentPart[] = [{ type: 'text', text }, ...parts]
      this.readGuard.note(reads)
      return {
        role: 'user',
        content: allParts,
        timestamp: Date.now(),
        chatMessageId: bubble.id,
        ...(reads.length ? { reads } : {}),
      }
    }
    return { role: 'user', content: text, timestamp: Date.now(), chatMessageId: bubble.id }
  }

  /**
   * Everything queued since the loop started, as messages for the model.
   *
   * Emptied before the messages are built so that anything typed while this is running waits
   * for the iteration after, rather than being handed over twice.
   */
  private async takeQueued(): Promise<Message[]> {
    const queued = this.currentQueuedMessages()
    // Only the run of messages at the front that the interceptor would not look at: one it
    // would look at waits for its own turn, through `drainQueue` and `sendMessage`, rather
    // than slipping into this one past it. Order is kept, so nothing behind it goes first.
    const cut = queued.findIndex((q) => !q.delegationWake && this.interceptorHolds(q.content))
    const taken = cut === -1 ? queued : queued.slice(0, cut)
    if (!taken.length) return []
    this.queuedMessages.value = cut === -1 ? [] : queued.slice(cut)

    // The interceptor script's say was about the message it saw; this one it never saw.
    this.turnPolicy.clear()

    const messages: Message[] = []
    for (const q of taken) {
      if (q.delegationWake && !this.isDelegationWakeCurrent(q.delegationWake)) continue
      const message = await this.userMessage(q.content, q.attachments, !q.delegationWake, q.replyTo)
      // Stop can win while message/attachment preparation is pending, after dequeue.
      if (q.delegationWake && !this.isDelegationWakeCurrent(q.delegationWake)) continue
      messages.push(message)
    }
    return messages
  }

  /** Drop what is waiting and hand it back, for whoever stopped the agent to keep. */
  takeQueuedMessages(): QueuedMessage[] {
    const queued = this.queuedMessages.value
    this.queuedMessages.value = []
    if (queued.length) this.markDirty()
    return queued
  }

  removeQueuedMessage(id: string): void {
    this.queuedMessages.value = this.queuedMessages.value.filter((m) => m.id !== id)
    this.markDirty()
  }

  async approveToolCall(
    modifiedArgs?: Record<string, unknown>,
    alwaysAllow = false,
    expectedCallId?: string
  ): Promise<void> {
    if (this.isStreaming.value || this.isExecutingTool.value || this.isCompacting.value) return
    const queued = this.pendingToolCalls.value[0]
    if (!queued || (expectedCallId !== undefined && queued.id !== expectedCallId)) return
    const tc = copyPendingCall(queued)
    const args = copyToolArgs(modifiedArgs ?? tc.arguments)

    const identityRefusal = pendingMcpToolRefusal(tc, AbeleConfig.getInstance().ai.mcpServers)
    if (identityRefusal) {
      this.ensurePendingToolCallMessage(tc)
      this.recordRefusal(tc, identityRefusal)
    } else {
      if (alwaysAllow) {
        const key = tc.permissionKey ?? tc.name
        this.toolModes.value = { ...this.ownToolModes.value, [key]: 'auto' }
      }
      this.updateChatMessage(
        (m) => m.toolCallId === tc.id && m.toolStatus === 'pending',
        (m) => ({ ...m, toolStatus: 'approved' as const })
      )
      this.widenScopeFor(tc.name, args)
    }

    try {
      await this.processAllPendingToolCalls(identityRefusal ? undefined : { id: tc.id, args })
      this.markDirty()
      await this.checkAnswer()
    } finally {
      this.endTurnPolicy()
      // The agent carries on after the answer and may finish there: whatever was typed
      // meanwhile is what comes next.
      await this.drainQueue()
    }
  }

  /** Reject the paused turn as a whole, without the continuation used by Reject. */
  stopFromApproval(expectedCallId?: string): void {
    const pending = this.pendingToolCalls.value
    if (!pending.length || (expectedCallId && !pending.some((tc) => tc.id === expectedCallId)))
      return

    // Match the composer Stop: keep queued human text as a draft, not as a new turn.
    const queued = this.takeQueuedMessages().filter((q) => !q.delegationWake)
    if (queued.length) {
      const draft = this.draft.value
      const files = queued
        .flatMap((q) => q.attachments ?? [])
        .map((path) => GlobalStore.getInstance().app.vault.getAbstractFileByPath(path))
        .filter((file): file is TFile => file instanceof TFile)
      this.draft.value = {
        ...draft,
        text: [...queued.map((q) => composerText(q.content, q.replyTo)), draft.text]
          .filter(Boolean)
          .join('\n'),
        attachments: [
          ...draft.attachments,
          ...files.filter((file) => !draft.attachments.includes(file)),
        ],
      }
    }
    // Fence loops, scripts, retries and delegated wakes before settling any call.
    this.abort()
    this.markDirty()
  }

  abortToolExecution(): void {
    // The tool Stop button stops the parent too, including queued wakes and mailbox waiters.
    this.abort()
  }

  async rejectToolCall(reason?: string): Promise<void> {
    if (this.isStreaming.value) return
    const tc = this.pendingToolCalls.value[0]
    if (!tc) return

    this.recordRefusal(
      tc,
      reason || 'User rejected this action',
      'Do not retry this action unchanged or work around the refusal. Ask the user before attempting it again.'
    )

    try {
      await this.processAllPendingToolCalls()
      this.markDirty()
      await this.checkAnswer()
    } finally {
      this.endTurnPolicy()
      await this.drainQueue()
    }
  }

  /**
   * The call at the head of the queue, refused: its bubble says why, the model is told the same,
   * and the queue moves on. Refused by the person or, for them, by an interceptor script.
   */
  private recordRefusal(tc: ToolCallContent, reasonText: string, modelGuidance?: string): void {
    const toolChatMsg = this.allChatMessages.find(
      (m) => m.toolCallId === tc.id && m.toolStatus === 'pending'
    )
    this.updateChatMessage(
      (m) => m.role === 'tool-call' && m.toolCallId === tc.id,
      (m) => ({
        ...m,
        toolResult: reasonText,
        toolStatus: 'rejected' as const,
        toolExecution: 'not-run' as const,
      })
    )

    this.rememberInternal({
      role: 'toolResult',
      toolCallId: tc.id,
      toolName: tc.name,
      content: [
        { type: 'text', text: modelGuidance ? `${reasonText}. ${modelGuidance}` : reasonText },
      ],
      isError: true,
      timestamp: Date.now(),
      chatMessageId: toolChatMsg?.id,
    })

    this.pendingToolCalls.value = this.pendingToolCalls.value.slice(1)
  }

  /** Existing source-path approval widens access; ZIP's new output is granted only after saving. */
  private widenScopeFor(toolName: string, args: Record<string, unknown> | undefined): void {
    if (
      toolName === 'zip' ||
      toolName.startsWith('node_') ||
      toolName === 'list_node_worktrees' ||
      !args
    )
      return
    const path = (args.path || args.from) as string
    if (path && !this.scopeResolver.isInScope(path)) this.scopeResolver.addFile(path)
  }

  /** What the interceptor script said about a call that would ask; `ask` when it said nothing. */
  private policyFor(
    id: string,
    name: string,
    args: Record<string, unknown> | undefined,
    permissionKey?: string,
    destinationKey?: string
  ) {
    if (name === 'node_propose_edit' || needsSecretApproval(name, args))
      return Promise.resolve({ kind: 'ask' as const })
    return this.turnPolicy.decide(
      id,
      name,
      args ?? {},
      !!this.outOfScopePath(name, args),
      permissionKey,
      destinationKey
    )
  }

  /** The turn is over once nothing is left to answer; the script's say ends with it. */
  private endTurnPolicy(): void {
    if (!this.pendingToolCalls.value.length) this.turnPolicy.clear()
  }

  // ── Questions tool ──────────────────────────────────────────────

  askQuestions(questions: { question: string; options: string[] }[]): Promise<string[] | null> {
    this.attention.value = {
      ...this.attention.value,
      question: {
        id: nanoid(),
        at: Date.now(),
        target: this.activeLeafId ?? undefined,
        status: 'waiting',
        questions,
        currentIndex: 0,
        answers: [],
      },
    }
    this.markDirty()
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
    const saved = this.attention.value.question
    if (saved) {
      this.attention.value = {
        ...this.attention.value,
        question: {
          ...saved,
          answers,
          currentIndex: Math.min(pq.currentIndex + 1, pq.questions.length - 1),
          status: pq.currentIndex + 1 < pq.questions.length ? 'waiting' : 'answered',
        },
        resolved:
          pq.currentIndex + 1 < pq.questions.length
            ? this.attention.value.resolved
            : [...new Set([...(this.attention.value.resolved ?? []), saved.id])],
      }
      this.markDirty()
    }
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
    if (!this.destroyed && !this.restoringAttention && this.attention.value.question) {
      this.attention.value = {
        ...this.attention.value,
        question: { ...this.attention.value.question, status: 'cancelled' },
        resolved: [
          ...new Set([...(this.attention.value.resolved ?? []), this.attention.value.question.id]),
        ],
      }
      this.markDirty()
    }
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

    this.rememberInternal({
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
    const wasRunning =
      !this.destroyed &&
      !this.turnAborted &&
      (this.isStreaming.value ||
        this.isExecutingTool.value ||
        this.pendingToolCalls.value.length > 0)
    if (wasRunning) {
      if (this.agentLoop) this.stopMarkPending = true
      else this.appendStopMark()
    }
    this.delegationWakeStopped = true
    ++this.delegationStopEpoch
    const parent = this.delegationParentId
    if (parent)
      void NodeService.stopDelegationWaiters(parent).catch((error) => {
        console.error('[Abele] Could not clear delegation waiters on Stop', error)
      })
    this.turnAborted = true
    this.cancelAutoRetry()
    this.abortQuestions()
    this.turnAbortController?.abort()
    this.agentLoop?.abort()
    this.toolAbortController?.abort()
    // A script deciding about a message stops too; the message is kept back as a draft.
    this.interceptor.abort()
    this.turnPolicy.clear()
    // A displayed approval queue belongs to a finished loop. Settle it here; a running
    // manual call settles when its execution returns, preserving any completed result.
    for (const call of this.destroyed ? [] : [...this.pendingToolCalls.value]) {
      if (this.attention.value.tools?.[call.id] !== 'executing')
        this.settleInterruptedCall(call, 'not-run')
    }
    if (!this.destroyed && (this.isStreaming.value || this.isExecutingTool.value)) {
      // A non-cancellable call can still be settling. Save completed work and stop outcomes
      // now, without waiting for it or manufacturing a tool-produced result.
      const path = this.messages.value
      const outstanding = new Map<string, ToolCallContent>()
      for (const message of getInternalMessagesForPath(path, this.allInternalMessages)) {
        if (message.role === 'assistant')
          for (const block of message.content)
            if (block.type === 'toolCall') outstanding.set(block.id, block)
        if (message.role === 'toolResult') outstanding.delete(message.toolCallId)
      }
      for (const call of outstanding.values()) {
        const assistantIndex = path.findLastIndex((m) => m.role === 'assistant')
        const shown = path.slice(assistantIndex + 1).findLast((m) => m.toolCallId === call.id)
        const phase =
          shown?.toolExecution ?? (shown?.toolStatus === 'approved' ? 'interrupted' : 'not-run')
        this.showInterruptedCall(call, phase)
      }
      this.markDirty()
    }
    // Stay busy until the old loop has committed its partial history and released its tools.
    // Stopping stops what was lined up behind it too. Whoever stopped it keeps the text —
    // the chat hands it back to the input rather than dropping it.
    if (this.queuedMessages.value.length && !this.destroyed) this.markDirty()
    this.queuedMessages.value = []
  }

  // ── Reset (new chat within this session / tab) ─────────────────

  async reset(): Promise<void> {
    this.preparingClone.value = false
    this.draft.value.imports?.retire()
    this.draft.value = { text: '', attachments: [] }
    this.conversationVersion.value++
    await this.save()
    this.queuedMessages.value = []
    await this.rewindLog?.flush()
    this.rewindLog = null
    this.log.forget()
    this.dirty = false
    this.readGuard.settle()
    this.results.settle()
    this.abort()
    this.abortBackground()
    if (this.root === this) this.delegatedRuns = 0
    this.allInternalMessages = []
    this.allChatMessages = []
    this.initialSections = []
    this.activeLeafId = null
    this.pendingBranchCut = undefined
    this.messages.value = []
    this.allMessages.value = []
    this.streamingContent.value = ''
    this.streamingThinking.value = ''
    this.pendingToolCalls.value = []
    this.currentChatFile.value = null
    this.errorPresentation.value = null
    this.error.value = null
    this.attention.value = {}
    this.committedAttention = {}
    this.userMessageCount = 0
    this.chatTitle.value = ''
    this.chatCreated = ''
    this.chatIdentity = undefined
    this.commentIdentity = undefined
    this.bindingRecovery = undefined
    this.bindingWriteBlocked = false
    this.lastModelId = ''
    this.customSystemPrompt.value = ''
    this.customSystemPromptNotePath.value = ''
    this.interceptor.abort()
    this.interceptor.followAgent()
    this.interceptor.error.value = null
    this.agentId.value = AgentRegistry.getInstance().defaultAgent()?.id ?? ''
    this.overrides.value = {}
    this.anchor.value = null
    this.touched.value = []
    this.messageComments.value = []
    this.recap.value = ''
    this.summary.value = ''
    this.wroteThisTurn = false
    // The summarizer outlives the conversation — one per tab, not one per chat.
    this.summarizer.forgetRecap()
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
  private restoreAgentBinding(metadata: ChatMetadata | null | undefined): boolean {
    const registry = AgentRegistry.getInstance()
    const config = AbeleConfig.getInstance().ai

    const storedAgent = metadata?.agentId ? registry.get(metadata.agentId) : null
    this.agentId.value = storedAgent?.id ?? registry.defaultAgent()?.id ?? ''

    if (metadata?.agentId && !storedAgent) {
      console.warn(
        `[Abele] Chat references a deleted agent (${metadata.agentId}); falling back to the default`
      )
    }

    const overrides = metadata?.overrides
      ? { ...metadata.overrides }
      : metadata
        ? this.legacyOverrides(metadata, config)
        : {}
    let migrated = false
    if (overrides.toolModes) {
      const result = migrateMcpModes(
        overrides.toolModes,
        config.mcpServers,
        config.mcpLegacyToolMap ?? {}
      )
      overrides.toolModes = result.modes
      migrated = result.changed
      notifyMcpPermissionReset(result.reset)
    }
    this.overrides.value = overrides
    this.syncScopeFromAgent()
    return migrated
  }

  /**
   * A chat that saved a reviewer keeps it as its own choice — that is what it was saved as,
   * before agents had one to offer. A chat that saved none follows its agent: nothing was ever
   * chosen there, and before this build no agent had a reviewer to follow.
   *
   * `activeInterceptorId` is what pre-agent chats stored. Migration reuses each interceptor's
   * own id as its agent id, so the old value maps across unchanged.
   */
  private restoreInterceptor(metadata: ChatMetadata | null | undefined): void {
    // A chat saved with a list of its own runs that list.
    if (metadata && metadata.interceptors !== undefined) {
      this.interceptor.override.value = normaliseEntries(metadata.interceptors).entries
      return
    }
    const stored = metadata?.interceptorAgentId ?? (metadata?.activeInterceptorId || undefined)
    const script = metadata?.interceptorScript
    if (typeof stored !== 'string' && typeof script !== 'string') {
      this.interceptor.followAgent()
      return
    }
    // The single interceptor of before lists, as a list of one; naming nobody, it was Off.
    const single = withLegacyPatch([], {
      interceptorAgentId: typeof stored === 'string' ? stored : '',
      interceptorContextDepth: normaliseContextDepth(metadata?.interceptorContextDepth),
      interceptorReplyOnly: metadata?.interceptorReplyOnly === true,
      interceptorChecks: normaliseChecks(metadata?.interceptorChecks),
      interceptorScript: typeof script === 'string' ? script : '',
      interceptorPattern:
        typeof metadata?.interceptorPattern === 'string' ? metadata.interceptorPattern : '',
    }).map((e) => ({ ...e, id: SINGLE_ENTRY_ID }))
    this.interceptor.override.value = single.filter((e) => e.agentId || e.script)
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

  /** Serializes owner changes with normal saves, publishing only after durable success. */
  private readonly replyChangingState = ref(false)
  private get replyChanging(): boolean {
    return this.replyChangingState.value
  }
  private set replyChanging(value: boolean) {
    this.replyChangingState.value = value
  }

  async changeReply(id: string, change: (message: ChatMessage) => ChatMessage): Promise<void> {
    if (this.isMidTurn || this.isBusy || this.moving.value)
      throw new UiError(uiMessage('streamBError.854a5410e5'))
    try {
      await this.writeReplyChange(id, change)
    } finally {
      void this.drainQueue()
    }
  }

  /**
   * Writes a changed reply and the history the model reads from it in one write. The caller
   * owns the moment: the person between turns, or the interceptor inside the turn it checks.
   */
  private async writeReplyChange(
    id: string,
    change: (message: ChatMessage) => ChatMessage
  ): Promise<void> {
    this.replyChanging = true
    try {
      const file = this.currentChatFile.value
      if (!file) throw new UiError(uiMessage('streamBError.3865c0186d'))
      while (this.writing) await this.writing
      const { app } = GlobalStore.getInstance()
      if (!this.log.matches(parseChat(await app.vault.read(file))))
        throw new UiError(uiMessage('streamBError.c85c1160fb'))
      await this.flush()
      const before = this.allChatMessages.find((m) => m.id === id)
      if (!before) throw new UiError(uiMessage('streamBError.3865c0186d'))
      const after = change(before)
      const snapshot = this.snapshot()
      const messages = snapshot.messages.map((m) => (m.id === id ? after : m))
      const internalMessages =
        before.content !== after.content && after.revisions?.length
          ? compatibleReplyHistory(messages, snapshot.internalMessages)
          : snapshot.internalMessages
      const operation = this.rewriteReply(file, {
        ...snapshot,
        messages,
        internalMessages,
      })
      this.writing = operation.then(
        (): void => {},
        (): void => {}
      )
      try {
        await operation
        this.allInternalMessages = internalMessages
        this.updateChatMessage(
          (m) => m.id === id,
          () => after
        )
      } finally {
        this.writing = null
      }
    } finally {
      this.replyChanging = false
    }
  }

  /**
   * Highlights do not edit conversation or provider history. Reserve the normal writer for
   * the entire read/check/write/publication, but let the agent keep producing events. Publish
   * only the marks after success: replacing the captured message array would lose those events.
   * The streaming answer is not a stored message until message_end; only stored replies count.
   */
  private async changeReplyHighlights(
    id: string,
    change: (marks: ReplyHighlight[]) => ReplyHighlight[]
  ): Promise<void> {
    while (this.writing) await this.writing
    if (this.replyChanging || this.moving.value)
      throw new UiError(uiMessage('streamBError.c5908dd3f8'))
    const file = this.currentChatFile.value
    if (!file) throw new UiError(uiMessage('streamBError.3865c0186d'))
    const operation = Promise.resolve().then(async () => {
      const before = this.allChatMessages.find((m) => m.id === id)
      if (!before || before.role !== 'assistant' || before.draft)
        throw new UiError(uiMessage('streamBError.8d825ed127'))
      const highlights = change(before.highlights ?? [])
      const snapshot = this.snapshot()
      // Internal records are appended in place by the running turn; freeze this write's cut.
      const internalMessages = [...snapshot.internalMessages]
      const messages = snapshot.messages.map((m) => (m.id === id ? { ...m, highlights } : m))
      await this.rewriteReply(file, { ...snapshot, messages, internalMessages })
      this.updateChatMessage(
        (m) => m.id === id,
        (m) => ({ ...m, highlights })
      )
    })
    // Waiters must not inherit another operation's error. The caller still receives it.
    this.writing = operation.then(
      (): void => {},
      (): void => {}
    )
    try {
      await operation
    } finally {
      this.writing = null
    }
  }

  /**
   * Durable revision preparation precedes capture. The projector is injected: rendered offsets
   * cannot be obtained by treating Markdown as plain text. No ids are exposed before success.
   */
  async ensureSelectionRevision(id: string, ports: RevisionPorts): Promise<ChatRevision> {
    const captured = this.findMessage(id)
    return this.changeSelectionAnnotations(id, ports.nextId, (message, chatId) => {
      if (
        !captured ||
        captured.content !== message.content ||
        captured.revisions !== message.revisions ||
        (captured.selection && captured.selection.revisionId !== message.selection?.revisionId)
      )
        throw new UiError(uiMessage('streamBError.e6d5371478'))
      const { selection, revision } = prepareSelectionRevision(message, chatId, ports)
      return { selection, result: revision }
    })
  }

  /** A return address is safe to expose only after this checked, serialized write succeeds. */
  async ensureChatAnchor(snapshot: ChatSelectionSnapshot, nextId = nanoid): Promise<ChatAnchor> {
    return this.changeSelectionAnnotations(snapshot.source.messageId, nextId, (message, chatId) => {
      const { selection, anchor } = ensureCapturedAnchor(message, chatId, snapshot, nextId)
      if (
        this.allChatMessages.some(
          (m) => m.id !== message.id && m.selection?.anchors.some((item) => item.id === anchor.id)
        )
      )
        throw new UiError(uiMessage('streamBError.9ed6e7f6a7'))
      return { selection, result: anchor }
    })
  }

  async getAnchor(chatId: string, anchorId: string): Promise<ChatAnchor | undefined> {
    if (chatId !== this.chatIdentity) return undefined
    return this.allChatMessages
      .flatMap((message) => message.selection?.anchors ?? [])
      .find((anchor) => anchor.id === anchorId)
  }

  async getRevision(reference: RevisionReference): Promise<ChatRevision | undefined> {
    if (reference.chatId !== this.chatIdentity) return undefined
    return this.findMessage(reference.messageId)?.selection?.versions.find((revision) =>
      sameRevision(revision.reference, reference)
    )
  }

  /**
   * Annotation-only writes own the same writer as saves/highlights, but never freeze the turn.
   * Publish only selection metadata, not the captured tree or internal array: events can arrive
   * while IO is pending. A draft/streaming bubble has no stable saved target to annotate.
   */
  private async changeSelectionAnnotations<T>(
    id: string,
    nextId: () => string,
    change: (
      message: ChatMessage,
      chatId: string
    ) => {
      selection: NonNullable<ChatMessage['selection']>
      result: T
    }
  ): Promise<T> {
    const generation = this.generation
    while (this.writing) await this.writing
    const file = this.currentChatFile.value
    const check = () => {
      if (this.destroyed || generation !== this.generation || this.currentChatFile.value !== file)
        throw new UiError(uiMessage('streamBError.392bcbe1e7'))
    }
    check()
    if (this.replyChanging || this.moving.value || this.kind === 'run')
      throw new UiError(uiMessage('streamBError.a2091f71aa'))
    if (!file) throw new UiError(uiMessage('streamBError.0d2f0c2bed'))
    const operation = Promise.resolve().then(async () => {
      check()
      const message = this.findMessage(id)
      if (!message || message.draft || (message.role !== 'user' && message.role !== 'assistant'))
        throw new UiError(uiMessage('streamBError.36e8bead5c'))
      const chatId = this.chatIdentity ?? nextId()
      const { selection, result } = change(message, chatId)
      const snapshot = this.snapshot()
      await this.rewriteReply(
        file,
        {
          ...snapshot,
          metadata: { ...snapshot.metadata, chatId },
          messages: snapshot.messages.map((m) => (m.id === id ? { ...m, selection } : m)),
          internalMessages: [...snapshot.internalMessages],
        },
        check
      )
      check()
      this.chatIdentity = chatId
      this.updateChatMessage(
        (m) => m.id === id,
        (m) => ({ ...m, selection })
      )
      return result
    })
    this.writing = operation.then(
      (): void => {},
      (): void => {}
    )
    try {
      return await operation
    } finally {
      this.writing = null
    }
  }

  bindingState(): BindingState {
    return { messages: this.allMessages.value, recovery: this.bindingRecoveries.value }
  }

  /** Binding intent and decoration share the serialized writer; only owned fields publish. */
  async changeBindings<T>(
    change: (state: BindingState) => Promise<BindingStateChange<T>>
  ): Promise<T> {
    const generation = this.generation
    const file = this.currentChatFile.value
    while (this.writing) await this.writing
    const check = () => {
      if (
        !file ||
        this.destroyed ||
        generation !== this.generation ||
        file !== this.currentChatFile.value ||
        this.replyChanging ||
        this.moving.value ||
        this.kind === 'run'
      )
        throw new UiError(uiMessage('streamBError.eda0e6622d'))
    }
    let attempted = false
    const operation = Promise.resolve().then(async () => {
      check()
      const changed = await change(this.bindingState())
      check()
      const snapshot = this.snapshot()
      await this.rewriteReply(
        file,
        {
          ...snapshot,
          metadata: { ...snapshot.metadata, bindingRecovery: changed.recovery },
          messages: snapshot.messages.map((m) =>
            m.id === changed.message?.id ? changed.message : m
          ),
          internalMessages: [...snapshot.internalMessages],
        },
        check,
        () => {
          attempted = true
        }
      )
      check()
      this.bindingRecovery = changed.recovery
      if (changed.message)
        this.updateChatMessage(
          (m) => m.id === changed.message.id,
          (m) => ({
            ...m,
            content: changed.message.content,
            selection: changed.message.selection,
            decorationOperations: changed.message.decorationOperations,
          })
        )
      return changed.result
    })
    this.writing = operation.then(
      (): void => {},
      (): void => {}
    )
    try {
      return await operation
    } catch (error) {
      if (attempted) this.bindingWriteBlocked = true
      throw new BindingWriteFailure(attempted, error)
    } finally {
      this.writing = null
    }
  }

  /** Settlement is by atomic operation IDs in a valid log, never by matching message text. */
  async inspectBindingWrite(operationId: string): Promise<boolean> {
    const file = this.currentChatFile.value
    if (!file) return false
    const loaded = await readChat(GlobalStore.getInstance().app, file)
    if (loaded.damaged || loaded.torn || loaded.metadata?.chatId !== this.chatIdentity) return false
    const message = loaded.messages.find((m) =>
      m.decorationOperations?.some((op) => op.id === operationId)
    )
    if (!message) return false
    this.log.adopt(loaded)
    this.bindingRecovery = loaded.metadata?.bindingRecovery
    this.updateChatMessage(
      (m) => m.id === message.id,
      (m) => ({
        ...m,
        content: message.content,
        selection: message.selection,
        decorationOperations: message.decorationOperations,
      })
    )
    this.bindingWriteBlocked = false
    return true
  }

  /** Allocate the existing chat identity durably before an owner binds node authority.
   * Reopening/renaming keeps it; the ordinary chat-copy path allocates its own identity.
   */
  async ensureDelegationParentId(): Promise<string> {
    while (this.writing) await this.writing
    if (this.delegationParentId) return this.delegationParentId
    const file = this.currentChatFile.value
    const generation = this.generation
    if (!file || this.kind === 'run') throw new UiError(uiMessage('streamBError.c93dfca065'))
    const check = () => {
      if (this.destroyed || generation !== this.generation || this.currentChatFile.value !== file)
        throw new UiError(uiMessage('streamBError.132388cd4d'))
    }
    check()
    const operation = Promise.resolve().then(async () => {
      check()
      const existing = this.chatIdentity
      // An older identity may predate the device-local owner binding. Never adopt
      // ambiguous file metadata: two physical files cannot claim one parent grant.
      if (existing) {
        const files = GlobalStore.getInstance()
          .app.vault.getFiles()
          .filter((candidate) => candidate.extension === 'abchat' && candidate.path !== file.path)
        let duplicated = false
        for (const candidate of files) {
          const loaded = await ChatStorage.getInstance()
            .loadChat(candidate)
            .catch((): null => null)
          if (loaded?.metadata?.chatId === existing) {
            duplicated = true
            break
          }
        }
        check()
        if (!duplicated && claimDelegationIdentity(existing, file.path)) return existing
      }
      const chatId = crypto.randomUUID()
      const snapshot = this.snapshot()
      await this.rewriteReply(
        file,
        {
          ...snapshot,
          metadata: { ...snapshot.metadata, chatId },
          internalMessages: [...snapshot.internalMessages],
        },
        check
      )
      check()
      claimDelegationIdentity(chatId, file.path)
      this.chatIdentity = chatId
      return chatId
    })
    this.writing = operation.then(
      (): void => {},
      (): void => {}
    )
    try {
      return await operation
    } finally {
      this.writing = null
    }
  }

  /** Protected owner edits share one external-change guard and persistence recovery path. */
  private async rewriteReply(
    file: TFile,
    snapshot: ChatSnapshot,
    check?: () => void,
    onAttempt?: () => void
  ): Promise<void> {
    if (this.bindingWriteBlocked) throw new UiError(uiMessage('streamBError.7d35f0db1e'))
    this.localRevision++
    const written = serializeChat(snapshot)
    const { app } = GlobalStore.getInstance()
    let attempted = false
    try {
      await ChatStorage.getInstance().rewriteDiscussion(
        file,
        written,
        (content) => {
          check?.()
          if (!this.log.matches(parseChat(content)))
            throw new UiError(uiMessage('streamBError.c85c1160fb'))
          attempted = true
          onAttempt?.()
        },
        Boolean(onAttempt)
      )
    } catch (err) {
      if (attempted) {
        // Recover what actually reached the file, not the old cached records. If recovery
        // itself is unavailable, the next save must rewrite the whole live conversation.
        this.dirty = true
        try {
          this.log.adopt(await readChat(app, file))
        } catch {
          this.log.forget()
        }
      }
      throw err
    } finally {
      this.localRevision++
    }
    this.log.adopt(parseChat(written))
  }

  async highlightReply(
    id: string,
    quote: string,
    start: number,
    color: HighlightColor = 'yellow'
  ): Promise<void> {
    if (!quote.trim() || !Number.isInteger(start) || start < 0 || !HIGHLIGHT_COLORS.includes(color))
      throw new UiError(uiMessage('streamBError.e0774494e5'))
    await this.changeReplyHighlights(id, (marks) => {
      const kept = marks.filter((h) => h.quote !== quote || h.start !== start)
      return [...kept, { id: nanoid(), quote, start, color }]
    })
  }

  async recolorReplyHighlight(id: string, highlight: string, color: HighlightColor): Promise<void> {
    if (!HIGHLIGHT_COLORS.includes(color)) throw new UiError(uiMessage('streamBError.5d1f47524d'))
    await this.changeReplyHighlights(id, (marks) => {
      if (!marks.some((h) => h.id === highlight))
        throw new UiError(uiMessage('streamBError.218b14f26c'))
      return marks.map((h) => (h.id === highlight ? { ...h, color } : h))
    })
  }

  async removeReplyHighlight(id: string, highlight: string): Promise<void> {
    await this.changeReplyHighlights(id, (marks) => marks.filter((h) => h.id !== highlight))
  }

  async undoReplyRevision(id: string): Promise<void> {
    await this.changeReply(id, (message) => undoRevision(message, Date.now()))
  }

  /** Path-only maintenance; safe during a turn and written by this session's usual writer. */
  followReplyProposalRename(oldPath: string, newPath: string): boolean {
    let changed = false
    this.allChatMessages = this.allChatMessages.map((message) => {
      if (message.replyProposal?.parent !== oldPath) return message
      changed = true
      return { ...message, replyProposal: { ...message.replyProposal, parent: newPath } }
    })
    if (changed) this.updateVisibleMessages()
    return changed
  }

  private replyDeciding = false

  async decideReplyProposal(id: string, accept: boolean): Promise<void> {
    if (this.replyDeciding || this.isMidTurn || this.isBusy)
      throw new UiError(uiMessage('streamBError.9b77d73c1b'))
    let proposal = this.allChatMessages.find((m) => m.id === id)?.replyProposal
    if (proposal?.status === 'accepted' && !accept)
      throw new UiError(uiMessage('streamBError.9390b6928f'))
    const resumable = proposal?.status === 'accepted' && proposal.application === 'pending'
    if (!proposal || (proposal.status !== 'pending' && !resumable))
      throw new UiError(uiMessage('streamBError.879f176aec'))
    this.replyDeciding = true
    try {
      // Commit the owner decision first under the child file's compare-and-swap guard.
      // A stale Reject or a failed decision write must never touch the parent. Two vault
      // files cannot be atomically committed, so application is an explicit recoverable
      // checkpoint; after durable Accept, Reject is no longer a valid transition.
      await this.changeReply(id, (message) => ({
        ...message,
        replyProposal: {
          ...proposal,
          status: accept ? 'accepted' : 'rejected',
          application: accept ? 'pending' : undefined,
        },
      }))
      if (!accept) return
      proposal = this.allChatMessages.find((m) => m.id === id).replyProposal!
      await CommentService.getInstance().acceptReplyProposal({ ...proposal, status: 'pending' })
      await this.changeReply(id, (message) => ({
        ...message,
        replyProposal: { ...proposal, application: 'done' },
      }))
    } finally {
      this.replyDeciding = false
    }
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
    this.localRevision++
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

    // The owning flush handles failure and keeps the dirty state. Another waiter must
    // not leak that same rejection or start a concurrent write.
    while (this.writing) await this.writing.catch(() => {})
    if (!this.dirty || this.bindingWriteBlocked) return

    this.dirty = false
    this.writing = this.writeNow()
    try {
      await this.writing
      this.persistFailed = false
    } catch (err) {
      this.persistFailed = true
      // The change is still only in memory, so it stays pending rather than being dropped:
      // the next save retries it, and a flush at close gets one more chance.
      this.dirty = true
      // A write that failed may have written part of itself; the retry starts on a new line.
      this.log.interrupted()
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

  /** A presentation release may proceed only when the last flush left no local work behind. */
  async saveForRelease(): Promise<void> {
    await this.save()
    // Automatic flush is deliberately best-effort: it logs write errors and keeps dirty=true.
    // Releasing/closing must not mistake that fulfilled Promise for a durable save.
    if (this.dirty || this.writing !== null) throw new UiError(uiMessage('streamBError.dee0fd6565'))
  }

  /** Inspect current source after an expansion's write/confirmation failed, without replaying it. */
  async reconcileFailedExpansion(): Promise<{ metadata: ChatMetadata; unchanged: boolean }> {
    const file = this.currentChatFile.value
    const id = this.commentId
    if (!file || !id || this.writing || this.isBusy || this.isMidTurn)
      throw new UiError(uiMessage('streamBError.80d27f4757'))
    const path = file.path,
      version = this.conversationVersion.value,
      revision = this.localRevision
    const main = await inspectMainChat(GlobalStore.getInstance().app, file)
    if (!main?.metadata || main.metadata.commentId !== id || main.metadata.commentLocation !== path)
      throw new UiError(uiMessage('streamBError.97188092c4'))
    // Refresh the exact file binding too; a failed readback left its pre-write observation stale.
    const { snapshot: saved, identity } = await ChatStorage.getInstance().prepareDiscussion(
      file,
      undefined,
      { recover: false }
    )
    const metadata = saved.metadata
    if (
      !metadata ||
      saved.torn ||
      saved.damaged ||
      identity !== id ||
      metadata.commentLocation !== path ||
      (metadata.kind && metadata.kind !== 'chat' && metadata.kind !== 'comment') ||
      this.destroyed ||
      this.currentChatFile.value !== file ||
      file.path !== path ||
      this.conversationVersion.value !== version ||
      this.localRevision !== revision
    )
      throw new UiError(uiMessage('streamBError.ab47750c92'))
    // No confirmed change: preserve local pending work; the caller can restore its old binding.
    if (this.log.matchesDiscussionRevision(saved)) return { metadata, unchanged: true }
    // Never replace local edits that arrived during the failed write, or merge a foreign history
    // by adopting its checkpoint under the stale in-memory conversation.
    if (
      this.lastWriteRevision !== revision ||
      JSON.stringify(saved.messages) !== JSON.stringify(this.allChatMessages) ||
      JSON.stringify(saved.internalMessages) !== JSON.stringify(this.allInternalMessages)
    )
      throw new UiError(uiMessage('streamBError.cfe8f23fc1'))
    if (this.persistTimer !== null) window.clearTimeout(this.persistTimer)
    this.persistTimer = null
    this.dirty = false
    this.persistFailed = false
    const restoring = this.restoringAttention
    this.restoringAttention = true
    try {
      this.kind = metadata.kind === 'chat' ? 'chat' : 'comment'
      await this.restoreLoadedChat(file, saved, { keepLeaf: this.activeLeafId, readOnly: true })
    } finally {
      this.restoringAttention = restoring
    }
    return { metadata, unchanged: false }
  }

  private snapshot(): ChatSnapshot {
    const config = AbeleConfig.getInstance().ai
    const overrides = this.overrides.value

    const metadata: ChatMetadata = {
      type: 'abele-chat',
      attention:
        Object.keys(this.attention.value).length || this.attentionAcks.size
          ? {
              ...(JSON.parse(JSON.stringify(this.attention.value)) as LocalAttention),
              resolved: [
                ...new Set([...(this.attention.value.resolved ?? []), ...this.attentionAcks]),
              ],
              errors: this.attention.value.errors?.map((e) =>
                this.attentionAcks.has(e.id) ? { ...e, seen: true } : { ...e }
              ),
            }
          : undefined,
      treeFolderId: this.chatService.folders.membershipOf(
        this.currentChatFile.value?.path ?? this.id
      ),
      chatId: this.chatIdentity,
      commentId: this.commentId ?? undefined,
      commentLocation: this.commentId ? this.currentChatFile.value?.path : undefined,
      bindingRecovery: this.bindingRecovery,
      queuedMessages: this.queuedMessages.value.length
        ? this.queuedMessages.value.map((q) => ({ ...q, attachments: q.attachments?.slice() }))
        : undefined,
      agentId: this.agentId.value || undefined,
      openToolSections: this.initialSections.length ? this.initialSections : undefined,
      // Written whenever there is an anchor, expanded comments included: the marker in the
      // note has to keep finding this file, and `kind` is how a reopened one knows what it is.
      kind: this.anchor.value ? (this.kind === 'comment' ? 'comment' : 'chat') : undefined,
      anchor: this.anchor.value ?? undefined,
      // Absent rather than empty: a chat that changed nothing says nothing about notes.
      touched: this.touched.value.length ? [...this.touched.value] : undefined,
      comments: this.messageComments.value.length ? [...this.messageComments.value] : undefined,
      recap: this.recap.value || undefined,
      summary: this.summary.value || undefined,
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
              permissionKey: tc.permissionKey,
              destinationKey: tc.destinationKey,
            }))
          : undefined,
      activeLeafId: this.activeLeafId || undefined,
      pendingBranchCut: this.pendingBranchCut,
      customSystemPrompt: this.customSystemPrompt.value || undefined,
      customSystemPromptNotePath: this.customSystemPromptNotePath.value || undefined,
      // Only a choice this chat made; a chat following its agent says nothing, and picks up
      // whatever the agent's list is the next time it is opened. An empty list is Off.
      ...this.interceptorMetadata(),
    }

    return {
      metadata,
      messages: this.allChatMessages,
      internalMessages: this.allInternalMessages,
    }
  }

  /** Explicit folder creation persists even an empty chat, before its first turn. */
  async createInDirectory(directory: string): Promise<void> {
    if (this.currentChatFile.value) return
    const snapshot = this.snapshot()
    const plan = this.log.plan(snapshot)
    const file = await ChatStorage.getInstance().saveChat(
      snapshot,
      plan,
      undefined,
      undefined,
      directory
    )
    if (!file) throw new Error(t('chatTree.createFailed'))
    this.commentIdentity = snapshot.metadata.commentId
    this.log.commit(snapshot, plan)
    this.currentChatFile.value = file
    this.chatService.folders.noteFile(file, snapshot.metadata.treeFolderId)
    this.chatService.saveTabs()
  }

  private async writeNow(): Promise<void> {
    this.localRevision++
    // Nothing to write and nowhere to write it: a tab nobody has typed into yet. Once a file
    // exists — a comment's, written before its first turn — a meta change is worth a save.
    if (
      this.allChatMessages.length === 0 &&
      !this.queuedMessages.value.length &&
      !this.currentChatFile.value &&
      !this.overrides.value.nodeScope?.length
    )
      return

    const snapshot = this.snapshot()
    const plan = this.log.plan(snapshot)
    if (plan.kind === 'noop') return

    this.lastWriteRevision = this.localRevision
    const file = await ChatStorage.getInstance().saveChat(
      snapshot,
      plan,
      this.currentChatFile.value || undefined,
      (parsed) => this.log.matchesDiscussionRevision(parsed)
    )
    if (!file) return

    this.commentIdentity = snapshot.metadata.commentId
    this.applyAttentionTruth(snapshot.metadata, false)
    this.log.commit(snapshot, plan)
    this.localRevision++
    this.currentChatFile.value = file
    this.chatService.folders.noteFile(file, snapshot.metadata.treeFolderId)
    // The first moment a new chat has a path to key its index entry on.
    this.mirrorNoteLinks()

    // Update tab state so new chats get persisted
    this.chatService.saveTabs()
  }

  /** This chat's rewind log: the vault changes its turns made, and the way back. */
  get rewind(): ChatRewind {
    if (!this.rewindLog) {
      this.rewindLog = new ChatRewind(GlobalStore.getInstance().app, {
        // The first message never goes — a repeat of it starts a second root beside it — so its
        // id names the chat for as long as the chat exists, through renames and moves.
        key: () => this.allChatMessages[0]?.id ?? null,
        turn: () => this.currentTurnId(),
      })
    }
    return this.rewindLog
  }

  /** The user message the running turn answers: the last one on the path shown. */
  private currentTurnId(): string | null {
    for (let i = this.messages.value.length - 1; i >= 0; i--) {
      const m = this.messages.value[i]
      if (m.role === 'user' && !m.draft) return m.id
    }
    return null
  }

  /** The notes this chat has written to, for the recap prompt. Part of `SummarizerHost`. */
  touchedNotes(): string[] {
    return this.touched.value.map((note) => note.path)
  }

  /**
   * Whether the turn that just ended earns a recap.
   *
   * A run is never listed, and a comment lives on the margin where no card shows a sentence —
   * it pays for one when somebody expands it, and not before. Same rule as the title, for the
   * same reason: a background request nobody reads the answer to.
   */
  private wantsRecap(): boolean {
    return this.kind === 'chat' && this.wroteThisTurn
  }

  /** Writes the history summary now — for a chat listed without one. */
  generateSummary(): Promise<void> {
    return this.summarizer.generateSummary()
  }

  /**
   * Writes the one recap a chat expanded from a comment never had.
   *
   * Fire and forget, like every other background request: the expansion has already happened
   * and must not wait on a model, nor fail because one was not reachable.
   */
  recapIfMissing(): void {
    if (!this.touched.value.length || this.recap.value) return
    this.summarizer.generateRecap().catch(() => {
      return
    })
  }

  /**
   * Copies `touched` and `recap` into this chat's history entry.
   *
   * Not private: the rename walk and a live check both drive it. Does nothing for a chat that
   * has written to nothing, and nothing for a comment, whose path has no entry to write into.
   */
  mirrorNoteLinks(): void {
    const path = this.currentChatFile.value?.path
    if (!path || !this.touched.value.length) return
    ChatStorage.getInstance().linkNotes(
      path,
      this.touched.value,
      this.recap.value,
      this.agentId.value
    )
  }

  private selectionReconciliation: Promise<void> | null = null

  /** Reconcile only an intact main file; backup recovery belongs to the ordinary open path. */
  async reconcileForSelectionReturn(isCurrent = () => true): Promise<void> {
    const file = this.currentChatFile.value
    const version = this.conversationVersion.value
    const previous = this.selectionReconciliation
    // Two opens may inspect the same external revision. The first adoption changes local
    // refs; serialize the second read so it does not mistake that adoption for a user edit.
    // Every caller still owns its own cancellation and source-version checks.
    const operation = (async () => {
      if (previous) await previous.catch(() => {})
      if (!isCurrent()) return
      if (
        this.destroyed ||
        this.currentChatFile.value !== file ||
        this.conversationVersion.value !== version
      )
        throw new UiError(uiMessage('streamB.theSelectionSourceChangedOpenTheLink.cedf06'))
      await this.reconcileSelectionSnapshot(isCurrent)
      if (isCurrent()) await CommentService.getInstance().inheritNodeScope(this)
    })()
    this.selectionReconciliation = operation
    try {
      await operation
    } finally {
      if (this.selectionReconciliation === operation) this.selectionReconciliation = null
    }
  }

  private async reconcileSelectionSnapshot(isCurrent: () => boolean): Promise<void> {
    const file = this.currentChatFile.value
    const version = this.conversationVersion.value
    if (!file) throw new UiError(uiMessage('streamBError.92f4905c24'))
    while (this.writing) await this.writing
    if (!isCurrent()) return
    const localRevision = this.localRevision
    // A writer may start during this read. Never inspect or adopt its recovery copy: if the
    // main file is torn, selection return uses the conversation already held in memory.
    const main = await inspectMainChat(GlobalStore.getInstance().app, file)
    const result = main
      ? (await ChatStorage.getInstance().prepareDiscussion(file, undefined, { recover: false }))
          .snapshot
      : null
    if (!isCurrent()) return
    if (
      this.destroyed ||
      this.currentChatFile.value !== file ||
      this.conversationVersion.value !== version
    )
      throw new UiError(uiMessage('streamB.theSelectionSourceChangedOpenTheLink.cedf06'))
    if (this.localRevision !== localRevision)
      throw new UiError(uiMessage('streamBError.0bda7be5eb'))
    if (!result || this.log.matches(result)) return
    if (this.dirty || this.writing || this.isBusy || this.isMidTurn || this.moving.value)
      throw new UiError(uiMessage('streamBError.4d4b0467c4'))
    // Do not use load/reset: reset saves the old snapshot and retires the local draft.
    this.abortBackground()
    this.readGuard.settle()
    this.results.settle()
    this.summarizer.forgetRecap()
    this.errorPresentation.value = null
    this.error.value = null
    this.lastModelId = ''
    const restoring = this.restoringAttention
    this.restoringAttention = true
    try {
      await this.restoreLoadedChat(file, result, {
        keepLeaf: this.activeLeafId,
        readOnly: true,
      })
    } finally {
      this.restoringAttention = restoring
    }
  }

  /** Adopt into the reserved empty session without resetting any draft delivered meanwhile. */
  async initializeClone(file: TFile, isCurrent: () => boolean): Promise<void> {
    const result = await ChatStorage.getInstance().loadChat(file)
    if (
      !isCurrent() ||
      !this.preparingClone.value ||
      this.currentChatFile.value ||
      this.allChatMessages.length
    )
      throw new UiError(uiMessage('streamBError.93215f7df9'))
    await this.restoreLoadedChat(file, result, { readOnly: true })
  }

  async load(file: TFile): Promise<void> {
    this.restoringAttention = true
    try {
      await this.reset()
      const result = await ChatStorage.getInstance().loadChat(file)
      // Storage preparation is mandatory, including direct loads and migration saves.
      await this.restoreLoadedChat(file, result)
      await CommentService.getInstance().inheritNodeScope(this)
    } finally {
      this.restoringAttention = false
    }
  }

  /** Sync identity changes cannot be answered by an obsolete writer. Busy holders stay fenced. */
  private discussionNeedsReconciliation = false
  async reconcileDiscussionIdentity(metadata: ChatMetadata): Promise<void> {
    if (
      !metadata.commentId ||
      (metadata.commentId === this.commentIdentity && !this.discussionNeedsReconciliation)
    )
      return
    this.discussionNeedsReconciliation = true
    // A busy holder can display the incoming identity, but its old log revision remains
    // fenced at storage. Never label or overwrite the arrival with a local assignment.
    this.commentIdentity = metadata.commentId
    await this.reconcileForSelectionReturn()
    this.discussionNeedsReconciliation = false
  }

  private async restoreLoadedChat(
    file: TFile,
    result: ParsedChat,
    options: { keepLeaf?: string | null; readOnly?: boolean } = {}
  ): Promise<void> {
    this.allChatMessages = result.messages.map((m) => (m.id ? m : { ...m, id: nanoid() }))
    this.allInternalMessages = result.internalMessages || []
    // Normal opens repair the main file before adopting it; reconciliation accepts only an
    // intact main-file snapshot. An older format needs a rewrite on save to migrate to a log.
    this.log.adopt(result)
    this.currentChatFile.value = file
    this.chatService.folders.noteFile(file, result.metadata?.treeFolderId)
    this.chatTitle.value = result.metadata?.title || ''
    this.chatCreated = result.metadata?.created || ''
    this.chatIdentity = result.metadata?.chatId
    this.delegationWakeStopped = false
    this.commentIdentity = result.metadata?.commentId
    this.bindingRecovery = result.metadata?.bindingRecovery
    this.bindingWriteBlocked = false
    const evidence = result.metadata?.attention ?? {}
    this.committedAttention = evidence
    // Saved failures use the same retry block as an in-memory failure, not a second card.
    const lastFailure = evidence.errors?.at(-1)
    this.error.value =
      lastFailure && (!evidence.run || evidence.run.at <= lastFailure.at) ? lastFailure.text : null
    this.attention.value = {
      ...evidence,
      run:
        evidence.run?.status === 'running'
          ? { ...evidence.run, status: 'interrupted' }
          : evidence.run,
      ...(evidence.tools
        ? {
            tools: Object.fromEntries(
              Object.entries(evidence.tools).map(([id, status]) => [
                id,
                status === 'executing' ? 'interrupted' : status,
              ])
            ),
          }
        : {}),
      question:
        evidence.question?.status === 'waiting'
          ? { ...evidence.question, status: 'interrupted' }
          : evidence.question,
    }
    // Before `restoreAgentBinding`, which rebuilds the scope: the anchor has to be in place
    // by then or the note is left out until the next agent change.
    if (result.metadata?.kind) this.kind = result.metadata.kind
    this.anchor.value = result.metadata?.anchor ?? null
    this.touched.value = result.metadata?.touched ?? []
    this.messageComments.value = result.metadata?.comments ?? []
    this.recap.value = result.metadata?.recap ?? ''
    this.summary.value = result.metadata?.summary ?? ''
    // A reload stops the old turn. Keep its queue visible for explicit editing/resending,
    // rather than starting a model request merely because the chat was opened.
    this.queuedMessages.value = result.metadata?.queuedMessages ?? []

    // Migrate old flat format → tree format once
    const needsMigration =
      this.allChatMessages.length > 1 && !this.allChatMessages.some((m) => m.parentId)
    if (needsMigration) {
      backfillParentIds(this.allChatMessages)
      backfillChatMessageIds(this.allChatMessages, this.allInternalMessages)
    }

    // After `adopt`, so the repaired links differ from what the file holds and are written back.
    if (reattachOrphans(this.allChatMessages)) {
      console.warn(`[Abele] ${file.path}: reconnected messages cut off by a damaged record`)
    }

    // The newest message it names may be the one a crash lost.
    const leaf = options.keepLeaf ?? result.metadata?.activeLeafId
    this.activeLeafId =
      (leaf && this.allChatMessages.some((m) => m.id === leaf) ? leaf : null) ||
      findDefaultLeaf(this.allChatMessages)?.id ||
      null
    this.pendingBranchCut =
      result.metadata?.pendingBranchCut === this.activeLeafId
        ? result.metadata.pendingBranchCut
        : undefined
    this.updateVisibleMessages()
    void this.rewind.load()

    this.userMessageCount = this.messages.value.filter((m) => m.role === 'user').length

    const permissionsMigrated = this.restoreAgentBinding(result.metadata)
    this.initialSections = Array.isArray(result.metadata?.openToolSections)
      ? result.metadata.openToolSections.filter((id): id is string => typeof id === 'string')
      : sectionsOfLegacyGroups(result.metadata?.revealedToolGroups)

    this.customSystemPrompt.value = result.metadata?.customSystemPrompt || ''
    this.customSystemPromptNotePath.value = result.metadata?.customSystemPromptNotePath || ''
    this.restoreInterceptor(result.metadata)

    // Restore pending tool calls
    if (result.metadata?.pendingToolCalls?.length) {
      const settled = settledAttention(this.attention.value)
      this.pendingToolCalls.value = result.metadata.pendingToolCalls
        .filter((tc) => !settled.has(tc.id) && !this.attention.value.tools?.[tc.id])
        .map((tc) => ({
          type: 'toolCall' as const,
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          permissionKey: tc.permissionKey,
          destinationKey: tc.destinationKey,
        }))
    }

    // Last, after everything the file said has been restored. This writes a fresh snapshot, so
    // anything not yet put back is written out as absent: run earlier it filed the chat under
    // the default agent, dropped the overrides it was saved with, and forgot the tool call it
    // was waiting on approval for.
    // A selection return may migrate in memory, but must leave files and safety copies alone.
    // The writer's adopted snapshot retains the difference for the next ordinary save.
    if (!options.readOnly && (needsMigration || permissionsMigrated)) {
      await this.save()
    }
  }

  // ── Branching ──────────────────────────────────────────────────

  /**
   * Says why a branch, repeat or retry did nothing, rather than doing nothing quietly.
   *
   * A press that changes nothing and says nothing reads as broken; while the agent is
   * answering, running a tool or waiting on an approval, the tree is not to be moved under it.
   */
  private busyFor(action: string): boolean {
    const busy =
      this.preparingClone.value ||
      this.isStreaming.value ||
      this.isExecutingTool.value ||
      this.pendingToolCalls.value.length > 0
    if (busy) new Notice(t('streamB.theChatIsBusyStopItOr.62cfb3', { v0: String(action) }))
    return busy
  }

  /** Snapshot only: no source save, branch move, model request or tool execution. */
  cloneSnapshot(messageId: string): ChatSnapshot | null {
    if (this.kind === 'run' || this.busyFor('create a new chat')) return null
    if (!this.messages.value.some((message) => message.id === messageId)) return null
    return cloneChatPath(this.snapshot(), messageId)
  }

  createBranch(messageId: string): void {
    if (
      this.isDestroyed ||
      this.kind === 'run' ||
      this.preparingClone.value ||
      this.branchSwitchBlocked
    ) {
      new Notice(t('streamB.theChatIsBusyStopItOr.19c674'))
      return
    }
    const target = this.allChatMessages.find((message) => message.id === messageId)
    if (!target || target.draft) return
    const bundled =
      target.role === 'assistant' &&
      this.allInternalMessages.some(
        (message) =>
          message.role === 'assistant' &&
          message.chatMessageId === target.id &&
          Array.isArray(message.content) &&
          message.content.some((part) => part.type === 'toolCall')
      )
    const cut = target.role === 'tool-call' || bundled ? target.id : undefined
    if (
      target.role === 'tool-call' &&
      (target.toolStatus === 'pending' || target.toolResult === undefined)
    ) {
      new Notice(t('streamB.waitForTheCallToReturnBefore.01692d'))
      return
    }
    if (cut) {
      try {
        projectBranchCuts(
          getPathToLeaf(this.allChatMessages, messageId),
          this.allInternalMessages,
          cut
        )
      } catch (error) {
        new Notice(
          error instanceof Error
            ? error.message
            : t('streamB.thisCallHasNoVerifiedContextBoundary.4a5c1b')
        )
        return
      }
    }
    this.branchSelectionRevision++
    this.activeLeafId = messageId
    this.pendingBranchCut = cut
    this.results.settle()
    this.updateVisibleMessages()
    this.markDirty()
  }

  repeatMessage(messageId: string): void {
    if (this.busyFor('repeat')) return

    const msg = this.allChatMessages.find((m) => m.id === messageId)
    if (!msg || msg.role !== 'user') return

    // Dismiss any pending tool approvals
    this.pendingToolCalls.value = []

    this.branchSelectionRevision++
    this.activeLeafId = msg.parentId || null
    this.pendingBranchCut = msg.branchCutAfter
    this.results.settle()
    this.updateVisibleMessages()

    this.sendMessage(msg.content, msg.attachments, undefined, msg.replyTo)
  }

  async retryFromMessage(messageId: string): Promise<void> {
    if (this.busyFor('retry')) return

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

  /** The exact path end, including an unsent continuation at an interior message. */
  get branchLeafId(): string | null {
    return this.activeLeafId
  }

  /** Unlike appended replies, an explicit path choice retires a return bookmark's growth. */
  get branchSelectionVersion(): number {
    return this.branchSelectionRevision
  }

  get branchSwitchBlocked(): boolean {
    return (
      this.activeAgentTurns.value > 0 ||
      this.isMidTurn ||
      this.isExecutingTool.value ||
      this.retrying.value !== null ||
      this.interceptor.streaming.value ||
      this.moving.value
    )
  }

  switchBranch(messageId: string, followContinuation = true): boolean {
    if (this.isDestroyed || this.branchSwitchBlocked) return false
    const byId = new Map(this.allChatMessages.map((message) => [message.id, message]))
    const target = byId.get(messageId)
    if (!target) return false
    // Never walk a malformed cycle into findDeepestLeaf or the path renderer.
    const seen = new Set<string>()
    let current: ChatMessage | undefined = target
    while (current) {
      if (seen.has(current.id)) return false
      seen.add(current.id)
      if (current.parentId && !byId.has(current.parentId)) return false
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    const leaf = followContinuation ? findDeepestLeaf(this.allChatMessages, messageId) : target
    this.branchSelectionRevision++
    this.activeLeafId = leaf.id
    this.pendingBranchCut = undefined
    this.results.settle()
    this.updateVisibleMessages()
    this.markDirty()
    return true
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
   *
   * TODO: a run's writes link no note to anything. The run's own wrapper skips them, and the
   * parent's wrapper never sees them — so a note changed only by a delegated run shows no card
   * for the chat that asked for the change. Carrying the run's `touched` back through here, so
   * the parent adopts them, is the follow-up.
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

  /** This chat's own interceptors as it saves them, the single fields mirroring the first. */
  private interceptorMetadata(): Partial<ChatMetadata> {
    const own = this.interceptor.override.value
    if (!own) return {}
    const single = legacyFields(own)
    return {
      interceptors: copyEntries(own),
      interceptorAgentId: single.interceptorAgentId,
      interceptorContextDepth: single.interceptorContextDepth,
      interceptorReplyOnly: single.interceptorReplyOnly,
      // Absent means messages, what every chat checked before answers could be.
      interceptorChecks:
        single.interceptorChecks !== 'message' ? single.interceptorChecks : undefined,
      interceptorScript: single.interceptorScript || undefined,
      interceptorPattern: single.interceptorPattern || undefined,
    }
  }

  private scriptSendHost(): ScriptSendHost {
    return {
      interceptor: this.interceptor,
      generation: () => this.generation,
      visible: () => this.messages.value,
      source: (earlier) => this.interceptSource(earlier),
      append: (message) => {
        this.appendChatMessage(message)
        this.updateVisibleMessages()
      },
      update: (id, change) => {
        this.updateChatMessage((m) => m.id === id, change)
        this.updateVisibleMessages()
      },
      find: (id) => this.findMessage(id),
      save: () => this.save(),
      modelMessage: (bubble) => this.modelMessage(bubble),
      remember: (...messages) => this.rememberInternal(...messages),
      countUserMessage: () => void this.userMessageCount++,
      runTurnFor: (bubble, policy) => this.runTurnFor(bubble, policy),
      drainQueue: () => this.drainQueue(),
    }
  }

  /** What the chat knows, for an interceptor script to read. */
  private interceptSource(earlier: ChatMessage[]): InterceptSource {
    const { app } = GlobalStore.getInstance()
    return {
      id: this.id,
      title: this.chatTitle.value,
      kind: this.kind,
      path: this.currentChatFile.value?.path ?? null,
      messages: earlier,
      activeNote: app?.workspace?.getActiveFile?.()?.path ?? null,
      note: this.anchor.value?.note ?? null,
      agent: this.agent.value,
      overrides: {
        providerId: this.activeProviderId.value,
        modelId: this.activeModelId.value,
        permissionMode: this.permissionMode.value,
        toolModes: this.toolModes.value,
      },
    }
  }

  abortInterceptor(): void {
    this.interceptor.abort()
  }

  async retryInterceptor(messageId?: string): Promise<void> {
    if (messageId && this.interceptor.replyReviews.value[messageId]) {
      await this.interceptor.reviewReply(messageId)
      return
    }
    // A message stopped by a failure: that interceptor again, and the ones after it.
    const draft = messageId ? this.findMessage(messageId) : this.getDraftMessage()
    if (draft && (await retryHeld(this.scriptSendHost(), draft.id))) return
    await this.interceptor.retry()
  }

  async sendInterceptorMessage(draftMsgId: string, content: string): Promise<void> {
    await this.interceptor.sendMessage(draftMsgId, content)
  }

  /** Looks up a message anywhere in the tree, not only on the visible branch. */
  findMessage(id: string): ChatMessage | undefined {
    return this.allChatMessages.find((m) => m.id === id)
  }

  updateDraftContent(draftMsgId: string, content: string, replyTo?: ChatReplyTo[]): void {
    this.updateChatMessage(
      (m) => m.id === draftMsgId && !!m.draft,
      (m) => {
        const { replyTo: _old, ...rest } = m
        return { ...rest, content, ...(replyTo?.length ? { replyTo } : {}) }
      }
    )
  }

  async confirmDraft(draftMsgId: string): Promise<void> {
    // A script still deciding about it: the person's send waits for, not over, its answer.
    if (this.isStreaming.value || this.isCompacting.value || this.interceptor.working.value) return

    const draftMsg = this.allChatMessages.find((m) => m.id === draftMsgId)
    if (!draftMsg || !draftMsg.draft) return
    if (this.interceptor.streaming.value) return

    // Held by an interceptor's say, it goes on with the next one; stopped by a failure, it is
    // sent as it is. Either way the interceptors' side conversation folds away once it is sent.
    await sendHeld(this.scriptSendHost(), draftMsgId)
  }

  /**
   * A turn for a message already in the chat — a draft sent on, or one an interceptor script
   * let through — with what the script said about the turn's tool calls, if anything.
   */
  private async runTurnFor(bubble: ChatMessage, policy?: ToolPolicy): Promise<void> {
    const gen = this.generation
    this.errorPresentation.value = null
    this.error.value = null
    this.userMessageCount++
    this.wroteThisTurn = false
    this.turnPolicy.set(policy)

    this.rememberInternal(await this.modelMessage(bubble))

    try {
      await this.runAgentLoop()

      if (gen !== this.generation) return

      await this.save()

      await this.checkAnswer()
      await this.afterTurn()
    } finally {
      this.endTurnPolicy()
      await this.drainQueue()
    }
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

  private readonly fallbackTitleTime = Date.now()
  private fallbackTitle(): string {
    const firstUser = this.allChatMessages.find((m) => m.role === 'user')
    const snippet = firstUser
      ? firstUser.content.slice(0, ChatSession.FALLBACK_TITLE_LENGTH).replace(/\n/g, ' ')
      : 'Chat'
    return `${dayjs(firstUser?.timestamp ?? this.fallbackTitleTime).format('YYYY-MM-DD HH-mm')} ${snippet}`
  }

  getDebugData(): Record<string, unknown> {
    const tools = this.getTools().map((translationItem) => ({
      name: translationItem.name,
      description: translationItem.description,
      parameters: translationItem.parameters,
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
    // Twice is ordinary now: a comment being read in the sidebar is in `CommentService`'s map
    // and in `ChatService`'s, and at unload both dispose of what they hold. Everything below
    // is idempotent on its own, but `abort()` on a session already torn down is a second
    // abort signal raised over listeners that have gone.
    if (this.destroyed) return
    if (this.kind !== 'run') AgentsService.getInstance().untrack(this)
    this.destroyed = true
    this.draft.value.imports?.retire()
    this.draft.value = { text: '', attachments: [] }
    this.conversationVersion.value++
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.abort()
    this.abortBackground()
    this.allInternalMessages = []
    this.allChatMessages = []
    this.activeLeafId = null
    this.pendingBranchCut = undefined
    this.messages.value = []
    this.allMessages.value = []
    this.pendingToolCalls.value = []
    this.currentChatFile.value = null
    this.effects.stop()
    this.scopeResolver.destroy()
  }
}
