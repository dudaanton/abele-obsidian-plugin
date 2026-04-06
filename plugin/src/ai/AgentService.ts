import { ref, shallowRef } from 'vue'
import { TFile } from 'obsidian'
import dayjs from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentLoop } from './client/AgentLoop'
import { OpenAIClient } from './client/OpenAIClient'
import type {
  AgentEvent,
  AgentTool,
  AssistantMessage,
  Message,
  ModelConfig,
  TextContent,
  ThinkingContent,
} from './client'
import { ChatStorage } from './ChatStorage'
import { ChatMessage, ChatMetadata, ToolApprovalRequest, ToolApprovalResult } from './types'
import { createAgentTools } from './tools'

export class AgentService {
  private static instance: AgentService

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
  public readonly currentApproval = shallowRef<ToolApprovalRequest | null>(null)
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
      apiKey: provider.apiKeyId,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      supportsReasoning: model.supportsReasoning,
    }
  }

  private getSystemPrompt(): string {
    const config = AbeleConfig.getInstance().ai
    const base = `You are an AI assistant integrated into Obsidian note-taking app through the Abele plugin. You can read, create, edit, delete, and move files in the user's vault. You can also search the web.

When working with files, always explain what you're about to do before doing it. Be concise but thorough.`

    return config.systemPrompt ? `${base}\n\n${config.systemPrompt}` : base
  }

  private getTools(): AgentTool[] {
    return createAgentTools()
  }

  private requestApproval(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolApprovalResult> {
    return new Promise((resolve) => {
      this.currentApproval.value = {
        toolCallId,
        toolName,
        args,
        resolve: (result) => {
          this.currentApproval.value = null
          resolve(result)
        },
      }
    })
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

          // Only add message if there's content
          if (textParts.length > 0 || thinkingParts.length > 0) {
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
          }
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
          toolName: event.toolName,
          toolParams: event.args,
          toolStatus: 'pending',
          timestamp: Date.now(),
        }
        this.messages.value = [...this.messages.value, chatMsg]
        break
      }

      case 'tool_end': {
        // Update the tool-call message with result and diff
        const msgs = [...this.messages.value]
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (
            msgs[i].role === 'tool-call' &&
            msgs[i].toolName === event.toolName &&
            msgs[i].toolStatus === 'pending'
          ) {
            const resultText = event.result.content?.map((c) => c.text).join('') || ''
            const diff = (event.result.details as { diff?: { old: string; new: string } })?.diff
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

  async sendMessage(content: string): Promise<void> {
    this.error.value = null
    this.userMessageCount++

    const userMsg: ChatMessage = {
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    this.messages.value = [...this.messages.value, userMsg]

    // Add user message to internal messages
    this.internalMessages.push({
      role: 'user',
      content,
      timestamp: Date.now(),
    })

    this.isStreaming.value = true
    this.streamingContent.value = ''
    this.streamingThinking.value = ''

    try {
      const model = this.getActiveModelConfig()
      const tools = this.getTools()

      this.agentLoop = new AgentLoop()
      this.unsubscribe = this.agentLoop.subscribe((event) => this.handleAgentEvent(event))

      const resultMessages = await this.agentLoop.run({
        model,
        systemPrompt: this.getSystemPrompt(),
        tools,
        messages: this.internalMessages,
        beforeToolCall: async (toolName, toolCallId, args) => {
          const mode = AbeleConfig.getInstance().ai.permissionMode
          const readTools = ['read', 'ls', 'find', 'workspace']
          const editTools = ['edit']
          // web_search is always auto-approved (no file access)

          // Read-only tools: always auto-approved
          if (readTools.includes(toolName) || toolName === 'web_search') return

          // Edit tools: auto-approved in allow-edit and allow-all
          if (editTools.includes(toolName) && (mode === 'allow-edit' || mode === 'allow-all'))
            return

          // Write tools (create, rm, mv, cp): auto-approved only in allow-all
          if (mode === 'allow-all') return

          // Everything else: request user approval
          const result = await this.requestApproval(toolCallId, toolName, args)
          if (!result.approved) {
            return { block: true, reason: result.reason || 'User rejected this action' }
          }
          if (result.modifiedArgs) {
            return { block: false, modifiedArgs: result.modifiedArgs }
          }
        },
      })

      this.internalMessages = resultMessages

      // Generate title after 1st and 3rd user messages
      if (this.userMessageCount === 1 || this.userMessageCount === 3) {
        this.generateTitle().catch(() => {})
      }
    } catch (err: unknown) {
      // Abort is not an error
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

  abort(): void {
    this.agentLoop?.abort()
    this.isStreaming.value = false
    this.currentApproval.value = null
  }

  async newChat(): Promise<void> {
    await this.saveCurrentChat()
    this.abort()
    this.internalMessages = []
    this.messages.value = []
    this.streamingContent.value = ''
    this.streamingThinking.value = ''
    this.currentApproval.value = null
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
    }

    this.currentChatFile.value = await ChatStorage.getInstance().saveChat(
      this.messages.value,
      metadata,
      this.currentChatFile.value || undefined
    )
  }

  private fallbackTitle(): string {
    const firstUser = this.messages.value.find((m) => m.role === 'user')
    const snippet = firstUser ? firstUser.content.slice(0, 50).replace(/\n/g, ' ') : 'Chat'
    return `${dayjs().format('YYYY-MM-DD HH-mm')} ${snippet}`
  }

  private async generateTitle(): Promise<void> {
    try {
      const model = this.getActiveModelConfig()
      const client = new OpenAIClient()
      const msgs = this.messages.value
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(0, 6)
        .map((m) => `[${m.role}]: ${m.content.slice(0, 200)}`)
        .join('\n')

      const titleMessages: Message[] = [
        {
          role: 'user',
          content: `Generate a short title (3-6 words, no quotes) for this conversation:\n\n${msgs}`,
          timestamp: Date.now(),
        },
      ]

      let title = ''
      for await (const event of client.stream(
        { ...model, maxTokens: 30 },
        'You generate concise chat titles. Reply with ONLY the title, nothing else.',
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
        .slice(0, 60)

      if (!title || title === this.chatTitle) return

      this.chatTitle = title

      // Rename the file to match the new title
      if (this.currentChatFile.value) {
        const storage = ChatStorage.getInstance()
        const oldPath = this.currentChatFile.value.path
        const newFile = await storage.renameChat(this.currentChatFile.value, title)
        if (newFile) {
          this.currentChatFile.value = newFile
        }
      }
    } catch {
      // Silently fail — title generation is best-effort
    }
  }

  async loadChat(file: TFile): Promise<void> {
    await this.newChat()
    const { metadata, messages } = await ChatStorage.getInstance().loadChat(file)
    this.messages.value = messages
    this.currentChatFile.value = file

    // Rebuild internal messages from chat messages
    this.internalMessages = []
    for (const msg of messages) {
      if (msg.role === 'user') {
        this.internalMessages.push({ role: 'user', content: msg.content, timestamp: msg.timestamp })
      } else if (msg.role === 'assistant') {
        this.internalMessages.push({
          role: 'assistant',
          content: [{ type: 'text', text: msg.content }],
          model: metadata?.modelId || '',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: 'stop',
          timestamp: msg.timestamp,
        })
      }
    }
  }

  async compact(): Promise<void> {
    if (this.messages.value.length < 4) return

    const allContent = this.messages.value.map((m) => `[${m.role}]: ${m.content}`).join('\n\n')

    const systemMsg: ChatMessage = {
      role: 'system',
      content: `[Conversation compacted]\n\n${allContent}`,
      timestamp: Date.now(),
    }

    const lastMessages = this.messages.value.slice(-2)
    this.messages.value = [systemMsg, ...lastMessages]
    this.internalMessages = []
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
    this.currentApproval.value = null
    this.currentChatFile.value = null
  }
}
