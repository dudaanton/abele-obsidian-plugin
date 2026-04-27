import { ref, shallowRef } from 'vue'
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
  TextContent,
  ThinkingContent,
  ToolCallContent,
} from './client'
import { ChatStorage } from './ChatStorage'
import { ChatMessage, ChatMetadata, DEFAULT_AI_SETTINGS } from './types'
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

import type { AgentService } from './AgentService'

/** Shape returned by tools that provide diff details */
interface ToolDiffDetails {
  diff?: { old: string; new: string }
}

export class ChatSession {
  /**
   * The session currently executing a tool or agent loop.
   * Set before tool/loop execution so DelegateTool can access session context.
   */
  private static _activeSession: ChatSession | null = null

  static getActiveSession(): ChatSession | null {
    return ChatSession._activeSession
  }

  private static readonly AUTO_COMPACT_THRESHOLD = 0.9
  private static readonly TITLE_MAX_TOKENS = 30
  private static readonly TITLE_MAX_LENGTH = 60
  private static readonly TITLE_MSG_PREVIEW_LENGTH = 200
  private static readonly TITLE_GENERATION_TRIGGERS = [1]
  private static readonly FALLBACK_TITLE_LENGTH = 50
  private static readonly COMPACT_SYSTEM_PROMPT =
    'You summarize conversations. Reply with ONLY the summary, nothing else.'
  private static readonly COMPACT_MARKER = '[Conversation compacted]'

