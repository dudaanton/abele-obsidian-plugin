import { computed, effectScope, ref, shallowRef, watch, type EffectScope } from 'vue'
import { TFile } from 'obsidian'
import { nanoid } from 'nanoid'
import dayjs from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { AgentLoop } from './client/AgentLoop'
import { OpenAIClient } from './client/OpenAIClient'
import type {
  AgentEvent,
  AgentTool,
  AgentToolResult,
  AssistantMessage,
  Message,
  ModelConfig,
  TextContent,
  ThinkingContent,
  ToolCallContent,
  ToolDefinition,
} from './client'
import { ChatStorage } from './ChatStorage'
import { ChatSummarizer, type SummarizerHost } from './ChatSummarizer'
import { ChatInterceptor, type InterceptorHost } from './ChatInterceptor'
import { AgentRegistry } from './agents/AgentRegistry'
import type {
  AgentDefinition,
  OverrideKey,
  ScopeEntry,
  SessionOverrides,
} from './agents/types'
import {
  ChatMessage,
  ChatMetadata,
  DEFAULT_AI_SETTINGS,
  CORE_TOOLS,
  migrateOldPermissions,
} from './types'
import type { ToolMode, PermissionMode, InterceptorChatMessage, AiSettings } from './types'
import type { UserContentPart } from './client'
import { createAgentTools } from './tools'
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

/** Shape returned by tools that provide diff details */
interface ToolDiffDetails {
  diff?: { old: string; new: string }
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
  private static readonly EDIT_TOOLS = ['edit', 'create', 'replace', 'write']
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
  private allChatMessages: ChatMessage[] = []
  private activeLeafId: string | null = null
  private userMessageCount = 0
  public readonly chatTitle = ref('')
  private chatCreated = ''
  private backgroundAbort: AbortController | null = null
  private toolAbortController: AbortController | null = null
  private generation = 0
  private lastModelId = ''

  // Reactive state for Vue components
  public readonly messages = ref<ChatMessage[]>([])
  public readonly allMessages = ref<ChatMessage[]>([])
  public readonly isStreaming = ref(false)
  public readonly streamingContent = ref('')
  public readonly streamingThinking = ref('')
  public readonly pendingToolCalls = ref<ToolCallContent[]>([])
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
    get: () => this.overrides.value.permissionMode ?? this.agent.value?.permissionMode ?? 'confirm-all',
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
  private readonly scopeEffects: EffectScope

