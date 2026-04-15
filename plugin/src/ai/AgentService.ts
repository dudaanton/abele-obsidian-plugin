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
  ModelConfig,
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
import { getNoteBody } from '@/helpers/notesUtils'
import {
  getPathToLeaf,
  getSiblings,
  findDeepestLeaf,
  findDefaultLeaf,
  getInternalMessagesForPath,
  backfillParentIds,
  backfillChatMessageIds,
} from './chatTree'

/** Shape returned by tools that provide diff details */
interface ToolDiffDetails {
  diff?: { old: string; new: string }
}

export class AgentService {
  private static instance: AgentService | null = null

  private static readonly AUTO_COMPACT_THRESHOLD = 0.9
  private static readonly TITLE_MAX_TOKENS = 30
  private static readonly TITLE_MAX_LENGTH = 60
  private static readonly TITLE_MSG_PREVIEW_LENGTH = 200
  private static readonly TITLE_GENERATION_TRIGGERS = [1]
  private static readonly FALLBACK_TITLE_LENGTH = 50
  private static readonly COMPACT_SYSTEM_PROMPT =
    'You summarize conversations. Reply with ONLY the summary, nothing else.'

  private agentLoop: AgentLoop | null = null
  private unsubscribe: (() => void) | null = null
  private streamStartTime = 0
  private allInternalMessages: Message[] = []
  private allChatMessages: ChatMessage[] = []
  private activeLeafId: string | null = null
  private userMessageCount = 0
  private chatTitle = ''
  private chatCreated = ''
  private backgroundAbort: AbortController | null = null
  private toolAbortController: AbortController | null = null
  private chatSessionId = 0
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
  // Per-chat tool permissions (initialized from defaults on new chat)
  public readonly allowWebSearch = ref(true)
  public readonly allowFetch = ref(false)
  public readonly allowWiseModel = ref(false)
  public readonly allowImageGeneration = ref(false)
  public readonly allowEvalJs = ref(false)
  public readonly customSystemPrompt = ref('')
  public readonly customSystemPromptNotePath = ref('')

