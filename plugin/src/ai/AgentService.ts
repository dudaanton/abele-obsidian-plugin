import { ref, shallowRef } from 'vue'
import { TFile } from 'obsidian'
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
  AssistantContentBlock,
  Message,
  ModelConfig,
  TextContent,
  ThinkingContent,
  ToolCallContent,
} from './client'
import { EMPTY_USAGE } from './client'
import { ChatStorage } from './ChatStorage'
import { ChatMessage, ChatMetadata, DEFAULT_AI_SETTINGS } from './types'
import { createAgentTools } from './tools'

/** Shape returned by tools that provide diff details */
interface ToolDiffDetails {
  diff?: { old: string; new: string }
}

export class AgentService {
  private static instance: AgentService

  private static readonly AUTO_COMPACT_THRESHOLD = 0.9
  private static readonly TITLE_MAX_TOKENS = 30
  private static readonly TITLE_MAX_LENGTH = 60
  private static readonly TITLE_MSG_PREVIEW_LENGTH = 200
  private static readonly TITLE_GENERATION_TRIGGERS = [1, 3]
  private static readonly FALLBACK_TITLE_LENGTH = 50
  private static readonly COMPACT_SYSTEM_PROMPT =
    'You summarize conversations. Reply with ONLY the summary, nothing else.'

  private agentLoop: AgentLoop | null = null
  private unsubscribe: (() => void) | null = null
  private internalMessages: Message[] = []
  private userMessageCount = 0
  private chatTitle = ''

  // Reactive state for Vue components
  public readonly messages = ref<ChatMessage[]>([])
  public readonly isStreaming = ref(false)
  public readonly streamingContent = ref('')
  public readonly streamingThinking = ref('')
  public readonly pendingToolCalls = ref<ToolCallContent[]>([])
  public readonly isCompacting = ref(false)
  public readonly currentChatFile = shallowRef<TFile | null>(null)
  public readonly error = ref<string | null>(null)

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

  private getSystemPrompt(): string {
    const config = AbeleConfig.getInstance().ai
    const base = config.prompts?.system || DEFAULT_AI_SETTINGS.prompts.system
    return config.systemPrompt ? `${base}\n\n${config.systemPrompt}` : base
  }

  private getTools(): AgentTool[] {
    return createAgentTools()
  }

  private static readonly READ_TOOLS = ['read', 'ls', 'find', 'workspace', 'web_search']
  private static readonly EDIT_TOOLS = ['edit']