  constructor(
    private readonly chatService: ChatService,
    id?: string
  ) {
    this.id = id || nanoid()
    this.scopeResolver = new ScopeResolver()
    this.summarizer = new ChatSummarizer(this)
    this.interceptor = new ChatInterceptor(this)
    this.agentId.value = AgentRegistry.getInstance().defaultAgent()?.id ?? ''
    this.scopeEffects = effectScope(true)
    this.scopeEffects.run(() => this.watchScope())
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
   * Points the chat at a different agent.
   *
   * Overrides are dropped: they were expressed against the previous agent, and carrying, say,
   * a narrowed tool set onto an agent that never had those tools is meaningless.
   */
  switchAgent(agentId: string): void {
    if (agentId === this.agentId.value) return
    this.agentId.value = agentId
    this.overrides.value = {}
    this.syncScopeFromAgent()
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

  private syncScopeFromAgent(): void {
    const entries = this.overrides.value.scope ?? this.agent.value?.scope ?? []
    const fullVault =
      this.overrides.value.fullVaultAccess ?? this.agent.value?.fullVaultAccess ?? false
    this.applyScope(entries, fullVault)
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
    return this.chatService.getAuxiliaryModelConfig()
  }

  activeModel(): ModelConfig | null {
    return this.chatService.getModelConfigFor(this.activeProviderId.value, this.activeModelId.value)
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
      : allTools.filter((tool) => CORE_TOOLS.has(tool.name) || this.getToolMode(tool.name) !== 'off')

    return this.wrapToolsForSession(filtered)
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

  needsApproval(toolName: string, args?: Record<string, unknown>): boolean {
    const mode = this.permissionMode.value

    // Out-of-scope file access always requires approval
    if (args && ChatSession.SCOPED_TOOLS.includes(toolName)) {
      const path = (args.path || args.from) as string
      if (path && !this.scopeResolver.isInScope(path)) {
        return true
      }
    }

    // Core read tools: never need approval
    if (ChatSession.READ_TOOLS.includes(toolName)) return false
    if (toolName === 'read_image' || toolName === 'questions') return false

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
          const am = msg as AssistantMessage

          if (am.errorMessage) {
            this.error.value = am.errorMessage
            console.error('[Abele AI]', am.errorMessage)
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

  private async runAgentLoop(): Promise<void> {
    this.isStreaming.value = true
    this.streamingContent.value = ''
    this.streamingThinking.value = ''
    this.error.value = null

    try {
      const model = this.chatService.getModelConfigFor(
        this.activeProviderId.value,
        this.activeModelId.value
      )
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
        beforeToolCall: async (toolName, _id, args) => {
          if (this.needsApproval(toolName, args)) {
            return { pause: true }
          }
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

  private async processAllPendingToolCalls(): Promise<void> {
    while (this.pendingToolCalls.value.length > 0) {
      const tc = this.pendingToolCalls.value[0]

      if (this.needsApproval(tc.name, tc.arguments)) {
        this.ensurePendingToolCallMessage(tc)
        await this.save()
        return // Wait for user approve/reject
      }

      // Auto-approved — execute immediately
      this.ensurePendingToolCallMessage(tc)
      await this.executeCurrentPendingTool()
    }

    // All pending tools resolved — restart loop
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

  async sendMessage(content: string, attachments?: string[]): Promise<void> {
    if (this.isStreaming.value || this.isCompacting.value) return

    // Draft mode: interceptor is active → create draft, don't send to main AI
    if (this.interceptor.isActive) {
      return this.sendDraftMessage(content, attachments)
    }

    const gen = this.generation
    this.error.value = null
    this.userMessageCount++

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
      this.allInternalMessages.push({
        role: 'user',
        content: allParts,
        timestamp: Date.now(),
        chatMessageId: userMsg.id,
      })
    } else {
      this.allInternalMessages.push({
        role: 'user',
        content,
        timestamp: Date.now(),
        chatMessageId: userMsg.id,
      })
    }

    await this.runAgentLoop()

    if (gen !== this.generation) return

    await this.save()

    const sequential = AbeleConfig.getInstance().ai.sequentialAuxiliary

    if (ChatSession.TITLE_GENERATION_TRIGGERS.includes(this.userMessageCount)) {
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

    const controller = new AbortController()
    this.toolAbortController = controller
    this.isExecutingTool.value = true
    try {
      await this.executeCurrentPendingTool(modifiedArgs, controller.signal)
    } finally {
      this.isExecutingTool.value = false
      this.toolAbortController = null
    }

    if (controller.signal.aborted) {
      await this.save()
      return
    }

    await this.processAllPendingToolCalls()
    await this.save()
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
    await this.save()
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
      await this.save()
    }
  }

  abort(): void {
    this.agentLoop?.abort()
    this.isStreaming.value = false
  }

  // ── Reset (new chat within this session / tab) ─────────────────

  async reset(): Promise<void> {
    this.generation++
    await this.save()
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
      overrides.toolModes = migrateOldPermissions(metadata, config as unknown as Record<string, any>)
    }

    if (metadata.scopeEntries) {
      overrides.scope = [...metadata.scopeEntries]
      overrides.fullVaultAccess = metadata.fullVaultAccess ?? false
    }

    return overrides
  }

  // ── Save / Load ────────────────────────────────────────────────

  async save(): Promise<void> {
    if (this.allChatMessages.length === 0) return

    const config = AbeleConfig.getInstance().ai
    const title = this.chatTitle.value || this.fallbackTitle()

    const overrides = this.overrides.value

    const metadata: ChatMetadata = {
      type: 'abele-chat',
      agentId: this.agentId.value || undefined,
      // Only what this chat actually changed. Writing the resolved values instead would freeze
      // the chat against today's agent and defeat the whole point of resolving on read.
      overrides: Object.keys(overrides).length ? { ...overrides } : undefined,
      // Kept for chats reopened by an older build, and for the history list, which shows the
      // model a chat ran on without loading the session.
      providerId: this.activeProviderId.value || config.activeProviderId,
      modelId: this.activeModelId.value || config.activeModelId,
      created: this.chatCreated || (this.chatCreated = dayjs().format('YYYY-MM-DD')),
      title,
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

    this.currentChatFile.value = await ChatStorage.getInstance().saveChat(
      this.allChatMessages,
      metadata,
      this.currentChatFile.value || undefined,
      this.allInternalMessages
    )

    // Update tab state so new chats get persisted
    this.chatService.saveTabs()
  }

  async load(file: TFile): Promise<void> {
    await this.reset()
    const result = await ChatStorage.getInstance().loadChat(file)

    this.allChatMessages = result.messages.map((m) => (m.id ? m : { ...m, id: nanoid() }))
    this.allInternalMessages = result.internalMessages || []
    this.currentChatFile.value = file
    this.chatTitle.value = result.metadata?.title || ''
    this.chatCreated = result.metadata?.created || ''

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
        ? this.allChatMessages.find((m) => m.id === current!.parentId)
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
    this.save()
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

  /** Get permissions snapshot for sub-agent runner */
  getPermissions(): Record<string, ToolMode> {
    return { ...this.toolModes.value }
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
    await this.save()
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

    await this.save()

    const sequential = AbeleConfig.getInstance().ai.sequentialAuxiliary

    if (ChatSession.TITLE_GENERATION_TRIGGERS.includes(this.userMessageCount)) {
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
    this.abort()
    this.abortBackground()
    this.allInternalMessages = []
    this.allChatMessages = []
    this.activeLeafId = null
    this.messages.value = []
    this.allMessages.value = []
    this.pendingToolCalls.value = []
    this.currentChatFile.value = null
    this.scopeEffects.stop()
    this.scopeResolver.destroy()
  }
}