  private static readonly READ_TOOLS = [
    'read',
    'ls',
    'find',
    'workspace',
    'skill',
    'script_api_docs',
  ]
  private static readonly EDIT_TOOLS = ['edit', 'create', 'replace']
  private static readonly SCOPED_TOOLS = [
    'read',
    'edit',
    'replace',
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

  // Per-chat model selection
  public readonly activeProviderId = ref('')
  public readonly activeModelId = ref('')

  // Per-chat tool permissions
  public readonly allowWebSearch = ref(true)
  public readonly allowFetch = ref(false)
  public readonly allowDownload = ref(false)
  public readonly allowWiseModel = ref(false)
  public readonly allowImageGeneration = ref(false)
  public readonly allowEvalJs = ref(false)
  public readonly allowCreateFiles = ref(true)
  public readonly allowDelegate = ref(false)
  public readonly allowScripts = ref(false)
  public readonly allowedScripts = ref<Record<string, boolean>>({})
  public readonly allowCreateScript = ref(false)
  public readonly allowReadLogs = ref(false)
  public readonly allowReadBacklinks = ref(false)
  public readonly allowReadTransactions = ref(false)
  public readonly allowReadTasks = ref(false)
  public readonly customSystemPrompt = ref('')
  public readonly customSystemPromptNotePath = ref('')

  // Per-session scope
  public readonly scopeResolver: ScopeResolver

  constructor(
    private readonly agentService: AgentService,
    id?: string
  ) {
    this.id = id || nanoid()
    this.scopeResolver = new ScopeResolver()
    this.resetPermissions()
    this.resetScope()
  }

  // ── Permission / scope reset ────────────────────────────────────

  private resetPermissions(): void {
    const config = AbeleConfig.getInstance().ai
    this.activeProviderId.value = config.activeProviderId
    this.activeModelId.value = config.activeModelId
    this.allowWebSearch.value = config.allowWebSearch
    this.allowFetch.value = config.allowFetch
    this.allowDownload.value = config.allowDownload
    this.allowWiseModel.value = config.allowWiseModel
    this.allowImageGeneration.value = config.allowImageGeneration
    this.allowEvalJs.value = config.allowEvalJs
    this.allowCreateFiles.value = config.allowCreateFiles ?? true
    this.allowDelegate.value = config.allowDelegate ?? false
    this.allowScripts.value = config.allowScripts ?? false
    this.allowedScripts.value = { ...(config.scriptToolToggles || {}) }
    this.allowCreateScript.value = config.allowCreateScript ?? false
    this.allowReadLogs.value = config.allowReadLogs ?? false
    this.allowReadBacklinks.value = config.allowReadBacklinks ?? false
    this.allowReadTransactions.value = config.allowReadTransactions ?? false
    this.allowReadTasks.value = config.allowReadTasks ?? false
  }

  private resetScope(): void {
    const config = AbeleConfig.getInstance().ai
    this.scopeResolver.clear()
    this.scopeResolver.setFullVaultAccess(config.defaultFullVaultAccess)
    for (const entry of config.defaultScope || []) {
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
  }

  // ── Tools with session scope ────────────────────────────────────

  private getTools(): AgentTool[] {
    const tools = createAgentTools()
    return this.wrapToolsForSession(tools)
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
    const mode = AbeleConfig.getInstance().ai.permissionMode

    // Out-of-scope file access always requires approval
    if (args && ChatSession.SCOPED_TOOLS.includes(toolName)) {
      const path = (args.path || args.from) as string
      if (path && !this.scopeResolver.isInScope(path)) {
        return true
      }
    }

    if (ChatSession.READ_TOOLS.includes(toolName)) return false
    if (toolName === 'create' || toolName === 'apply_template') return !this.allowCreateFiles.value
    if (toolName === 'delegate') return !this.allowDelegate.value
    if (toolName.startsWith('script_'))
      return !this.allowScripts.value && !this.allowedScripts.value[toolName]
    if (toolName === 'create_script') return !this.allowCreateScript.value
    if (toolName === 'web_search') return !this.allowWebSearch.value
    if (toolName === 'fetch') return !this.allowFetch.value
    if (toolName === 'download_image' || toolName === 'download_file')
      return !this.allowDownload.value
    if (toolName === 'wise_model') return !this.allowWiseModel.value
    if (toolName === 'generate_image' || toolName === 'edit_image')
      return !this.allowImageGeneration.value
    if (toolName === 'eval_js') return !this.allowEvalJs.value
    if (toolName === 'read_logs') return !this.allowReadLogs.value
    if (toolName === 'read_backlinks') return !this.allowReadBacklinks.value
    if (toolName === 'read_transactions') return !this.allowReadTransactions.value
    if (toolName === 'read_tasks') return !this.allowReadTasks.value
    if (toolName === 'read_image') return false
    if (
      ChatSession.EDIT_TOOLS.includes(toolName) &&
      (mode === 'allow-edit' || mode === 'allow-all')
    )
      return false
    if (mode === 'allow-all') return false
    return true
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

    let assistantIdx = 0
    for (const msg of newMsgs) {
      if (msg.role === 'assistant') {
        if (assistantIdx < assistantChatMsgs.length) {
          msg.chatMessageId = assistantChatMsgs[assistantIdx].id
          assistantIdx++
        }
      } else if (msg.role === 'toolResult') {
        const chatMsg = runChatMsgs.find((m) => m.toolCallId === msg.toolCallId)
        if (chatMsg) msg.chatMessageId = chatMsg.id
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
      if (m.role === 'system' && m.content.startsWith(ChatSession.COMPACT_MARKER)) {
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
      const model = this.agentService.getModelConfigFor(
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
        systemPrompt: await this.agentService.getSystemPrompt(this),
        tools,
        messages: toSend,
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
        await this.generateTitle()
      } else {
        this.generateTitle().catch(() => {
          return
        })
      }
    }

    if (sequential) {
      await this.autoCompactIfNeeded()
    } else {
      this.autoCompactIfNeeded().catch(() => {
        return
      })
    }
  }

  async approveToolCall(modifiedArgs?: Record<string, unknown>): Promise<void> {
    if (this.isStreaming.value || this.isExecutingTool.value) return
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
    this.unsubscribe?.()
    this.unsubscribe = null
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
    this.resetPermissions()
    this.resetScope()
  }

  // ── Save / Load ────────────────────────────────────────────────

  async save(): Promise<void> {
    if (this.allChatMessages.length === 0) return

    const config = AbeleConfig.getInstance().ai
    const title = this.chatTitle.value || this.fallbackTitle()

    const metadata: ChatMetadata = {
      type: 'abele-chat',
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
      allowWebSearch: this.allowWebSearch.value,
      allowFetch: this.allowFetch.value,
      allowDownload: this.allowDownload.value,
      allowWiseModel: this.allowWiseModel.value,
      allowImageGeneration: this.allowImageGeneration.value,
      allowEvalJs: this.allowEvalJs.value,
      allowCreateFiles: this.allowCreateFiles.value,
      allowDelegate: this.allowDelegate.value,
      allowScripts: this.allowScripts.value,
      allowedScripts: this.allowedScripts.value,
      allowCreateScript: this.allowCreateScript.value,
      allowReadLogs: this.allowReadLogs.value,
      allowReadBacklinks: this.allowReadBacklinks.value,
      allowReadTransactions: this.allowReadTransactions.value,
      allowReadTasks: this.allowReadTasks.value,
      scopeEntries: this.scopeResolver.entries.value.length
        ? [...this.scopeResolver.entries.value]
        : undefined,
      fullVaultAccess: this.scopeResolver.fullVaultAccess.value || undefined,
      activeLeafId: this.activeLeafId || undefined,
      customSystemPrompt: this.customSystemPrompt.value || undefined,
      customSystemPromptNotePath: this.customSystemPromptNotePath.value || undefined,
    }

    this.currentChatFile.value = await ChatStorage.getInstance().saveChat(
      this.allChatMessages,
      metadata,
      this.currentChatFile.value || undefined,
      this.allInternalMessages
    )
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

    // Restore per-chat model and permissions
    const config = AbeleConfig.getInstance().ai
    this.activeProviderId.value = result.metadata?.providerId ?? config.activeProviderId
    this.activeModelId.value = result.metadata?.modelId ?? config.activeModelId
    this.allowWebSearch.value = result.metadata?.allowWebSearch ?? config.allowWebSearch
    this.allowFetch.value = result.metadata?.allowFetch ?? config.allowFetch
    this.allowDownload.value = result.metadata?.allowDownload ?? config.allowDownload
    this.allowWiseModel.value = result.metadata?.allowWiseModel ?? config.allowWiseModel
    this.allowImageGeneration.value =
      result.metadata?.allowImageGeneration ?? config.allowImageGeneration
    this.allowEvalJs.value = result.metadata?.allowEvalJs ?? config.allowEvalJs
    this.allowCreateFiles.value =
      result.metadata?.allowCreateFiles ?? config.allowCreateFiles ?? true
    this.allowDelegate.value = result.metadata?.allowDelegate ?? config.allowDelegate ?? false
    this.allowScripts.value = result.metadata?.allowScripts ?? config.allowScripts ?? false
    this.allowedScripts.value = {
      ...(config.allowedScripts || {}),
      ...(result.metadata?.allowedScripts || {}),
    }
    this.allowCreateScript.value =
      result.metadata?.allowCreateScript ?? config.allowCreateScript ?? false
    this.allowReadLogs.value = result.metadata?.allowReadLogs ?? config.allowReadLogs ?? false
    this.allowReadBacklinks.value =
      result.metadata?.allowReadBacklinks ?? config.allowReadBacklinks ?? false
    this.allowReadTransactions.value =
      result.metadata?.allowReadTransactions ?? config.allowReadTransactions ?? false
    this.allowReadTasks.value = result.metadata?.allowReadTasks ?? config.allowReadTasks ?? false

    // Restore scope
    if (result.metadata?.scopeEntries) {
      this.scopeResolver.clear()
      this.scopeResolver.setFullVaultAccess(result.metadata.fullVaultAccess ?? false)
      for (const entry of result.metadata.scopeEntries) {
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
    }

    this.customSystemPrompt.value = result.metadata?.customSystemPrompt || ''
    this.customSystemPromptNotePath.value = result.metadata?.customSystemPromptNotePath || ''

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
    if (this.isStreaming.value || this.pendingToolCalls.value.length > 0) return

    const msg = this.allChatMessages.find((m) => m.id === messageId)
    if (!msg || msg.role !== 'user') return

    this.activeLeafId = msg.parentId || null
    this.updateVisibleMessages()

    this.sendMessage(msg.content, msg.attachments)
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
  getPermissions(): {
    allowWebSearch: boolean
    allowFetch: boolean
    allowDownload: boolean
    allowWiseModel: boolean
    allowImageGeneration: boolean
    allowEvalJs: boolean
    allowCreateFiles: boolean
    allowScripts: boolean
    allowedScripts: Record<string, boolean>
    allowCreateScript: boolean
    allowReadLogs: boolean
    allowReadBacklinks: boolean
    allowReadTransactions: boolean
    allowReadTasks: boolean
  } {
    return {
      allowWebSearch: this.allowWebSearch.value,
      allowFetch: this.allowFetch.value,
      allowDownload: this.allowDownload.value,
      allowWiseModel: this.allowWiseModel.value,
      allowImageGeneration: this.allowImageGeneration.value,
      allowEvalJs: this.allowEvalJs.value,
      allowCreateFiles: this.allowCreateFiles.value,
      allowScripts: this.allowScripts.value,
      allowedScripts: { ...this.allowedScripts.value },
      allowCreateScript: this.allowCreateScript.value,
      allowReadLogs: this.allowReadLogs.value,
      allowReadBacklinks: this.allowReadBacklinks.value,
      allowReadTransactions: this.allowReadTransactions.value,
      allowReadTasks: this.allowReadTasks.value,
    }
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

  private async generateTitle(): Promise<void> {
    this.isGeneratingTitle.value = true
    try {
      const config = AbeleConfig.getInstance().ai
      const model = this.agentService.getAuxiliaryModelConfig()
      const client = new OpenAIClient()
      const msgs = this.messages.value
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(0, 6)
        .map((m) => `[${m.role}]: ${m.content.slice(0, ChatSession.TITLE_MSG_PREVIEW_LENGTH)}`)
        .join('\n')

      const titlePrompt = (
        config.prompts?.titleGeneration || DEFAULT_AI_SETTINGS.prompts.titleGeneration
      ).replace('{{messages}}', msgs)
      const titleSystem = config.prompts?.titleSystem || DEFAULT_AI_SETTINGS.prompts.titleSystem

      const titleMessages: Message[] = [
        {
          role: 'user',
          content: titlePrompt,
          timestamp: Date.now(),
        },
      ]

      const tools = this.getTools()
      const toolDefs = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))

      let title = ''
      const signal = this.getBackgroundSignal()
      for await (const event of client.stream(model, titleSystem, titleMessages, toolDefs, {
        signal,
      })) {
        if (event.type === 'text_delta') title += event.delta
      }

      title = title
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/[\\/:*?"<>|]/g, '-')
        .slice(0, ChatSession.TITLE_MAX_LENGTH)

      if (!title || title === this.chatTitle.value) return

      this.chatTitle.value = title

      if (this.currentChatFile.value) {
        const storage = ChatStorage.getInstance()
        const newFile = await storage.renameChat(this.currentChatFile.value, title)
        if (newFile) {
          this.currentChatFile.value = newFile
        }
      }
    } catch {
      // Silently fail — title generation is best-effort
    } finally {
      this.isGeneratingTitle.value = false
    }
  }

  async compact(): Promise<void> {
    if (this.allInternalMessages.length === 0) return
    if (this.isStreaming.value || this.isCompacting.value || this.isGeneratingTitle.value) return

    this.isCompacting.value = true
    this.error.value = null

    try {
      const config = AbeleConfig.getInstance().ai
      const model = this.agentService.getAuxiliaryModelConfig()
      const client = new OpenAIClient()

      const modelMsgs = this.getMessagesForModel()

      const msgsText = modelMsgs
        .map((m) => {
          if (m.role === 'user') return `[user]: ${m.content}`
          if (m.role === 'assistant') {
            const text = m.content
              .filter((b): b is TextContent => b.type === 'text')
              .map((b) => b.text)
              .join('')
            return text ? `[assistant]: ${text}` : null
          }
          if (m.role === 'toolResult') {
            return `[tool ${m.toolName}]: ${m.content.map((c) => c.text).join('')}`
          }
          return null
        })
        .filter(Boolean)
        .join('\n\n')

      if (!msgsText) return

      const compactPrompt = (
        config.prompts?.compactPrompt || DEFAULT_AI_SETTINGS.prompts.compactPrompt
      ).replace('{{messages}}', msgsText)

      const compactMessages: Message[] = [
        { role: 'user', content: compactPrompt, timestamp: Date.now() },
      ]

      const tools = this.getTools()
      const toolDefs = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))

      let summary = ''
      const signal = this.getBackgroundSignal()
      for await (const event of client.stream(
        model,
        ChatSession.COMPACT_SYSTEM_PROMPT,
        compactMessages,
        toolDefs,
        { signal }
      )) {
        if (event.type === 'text_delta') summary += event.delta
      }

      summary = summary.trim()
      if (!summary) return

      const divider: ChatMessage = {
        id: nanoid(),
        role: 'system',
        content: summary,
        timestamp: Date.now(),
      }
      this.appendChatMessage(divider)
      this.updateVisibleMessages()

      const compactMarker: Message = {
        role: 'system',
        content: `${ChatSession.COMPACT_MARKER}\n\n${summary}`,
        timestamp: Date.now(),
        chatMessageId: divider.id,
      }
      this.allInternalMessages.push(compactMarker)

      await this.save()
    } catch (err: unknown) {
      console.error('[Abele] compact error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      this.error.value = `Compact failed: ${msg}`
    } finally {
      this.isCompacting.value = false
    }
  }

  private async autoCompactIfNeeded(): Promise<void> {
    try {
      const model = this.agentService.getModelConfigFor(
        this.activeProviderId.value,
        this.activeModelId.value
      )
      if (!model.contextWindow) return

      const lastAssistant = [...this.messages.value]
        .reverse()
        .find((m) => m.role === 'assistant' && m.usage)
      if (!lastAssistant?.usage) return

      const usage = lastAssistant.usage.total
      const threshold = model.contextWindow * ChatSession.AUTO_COMPACT_THRESHOLD

      if (usage >= threshold && this.getMessagesForModel().length > 2) {
        await this.compact()
      }
    } catch {
      // Auto-compact is best-effort
    }
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
      systemPrompt: this.agentService.getSystemPrompt(this),
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
    this.scopeResolver.destroy()
  }
}