  private needsApproval(toolName: string): boolean {
    const mode = AbeleConfig.getInstance().ai.permissionMode
    if (AgentService.READ_TOOLS.includes(toolName)) return false
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
            role: 'assistant',
            content: textParts.map((t) => t.text).join(''),
            thinking: thinkingParts.length
              ? thinkingParts.map((t) => t.thinking).join('')
              : undefined,
            usage: am.usage
              ? { input: am.usage.input, output: am.usage.output, total: am.usage.totalTokens }
              : undefined,
            timestamp: Date.now(),
          }
          this.messages.value = [...this.messages.value, chatMsg]
          this.streamingContent.value = ''
          this.streamingThinking.value = ''
        } else if (msg.role === 'toolResult') {
          // Only add visible entry for errors (tool_end already updated the tool-call message)
          if (msg.isError) {
            const resultContent = msg.content.map((c) => c.text).join('')
            this.messages.value = [
              ...this.messages.value,
              {
                role: 'tool-result',
                content: resultContent,
                toolName: msg.toolName,
                toolStatus: 'rejected',
                timestamp: Date.now(),
              },
            ]
          }
        }
        break
      }

      case 'tool_start': {
        const chatMsg: ChatMessage = {
          role: 'tool-call',
          content: `Calling ${event.toolName}`,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          toolParams: event.args,
          toolStatus: 'pending',
          timestamp: Date.now(),
        }
        this.messages.value = [...this.messages.value, chatMsg]
        break
      }

      case 'tool_end': {
        // Update the tool-call message with result and diff (match by toolCallId)
        const msgs = [...this.messages.value]
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (
            msgs[i].role === 'tool-call' &&
            msgs[i].toolCallId === event.toolCallId &&
            msgs[i].toolStatus === 'pending'
          ) {
            const resultText = event.result.content?.map((c) => c.text).join('') || ''
            const diff = (event.result.details as ToolDiffDetails)?.diff
            msgs[i] = {
              ...msgs[i],
              toolResult: resultText,
              toolDiff: diff ? { old: diff.old, new: diff.new } : undefined,
              toolStatus: event.isError ? 'rejected' : 'approved',
            }
            break
          }
        }
        this.messages.value = msgs
        break
      }
    }
  }

  // ── Agent loop execution ──────────────────────────────────────

  private static COMPACT_MARKER = '[Conversation compacted]'

  /** Get messages to send to the model — from the last compact marker onwards */
  private getMessagesForModel(): Message[] {
    for (let i = this.internalMessages.length - 1; i >= 0; i--) {
      const m = this.internalMessages[i]
      if (m.role === 'system' && m.content.startsWith(AgentService.COMPACT_MARKER)) {
        return this.internalMessages.slice(i)
      }
    }
    return [...this.internalMessages]
  }

  private async runAgentLoop(): Promise<void> {
    this.isStreaming.value = true
    this.streamingContent.value = ''
    this.streamingThinking.value = ''
    this.error.value = null

    try {
      const model = this.getActiveModelConfig()
      const tools = this.getTools()

      this.agentLoop = new AgentLoop()
      this.unsubscribe = this.agentLoop.subscribe((event) => this.handleAgentEvent(event))

      const toSend = this.getMessagesForModel()
      const result = await this.agentLoop.run({
        model,
        systemPrompt: this.getSystemPrompt(),
        tools,
        messages: toSend,
        beforeToolCall: async (toolName) => {
          if (this.needsApproval(toolName)) {
            return { pause: true }
          }
        },
      })

      // Append only new messages to the full history (append-only)
      const newMsgs = result.messages.slice(toSend.length)
      this.internalMessages.push(...newMsgs)

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

      if (this.needsApproval(tc.name)) {
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
    const exists = this.messages.value.some((m) => m.toolCallId === tc.id)
    if (exists) return

    this.messages.value = [
      ...this.messages.value,
      {
        role: 'tool-call',
        content: `Calling ${tc.name}`,
        toolCallId: tc.id,
        toolName: tc.name,
        toolParams: tc.arguments,
        toolStatus: 'pending',
        timestamp: Date.now(),
      },
    ]
  }

  /**
   * Execute the first pending tool call and update messages.
   */
  private async executeCurrentPendingTool(modifiedArgs?: Record<string, unknown>): Promise<void> {
    const tc = this.pendingToolCalls.value[0]
    if (!tc) return

    const tools = this.getTools()
    const tool = tools.find((t) => t.name === tc.name)
    const args = modifiedArgs || tc.arguments

    // Execute
    let toolResult: AgentToolResult
    let isError = false
    try {
      toolResult = await tool!.execute(tc.id, args)
    } catch (err: unknown) {
      toolResult = {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
      }
      isError = true
    }

    // Update the pending ChatMessage
    const msgs = [...this.messages.value]
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].toolCallId === tc.id && msgs[i].toolStatus === 'pending') {
        const resultText = toolResult.content.map((c) => c.text).join('')
        const diff = (toolResult.details as ToolDiffDetails)?.diff
        msgs[i] = {
          ...msgs[i],
          toolResult: resultText,
          toolDiff: diff ? { old: diff.old, new: diff.new } : undefined,
          toolStatus: isError ? 'rejected' : 'approved',
        }
        break
      }
    }
    this.messages.value = msgs

    // Add to internal messages
    this.internalMessages.push({
      role: 'toolResult',
      toolCallId: tc.id,
      toolName: tc.name,
      content: toolResult.content,
      isError,
      timestamp: Date.now(),
    })

    // Remove from pending
    this.pendingToolCalls.value = this.pendingToolCalls.value.slice(1)
  }

  // ── Public API ──────────────────────────────────────────────────

  async sendMessage(content: string): Promise<void> {
    if (this.isStreaming.value || this.isCompacting.value) return

    this.error.value = null
    this.userMessageCount++

    const userMsg: ChatMessage = {
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    this.messages.value = [...this.messages.value, userMsg]

    this.internalMessages.push({
      role: 'user',
      content,
      timestamp: Date.now(),
    })

    await this.runAgentLoop()
    await this.saveCurrentChat()

    if (AgentService.TITLE_GENERATION_TRIGGERS.includes(this.userMessageCount)) {
      this.generateTitle().catch(() => {})
    }

    // Auto-compact if near context limit
    this.autoCompactIfNeeded().catch(() => {})
  }

  async approveToolCall(modifiedArgs?: Record<string, unknown>): Promise<void> {
    if (this.isStreaming.value) return
    await this.executeCurrentPendingTool(modifiedArgs)
    await this.processAllPendingToolCalls()
    await this.saveCurrentChat()
  }

  async rejectToolCall(reason?: string): Promise<void> {
    if (this.isStreaming.value) return
    const tc = this.pendingToolCalls.value[0]
    if (!tc) return

    const reasonText = reason || 'User rejected this action'

    // Update ChatMessage
    const msgs = [...this.messages.value]
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].toolCallId === tc.id && msgs[i].toolStatus === 'pending') {
        msgs[i] = {
          ...msgs[i],
          toolResult: reasonText,
          toolStatus: 'rejected',
        }
        break
      }
    }
    this.messages.value = msgs

    // Add error result to internal messages
    this.internalMessages.push({
      role: 'toolResult',
      toolCallId: tc.id,
      toolName: tc.name,
      content: [{ type: 'text', text: reasonText }],
      isError: true,
      timestamp: Date.now(),
    })

    // Remove from pending
    this.pendingToolCalls.value = this.pendingToolCalls.value.slice(1)

    await this.processAllPendingToolCalls()
    await this.saveCurrentChat()
  }

  abort(): void {
    this.agentLoop?.abort()
    this.isStreaming.value = false
  }

  async newChat(): Promise<void> {
    await this.saveCurrentChat()
    this.abort()
    this.internalMessages = []
    this.messages.value = []
    this.streamingContent.value = ''
    this.streamingThinking.value = ''
    this.pendingToolCalls.value = []
    this.currentChatFile.value = null
    this.error.value = null
    this.userMessageCount = 0
    this.chatTitle = ''
  }

  async saveCurrentChat(): Promise<void> {
    if (this.messages.value.length === 0) return

    const config = AbeleConfig.getInstance().ai
    const title = this.chatTitle || this.fallbackTitle()

    const metadata: ChatMetadata = {
      type: 'abele-chat',
      providerId: config.activeProviderId,
      modelId: config.activeModelId,
      created: this.currentChatFile.value ? '' : dayjs().format('YYYY-MM-DD'),
      title,
      pendingToolCalls:
        this.pendingToolCalls.value.length > 0
          ? this.pendingToolCalls.value.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            }))
          : undefined,
    }

    this.currentChatFile.value = await ChatStorage.getInstance().saveChat(
      this.messages.value,
      metadata,
      this.currentChatFile.value || undefined,
      this.internalMessages,
      this.getSystemPrompt()
    )
  }

  async loadChat(file: TFile): Promise<void> {
    await this.newChat()
    const result = await ChatStorage.getInstance().loadChat(file)
    this.messages.value = result.messages
    this.currentChatFile.value = file
    this.chatTitle = result.metadata?.title || ''

    // Count existing user messages for title generation logic
    this.userMessageCount = result.messages.filter((m) => m.role === 'user').length

    // Restore internal messages — prefer stored, fallback to rebuild
    if (result.internalMessages?.length) {
      this.internalMessages = result.internalMessages
    } else {
      this.rebuildInternalMessages(result.messages, result.metadata)
    }

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

  /**
   * Rebuild OpenAI-format internalMessages from stored ChatMessages.
   * Groups assistant messages with following tool-call messages.
   */
  private rebuildInternalMessages(messages: ChatMessage[], metadata: ChatMetadata | null): void {
    this.internalMessages = []
    const modelId = metadata?.modelId || ''
    let i = 0

    while (i < messages.length) {
      const msg = messages[i]

      if (msg.role === 'user' || msg.role === 'system') {
        this.internalMessages.push({
          role: 'user',
          content: msg.content,
          timestamp: msg.timestamp,
        })
        i++
        continue
      }

      if (msg.role === 'assistant') {
        const contentBlocks: AssistantContentBlock[] = []
        if (msg.thinking) contentBlocks.push({ type: 'thinking', thinking: msg.thinking })
        if (msg.content) contentBlocks.push({ type: 'text', text: msg.content })

        // Look ahead: collect tool-call messages that follow this assistant message
        let j = i + 1
        while (j < messages.length && messages[j].role === 'tool-call') {
          const tc = messages[j]
          if (tc.toolCallId && tc.toolName) {
            contentBlocks.push({
              type: 'toolCall',
              id: tc.toolCallId,
              name: tc.toolName,
              arguments: tc.toolParams || {},
            })
          }
          j++
        }

        const hasToolCalls = contentBlocks.some((b) => b.type === 'toolCall')
        this.internalMessages.push({
          role: 'assistant',
          content: contentBlocks,
          model: modelId,
          usage: msg.usage
            ? {
                input: msg.usage.input,
                output: msg.usage.output,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: msg.usage.total,
              }
            : EMPTY_USAGE,
          stopReason: hasToolCalls ? 'toolUse' : 'stop',
          timestamp: msg.timestamp,
        })

        // Add tool results for resolved tool calls
        for (let k = i + 1; k < j; k++) {
          const tc = messages[k]
          if (
            tc.toolCallId &&
            tc.toolName &&
            (tc.toolStatus === 'approved' || tc.toolStatus === 'rejected')
          ) {
            this.internalMessages.push({
              role: 'toolResult',
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              content: [{ type: 'text', text: tc.toolResult || '' }],
              isError: tc.toolStatus === 'rejected',
              timestamp: tc.timestamp,
            })
          }
        }

        i = j
        continue
      }

      if (msg.role === 'tool-call') {
        // Orphaned tool-call (no preceding assistant message)
        // Collect consecutive tool-calls into a synthetic assistant message
        const contentBlocks: AssistantContentBlock[] = []
        let j = i
        while (j < messages.length && messages[j].role === 'tool-call') {
          const tc = messages[j]
          if (tc.toolCallId && tc.toolName) {
            contentBlocks.push({
              type: 'toolCall',
              id: tc.toolCallId,
              name: tc.toolName,
              arguments: tc.toolParams || {},
            })
          }
          j++
        }

        if (contentBlocks.length > 0) {
          this.internalMessages.push({
            role: 'assistant',
            content: contentBlocks,
            model: modelId,
            usage: EMPTY_USAGE,
            stopReason: 'toolUse',
            timestamp: messages[i].timestamp,
          })

          for (let k = i; k < j; k++) {
            const tc = messages[k]
            if (
              tc.toolCallId &&
              tc.toolName &&
              (tc.toolStatus === 'approved' || tc.toolStatus === 'rejected')
            ) {
              this.internalMessages.push({
                role: 'toolResult',
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                content: [{ type: 'text', text: tc.toolResult || '' }],
                isError: tc.toolStatus === 'rejected',
                timestamp: tc.timestamp,
              })
            }
          }
        }

        i = j
        continue
      }

      // Skip tool-result messages (handled via tool-call processing)
      i++
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
    try {
      const config = AbeleConfig.getInstance().ai
      const model = this.getActiveModelConfig()
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

      let title = ''
      for await (const event of client.stream(
        { ...model, maxTokens: AgentService.TITLE_MAX_TOKENS },
        titleSystem,
        titleMessages,
        [],
        {}
      )) {
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
    }
  }

  async compact(): Promise<void> {
    if (this.internalMessages.length === 0) return
    if (this.isStreaming.value || this.isCompacting.value) return

    this.isCompacting.value = true
    this.error.value = null

    try {
      const config = AbeleConfig.getInstance().ai
      const model = this.getActiveModelConfig()
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

      let summary = ''
      for await (const event of client.stream(
        model,
        AgentService.COMPACT_SYSTEM_PROMPT,
        compactMessages,
        [],
        {}
      )) {
        if (event.type === 'text_delta') summary += event.delta
      }

      summary = summary.trim()
      if (!summary) return

      // Append compact marker at the end of current history
      const insertAt = this.internalMessages.length
      const compactMarker: Message = {
        role: 'system',
        content: `${AgentService.COMPACT_MARKER}\n\n${summary}`,
        timestamp: Date.now(),
      }
      this.internalMessages.splice(insertAt, 0, compactMarker)

      // Insert a visual divider in UI messages
      const divider: ChatMessage = {
        role: 'system',
        content: summary,
        timestamp: Date.now(),
      }
      this.messages.value = [...this.messages.value, divider]

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
      internalMessages: this.internalMessages,
      pendingToolCalls: this.pendingToolCalls.value.length
        ? this.pendingToolCalls.value
        : undefined,
    }
  }

  switchModel(providerId: string, modelId: string): void {
    const config = AbeleConfig.getInstance()
    config.ai.activeProviderId = providerId
    config.ai.activeModelId = modelId
    config.saveSettings()
  }

  destroy(): void {
    this.abort()
    this.internalMessages = []
    this.messages.value = []
    this.pendingToolCalls.value = []
    this.currentChatFile.value = null
  }
}