  static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService()
    }
    return AgentService.instance
  }

  private getActiveModelConfig(): ModelConfig {
    const config = AbeleConfig.getInstance().ai

    // Find explicitly selected provider/model, or fall back to first available
    let provider = config.providers.find((p) => p.id === config.activeProviderId)
    if (!provider || provider.models.length === 0) {
      provider = config.providers.find((p) => p.models.length > 0)
    }
    if (!provider) throw new Error('No provider with models configured')

    let model = provider.models.find((m) => m.id === config.activeModelId)
    if (!model) {
      model = provider.models[0]
    }

    return {
      id: model.id,
      name: model.name,
      baseUrl: provider.baseUrl,
      apiKey: GlobalStore.getInstance().app.secretStorage.getSecret(provider.apiKeyId) || '',
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      supportsReasoning: model.supportsReasoning,
    }
  }

  private getAuxiliaryModelConfig(): ModelConfig {
    const config = AbeleConfig.getInstance().ai
    if (!config.auxiliaryModelId) return this.getActiveModelConfig()

    for (const provider of config.providers) {
      const model = provider.models.find((m) => m.id === config.auxiliaryModelId)
      if (model) {
        return {
          id: model.id,
          name: model.name,
          baseUrl: provider.baseUrl,
          apiKey: GlobalStore.getInstance().app.secretStorage.getSecret(provider.apiKeyId) || '',
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          supportsReasoning: model.supportsReasoning,
        }
      }
    }

    return this.getActiveModelConfig()
  }

  private async getSystemPrompt(): Promise<string> {
    const date = dayjs().format('YYYY-MM-DD')

    // Per-chat override: note path
    if (this.customSystemPromptNotePath.value) {
      const body = await this.readNoteBody(this.customSystemPromptNotePath.value)
      if (body) return body.replace(/\{\{date\}\}/g, date)
    }

    // Per-chat override: inline text
    if (this.customSystemPrompt.value) {
      return this.customSystemPrompt.value.replace(/\{\{date\}\}/g, date)
    }

    // Global: note path
    const config = AbeleConfig.getInstance().ai
    if (config.systemPromptFromNote && config.systemPromptNotePath) {
      const body = await this.readNoteBody(config.systemPromptNotePath)
      if (body) return body.replace(/\{\{date\}\}/g, date)
    }

    // Global: inline text
    const base = config.prompts?.system || DEFAULT_AI_SETTINGS.prompts.system
    return base.replace(/\{\{date\}\}/g, date)
  }

  private async readNoteBody(path: string): Promise<string | null> {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return null
    const content = await app.vault.cachedRead(file)
    return getNoteBody(content).trim() || null
  }

  private getBackgroundSignal(): AbortSignal {
    if (!this.backgroundAbort) this.backgroundAbort = new AbortController()
    return this.backgroundAbort.signal
  }

  private abortBackground(): void {
    this.backgroundAbort?.abort()
    this.backgroundAbort = null
  }

  private getTools(): AgentTool[] {
    return createAgentTools()
  }

  private static readonly READ_TOOLS = ['read', 'ls', 'find', 'workspace', 'skill']
  private static readonly EDIT_TOOLS = ['edit', 'create']

  private needsApproval(toolName: string, args?: Record<string, unknown>): boolean {
    const mode = AbeleConfig.getInstance().ai.permissionMode
    if (AgentService.READ_TOOLS.includes(toolName)) return false
    if (toolName === 'web_search') return !this.allowWebSearch.value
    if (toolName === 'fetch') return !this.allowFetch.value
    if (toolName === 'wise_model') return !this.allowWiseModel.value
    if (toolName === 'generate_image' || toolName === 'edit_image')
      return !this.allowImageGeneration.value
    if (toolName === 'eval_js') return !this.allowEvalJs.value
    // read_image: auto-approve if the image is in workspace scope
    if (toolName === 'read_image' && args?.path) {
      return !ScopeResolver.getInstance().isInScope(args.path as string)
    }
    if (
      AgentService.EDIT_TOOLS.includes(toolName) &&
      (mode === 'allow-edit' || mode === 'allow-all')
    )
      return false
    if (mode === 'allow-all') return false
    return true
  }

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

          // Always add assistant message (even if empty — needed for tool call grouping)
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
          // Only add visible entry for errors (tool_end already updated the tool-call message)
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

  // ── Tree helpers ─────────────────────────────────────────────

  /** Append a ChatMessage to the tree with parentId = activeLeafId, update activeLeafId */
  private appendChatMessage(msg: ChatMessage): void {
    msg.parentId = this.activeLeafId || undefined
    this.allChatMessages.push(msg)
    this.activeLeafId = msg.id
  }

  /** Rebuild the visible messages ref from the active branch path */
  private updateVisibleMessages(): void {
    if (!this.activeLeafId) {
      this.messages.value = []
    } else {
      this.messages.value = getPathToLeaf(this.allChatMessages, this.activeLeafId)
    }
    this.allMessages.value = [...this.allChatMessages]
  }

  /**
   * Update a ChatMessage in the tree by predicate (e.g. match toolCallId).
   * Also refreshes the visible messages ref.
   */
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

  /** Link new internal messages from an agent run to their ChatMessages */
  private linkInternalMessages(newMsgs: Message[]): void {
    // Collect assistant and tool-call ChatMessages created during this run
    // (everything after the last user message in the active path)
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

  private static COMPACT_MARKER = '[Conversation compacted]'

  /** Get messages to send to the model — from the last compact marker onwards */
  private getMessagesForModel(): Message[] {
    const path = this.activeLeafId
      ? getPathToLeaf(this.allChatMessages, this.activeLeafId)
      : this.allChatMessages
    const internal = getInternalMessagesForPath(path, this.allInternalMessages)

    for (let i = internal.length - 1; i >= 0; i--) {
      const m = internal[i]
      if (m.role === 'system' && m.content.startsWith(AgentService.COMPACT_MARKER)) {
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
      const model = this.getActiveModelConfig()
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
        systemPrompt: await this.getSystemPrompt(),
        tools,
        messages: toSend,
        beforeToolCall: async (toolName, _id, args) => {
          if (this.needsApproval(toolName, args)) {
            return { pause: true }
          }
        },
      })

      // Append only new messages to the full history (append-only)
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
   * Process pending tool calls one by one.
   * Auto-approved tools are executed immediately.
   * Tools needing approval create a pending ChatMessage and wait.
   * When all resolved, restarts the agent loop.
   */
  private async processAllPendingToolCalls(): Promise<void> {
    while (this.pendingToolCalls.value.length > 0) {
      const tc = this.pendingToolCalls.value[0]

      if (this.needsApproval(tc.name, tc.arguments)) {
        // Add ChatMessage for the pending tool call (if not already there)
        this.ensurePendingToolCallMessage(tc)
        await this.saveCurrentChat()
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

  /**
   * Execute the first pending tool call and update messages.
   */
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

    // Find the tool-call ChatMessage to link internal messages
    const toolChatMsg = this.allChatMessages.find(
      (m) => m.role === 'tool-call' && m.toolCallId === tc.id
    )

    // Update the ChatMessage with result
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

    // Add to internal messages
    this.allInternalMessages.push({
      role: 'toolResult',
      toolCallId: tc.id,
      toolName: tc.name,
      content: toolResult.content,
      isError,
      timestamp: Date.now(),
      chatMessageId: toolChatMsg?.id,
    })

    // Inject extra messages (e.g. image content from read_image)
    if (toolResult.injectMessages?.length) {
      for (const injected of toolResult.injectMessages) {
        injected.chatMessageId = toolChatMsg?.id
      }
      this.allInternalMessages.push(...toolResult.injectMessages)
    }

    // Remove from pending
    this.pendingToolCalls.value = this.pendingToolCalls.value.slice(1)
  }

  // ── Public API ──────────────────────────────────────────────────

  async sendMessage(content: string, attachments?: string[]): Promise<void> {
    if (this.isStreaming.value || this.isCompacting.value) return

    const session = this.chatSessionId
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

    // Chat was reset (e.g. user clicked "new chat") — stop processing
    if (session !== this.chatSessionId) return

    await this.saveCurrentChat()

    const sequential = AbeleConfig.getInstance().ai.sequentialAuxiliary

    if (AgentService.TITLE_GENERATION_TRIGGERS.includes(this.userMessageCount)) {
      if (sequential) {
        await this.generateTitle()
      } else {
        this.generateTitle().catch(() => {
          return
        })
      }
    }

    // Auto-compact if near context limit
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

    // Immediately mark as approved so the approval dialog disappears
    this.updateChatMessage(
      (m) => m.toolCallId === tc.id && m.toolStatus === 'pending',
      (m) => ({ ...m, toolStatus: 'approved' as const })
    )

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
      await this.saveCurrentChat()
      return
    }

    await this.processAllPendingToolCalls()
    await this.saveCurrentChat()
  }

  abortToolExecution(): void {
    this.toolAbortController?.abort()
  }

  async rejectToolCall(reason?: string): Promise<void> {
    if (this.isStreaming.value) return
    const tc = this.pendingToolCalls.value[0]
    if (!tc) return

    const reasonText = reason || 'User rejected this action'

    // Update ChatMessage
    const toolChatMsg = this.allChatMessages.find(
      (m) => m.toolCallId === tc.id && m.toolStatus === 'pending'
    )
    this.updateChatMessage(
      (m) => m.toolCallId === tc.id && m.toolStatus === 'pending',
      (m) => ({ ...m, toolResult: reasonText, toolStatus: 'rejected' as const })
    )

    // Add error result to internal messages
    this.allInternalMessages.push({
      role: 'toolResult',
      toolCallId: tc.id,
      toolName: tc.name,
      content: [{ type: 'text', text: reasonText }],
      isError: true,
      timestamp: Date.now(),
      chatMessageId: toolChatMsg?.id,
    })

    // Remove from pending
    this.pendingToolCalls.value = this.pendingToolCalls.value.slice(1)

    await this.processAllPendingToolCalls()
    await this.saveCurrentChat()
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
      await this.saveCurrentChat()
    }
  }

  abort(): void {
    this.agentLoop?.abort()
    this.unsubscribe?.()
    this.unsubscribe = null
    this.isStreaming.value = false
  }

  async newChat(): Promise<void> {
    this.chatSessionId++
    await this.saveCurrentChat()
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
    this.chatTitle = ''
    this.chatCreated = ''
    this.lastModelId = ''
    this.customSystemPrompt.value = ''
    this.customSystemPromptNotePath.value = ''
    // Reset per-chat permissions from defaults
    const config = AbeleConfig.getInstance().ai
    this.allowWebSearch.value = config.allowWebSearch
    this.allowFetch.value = config.allowFetch
    this.allowWiseModel.value = config.allowWiseModel
    this.allowImageGeneration.value = config.allowImageGeneration
    this.allowEvalJs.value = config.allowEvalJs
    // Reset scope from defaults
    const scope = ScopeResolver.getInstance()
    scope.clear()
    scope.setFullVaultAccess(config.defaultFullVaultAccess)
    for (const entry of config.defaultScope || []) {
      switch (entry.type) {
        case 'file':
          scope.addFile(entry.path)
          break
        case 'folder':
          scope.addFolder(entry.path)
          break
        case 'pattern':
          scope.addPattern(entry.path)
          break
        case 'group':
          scope.addGroup(entry.path)
          break
      }
    }
  }

  async saveCurrentChat(): Promise<void> {
    if (this.allChatMessages.length === 0) return

    const config = AbeleConfig.getInstance().ai
    const title = this.chatTitle || this.fallbackTitle()

    const metadata: ChatMetadata = {
      type: 'abele-chat',
      providerId: config.activeProviderId,
      modelId: config.activeModelId,
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
      allowWiseModel: this.allowWiseModel.value,
      allowImageGeneration: this.allowImageGeneration.value,
      allowEvalJs: this.allowEvalJs.value,
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

  async loadChat(file: TFile): Promise<void> {
    await this.newChat()
    const result = await ChatStorage.getInstance().loadChat(file)

    // Ensure all messages have IDs
    this.allChatMessages = result.messages.map((m) => (m.id ? m : { ...m, id: nanoid() }))
    this.allInternalMessages = result.internalMessages || []
    this.currentChatFile.value = file
    this.chatTitle = result.metadata?.title || ''
    this.chatCreated = result.metadata?.created || ''

    // Migrate old flat format → tree format once, then resave
    const needsMigration =
      this.allChatMessages.length > 1 && !this.allChatMessages.some((m) => m.parentId)
    if (needsMigration) {
      backfillParentIds(this.allChatMessages)
      backfillChatMessageIds(this.allChatMessages, this.allInternalMessages)
    }

    // Resolve active branch
    this.activeLeafId =
      result.metadata?.activeLeafId || findDefaultLeaf(this.allChatMessages)?.id || null
    this.updateVisibleMessages()

    if (needsMigration) {
      await this.saveCurrentChat()
    }

    // Count existing user messages for title generation logic
    this.userMessageCount = this.messages.value.filter((m) => m.role === 'user').length

    // Restore per-chat permissions (fallback to defaults for old chats)
    const config = AbeleConfig.getInstance().ai
    this.allowWebSearch.value = result.metadata?.allowWebSearch ?? config.allowWebSearch
    this.allowFetch.value = result.metadata?.allowFetch ?? config.allowFetch
    this.allowWiseModel.value = result.metadata?.allowWiseModel ?? config.allowWiseModel
    this.allowImageGeneration.value =
      result.metadata?.allowImageGeneration ?? config.allowImageGeneration
    this.allowEvalJs.value = result.metadata?.allowEvalJs ?? config.allowEvalJs
    this.customSystemPrompt.value = result.metadata?.customSystemPrompt || ''
    this.customSystemPromptNotePath.value = result.metadata?.customSystemPromptNotePath || ''

    // Restore pending tool calls from metadata
    if (result.metadata?.pendingToolCalls?.length) {
      this.pendingToolCalls.value = result.metadata.pendingToolCalls.map((tc) => ({
        type: 'toolCall' as const,
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      }))
    }
  }

  // ── Other methods ──────────────────────────────────────────────

  private fallbackTitle(): string {
    const firstUser = this.messages.value.find((m) => m.role === 'user')
    const snippet = firstUser
      ? firstUser.content.slice(0, AgentService.FALLBACK_TITLE_LENGTH).replace(/\n/g, ' ')
      : 'Chat'
    return `${dayjs().format('YYYY-MM-DD HH-mm')} ${snippet}`
  }

  private async generateTitle(): Promise<void> {
    this.isGeneratingTitle.value = true
    try {
      const config = AbeleConfig.getInstance().ai
      const model = this.getAuxiliaryModelConfig()
      const client = new OpenAIClient()
      const msgs = this.messages.value
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(0, 6)
        .map((m) => `[${m.role}]: ${m.content.slice(0, AgentService.TITLE_MSG_PREVIEW_LENGTH)}`)
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

      // Pass agent tools to the model: reasoning models (e.g. qwen3) produce
      // excessive thinking tokens without tools in the request, and a low
      // max_completion_tokens makes it even worse.  Keeping tools + default
      // max_tokens matches the main chat behaviour where reasoning is minimal.
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
        .slice(0, AgentService.TITLE_MAX_LENGTH)

      if (!title || title === this.chatTitle) return

      this.chatTitle = title

      // Rename the file to match the new title
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
      const model = this.getAuxiliaryModelConfig()
      const client = new OpenAIClient()

      // Summarize everything the model currently sees
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

      // Pass agent tools — see comment in generateTitle() for rationale
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
        AgentService.COMPACT_SYSTEM_PROMPT,
        compactMessages,
        toolDefs,
        { signal }
      )) {
        if (event.type === 'text_delta') summary += event.delta
      }

      summary = summary.trim()
      if (!summary) return

      // Insert a visual divider in UI messages
      const divider: ChatMessage = {
        id: nanoid(),
        role: 'system',
        content: summary,
        timestamp: Date.now(),
      }
      this.appendChatMessage(divider)
      this.updateVisibleMessages()

      // Append compact marker to internal messages, linked to the divider
      const compactMarker: Message = {
        role: 'system',
        content: `${AgentService.COMPACT_MARKER}\n\n${summary}`,
        timestamp: Date.now(),
        chatMessageId: divider.id,
      }
      this.allInternalMessages.push(compactMarker)

      await this.saveCurrentChat()
    } catch (err: unknown) {
      console.error('[Abele] compact error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      this.error.value = `Compact failed: ${msg}`
    } finally {
      this.isCompacting.value = false
    }
  }

  /** Check if context is near limit and auto-compact */
  private async autoCompactIfNeeded(): Promise<void> {
    try {
      const model = this.getActiveModelConfig()
      if (!model.contextWindow) return

      // Get last assistant message's input tokens as current usage
      const lastAssistant = [...this.messages.value]
        .reverse()
        .find((m) => m.role === 'assistant' && m.usage)
      if (!lastAssistant?.usage) return

      const usage = lastAssistant.usage.total
      const threshold = model.contextWindow * AgentService.AUTO_COMPACT_THRESHOLD

      if (usage >= threshold && this.getMessagesForModel().length > 2) {
        await this.compact()
      }
    } catch {
      // Auto-compact is best-effort
    }
  }

  getDebugData(): Record<string, unknown> {
    const tools = this.getTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
    return {
      systemPrompt: this.getSystemPrompt(),
      tools,
      internalMessages: this.allInternalMessages,
      pendingToolCalls: this.pendingToolCalls.value.length
        ? this.pendingToolCalls.value
        : undefined,
    }
  }

  createBranch(messageId: string): void {
    if (this.isStreaming.value || this.pendingToolCalls.value.length > 0) return
    this.activeLeafId = messageId
    this.updateVisibleMessages()
  }

  repeatMessage(messageId: string): void {
    if (this.isStreaming.value || this.pendingToolCalls.value.length > 0) return

    const msg = this.allChatMessages.find((m) => m.id === messageId)
    if (!msg || msg.role !== 'user') return

    // Set active leaf to the parent — everything after disappears
    this.activeLeafId = msg.parentId || null
    this.updateVisibleMessages()

    // Resend the same content (creates a sibling branch from the same point)
    this.sendMessage(msg.content, msg.attachments)
  }

  switchBranch(messageId: string): void {
    if (this.isStreaming.value) return
    const leaf = findDeepestLeaf(this.allChatMessages, messageId)
    this.activeLeafId = leaf.id
    this.updateVisibleMessages()
    this.saveCurrentChat()
  }

  switchModel(providerId: string, modelId: string): void {
    const config = AbeleConfig.getInstance()
    config.ai.activeProviderId = providerId
    config.ai.activeModelId = modelId
    config.saveSettings()
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
    AgentService.instance = null
  }
}
