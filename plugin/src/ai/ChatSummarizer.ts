import type { Ref, ShallowRef } from 'vue'
import type { TFile } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { OpenAIClient } from './client/OpenAIClient'
import type { Message, ModelConfig, TextContent, ToolCallContent, ToolDefinition } from './client'
import { ChatStorage } from './ChatStorage'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from './types'

/**
 * The slice of a chat the summarizer touches.
 *
 * Declared as an interface rather than taking `ChatSession` directly for two reasons: it says
 * exactly how much of a chat these background tasks may reach into, and it lets the tests drive
 * them from a small fake instead of standing up a whole session and its agent loop.
 */
export interface SummarizerHost {
  messages: Ref<ChatMessage[]>
  chatTitle: Ref<string>
  currentChatFile: ShallowRef<TFile | null>
  isGeneratingTitle: Ref<boolean>
  isCompacting: Ref<boolean>
  isStreaming: Ref<boolean>
  error: Ref<string | null>
  pendingToolCalls: Ref<ToolCallContent[]>
  /** Messages as the model sees them on the active branch. */
  messagesForModel(): Message[]
  /** Tool definitions sent alongside a background request. */
  toolDefs(): ToolDefinition[]
  /** Whether there is any conversation to compact. */
  hasInternalMessages(): boolean
  /** Records the summary as a visible divider and as an internal marker in one step. */
  applyCompactSummary(summary: string): void
  backgroundSignal(): AbortSignal
  save(): Promise<void>
  /** The model used for background work — cheap, no tools of its own. */
  auxiliaryModel(): ModelConfig
  /** The chat's own model, consulted only for its context window. */
  activeModel(): ModelConfig | null
}

/**
 * Title generation and context compaction: the two things a chat does with the auxiliary
 * model, on its own initiative, while the user is doing something else.
 *
 * They live outside `ChatSession` because a delegated run has no use for either — it is never
 * titled and never shown in a history list — so phase 5 builds a headless session simply by
 * not constructing one of these.
 */
export class ChatSummarizer {
  private static readonly AUTO_COMPACT_THRESHOLD = 0.9
  private static readonly TITLE_MAX_LENGTH = 60
  private static readonly TITLE_MSG_PREVIEW_LENGTH = 200
  private static readonly COMPACT_SYSTEM_PROMPT =
    'You summarize conversations. Reply with ONLY the summary, nothing else.'
  static readonly COMPACT_MARKER = '[Conversation compacted]'

  constructor(private readonly host: SummarizerHost) {}

  /**
   * Names the chat from its opening exchange.
   *
   * Best-effort throughout: a title is a convenience, and a failed background request must
   * never surface as a chat error or interrupt what the user is doing.
   */
  async generateTitle(): Promise<void> {
    this.host.isGeneratingTitle.value = true
    try {
      const config = AbeleConfig.getInstance().ai
      const model = this.host.auxiliaryModel()
      const client = new OpenAIClient()

      const msgs = this.host.messages.value
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(0, 6)
        .map((m) => `[${m.role}]: ${m.content.slice(0, ChatSummarizer.TITLE_MSG_PREVIEW_LENGTH)}`)
        .join('\n')

      const titlePrompt = (
        config.prompts?.titleGeneration || DEFAULT_AI_SETTINGS.prompts.titleGeneration
      ).replace('{{messages}}', msgs)
      const titleSystem = config.prompts?.titleSystem || DEFAULT_AI_SETTINGS.prompts.titleSystem

      const titleMessages: Message[] = [
        { role: 'user', content: titlePrompt, timestamp: Date.now() },
      ]

      let title = ''
      const signal = this.host.backgroundSignal()
      for await (const event of client.stream(
        model,
        titleSystem,
        titleMessages,
        this.host.toolDefs(),
        { signal }
      )) {
        if (event.type === 'text_delta') title += event.delta
      }

      title = title
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/[\\/:*?"<>|]/g, '-')
        .slice(0, ChatSummarizer.TITLE_MAX_LENGTH)

      if (!title || title === this.host.chatTitle.value) return

      this.host.chatTitle.value = title

      if (this.host.currentChatFile.value) {
        const newFile = await ChatStorage.getInstance().renameChat(
          this.host.currentChatFile.value,
          title
        )
        if (newFile) this.host.currentChatFile.value = newFile
      }
    } catch {
      // Silently fail — title generation is best-effort
    } finally {
      this.host.isGeneratingTitle.value = false
    }
  }

  /** Replaces the conversation history with a summary of it. */
  async compact(): Promise<void> {
    if (!this.host.hasInternalMessages()) return
    if (
      this.host.isStreaming.value ||
      this.host.isCompacting.value ||
      this.host.isGeneratingTitle.value
    ) {
      return
    }

    this.host.isCompacting.value = true
    this.host.error.value = null

    try {
      const config = AbeleConfig.getInstance().ai
      const model = this.host.auxiliaryModel()
      const client = new OpenAIClient()

      const msgsText = this.renderForSummary(this.host.messagesForModel())
      if (!msgsText) return

      const compactPrompt = (
        config.prompts?.compactPrompt || DEFAULT_AI_SETTINGS.prompts.compactPrompt
      ).replace('{{messages}}', msgsText)

      const compactMessages: Message[] = [
        { role: 'user', content: compactPrompt, timestamp: Date.now() },
      ]

      let summary = ''
      const signal = this.host.backgroundSignal()
      for await (const event of client.stream(
        model,
        ChatSummarizer.COMPACT_SYSTEM_PROMPT,
        compactMessages,
        this.host.toolDefs(),
        { signal }
      )) {
        if (event.type === 'text_delta') summary += event.delta
      }

      summary = summary.trim()
      if (!summary) return

      this.host.applyCompactSummary(summary)
      await this.host.save()
    } catch (err: unknown) {
      console.error('[Abele] compact error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      this.host.error.value = `Compact failed: ${msg}`
    } finally {
      this.host.isCompacting.value = false
    }
  }

  /**
   * Compacts once the last reported usage crosses 90% of the model's context window.
   *
   * Reads usage rather than estimating it: the number the provider returned is the only one
   * that matches what the next request will actually cost.
   */
  async autoCompactIfNeeded(): Promise<void> {
    try {
      if (this.host.pendingToolCalls.value.length > 0) return

      const model = this.host.activeModel()
      if (!model?.contextWindow) return

      const lastAssistant = [...this.host.messages.value]
        .reverse()
        .find((m) => m.role === 'assistant' && m.usage)
      if (!lastAssistant?.usage) return

      const threshold = model.contextWindow * ChatSummarizer.AUTO_COMPACT_THRESHOLD
      if (lastAssistant.usage.total >= threshold && this.host.messagesForModel().length > 2) {
        await this.compact()
      }
    } catch {
      // Auto-compact is best-effort
    }
  }

  private renderForSummary(messages: Message[]): string {
    return messages
      .map((m) => {
        if (m.role === 'user') {
          // A turn with attachments carries its content as parts rather than a string, so the
          // text has to be read out of them — interpolating the array would hand the model
          // `[object Object]` in place of everything the user wrote.
          const text =
            typeof m.content === 'string'
              ? m.content
              : m.content
                  .filter((part): part is TextContent => part.type === 'text')
                  .map((part) => part.text)
                  .join('')
          return text ? `[user]: ${text}` : null
        }
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
  }
}
