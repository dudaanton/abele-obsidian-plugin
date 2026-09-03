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
  /** One sentence on what the chat did, shown on the card under a note it changed. */
  recap: Ref<string>
  /** The notes the chat has written to, so the recap can name them. */
  touchedNotes(): string[]
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
  private static readonly RECAP_SYSTEM_PROMPT =
    'You summarize what was done in a conversation. Reply with ONLY the sentence, nothing else.'
  private static readonly RECAP_MAX_LENGTH = 200
  /**
   * How much of the conversation a recap sees.
   *
   * A recap runs after every turn that wrote, unlike a title, which runs once — so the whole
   * transcript per turn would make the background cost of a long working session grow with the
   * square of its length. The end of the conversation is what the work was.
   */
  private static readonly RECAP_WINDOW = 8
  private static readonly RECAP_MSG_PREVIEW_LENGTH = 500
  static readonly COMPACT_MARKER = '[Conversation compacted]'

  /** The notes named in the last recap this asked for, so the same work is not resummarised. */
  private lastRecapNotes = ''

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

  /**
   * One sentence on what the chat did to the notes it changed.
   *
   * Unlike a title, which names a conversation once, this describes work — so it is
   * regenerated after every turn that wrote something. Best-effort throughout, exactly like
   * `generateTitle`: a failed background request never surfaces as a chat error, and never
   * replaces a sentence that was already there.
   */
  async generateRecap(): Promise<void> {
    try {
      const config = AbeleConfig.getInstance().ai
      const model = this.host.auxiliaryModel()
      const client = new OpenAIClient()

      const notes = this.host.touchedNotes()
      // Nothing was written, so there is no card for a sentence to appear on.
      if (!notes.length) return
      // A turn that rewrote a note this chat had already written says nothing new about which
      // notes it worked on, and the sentence it would produce is the sentence already there.
      const key = notes.join('\n')
      if (key === this.lastRecapNotes) return

      const conversation = this.renderForSummary(
        this.host.messagesForModel().slice(-ChatSummarizer.RECAP_WINDOW),
        ChatSummarizer.RECAP_MSG_PREVIEW_LENGTH
      )
      const body = `Notes written: ${notes.join(', ')}\n\n${conversation}`

      const prompt = (
        config.prompts?.recapPrompt || DEFAULT_AI_SETTINGS.prompts.recapPrompt
      ).replace('{{messages}}', body)

      let recap = ''
      const signal = this.host.backgroundSignal()
      for await (const event of client.stream(
        model,
        ChatSummarizer.RECAP_SYSTEM_PROMPT,
        [{ role: 'user', content: prompt, timestamp: Date.now() }],
        this.host.toolDefs(),
        { signal }
      )) {
        if (event.type === 'text_delta') recap += event.delta
      }

      recap = recap
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim()
        .slice(0, ChatSummarizer.RECAP_MAX_LENGTH)

      // Recorded whatever the model came back with, an empty or unchanged sentence included:
      // asking again for the same notes would only produce the same answer.
      this.lastRecapNotes = key
      if (!recap || recap === this.host.recap.value) return

      this.host.recap.value = recap
      await this.host.save()
    } catch {
      // Silently fail — a recap is best-effort, and never the chat's problem to report.
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

  /**
   * The conversation as a block of text.
   *
   * `previewLength` bounds each message, for a caller that runs often enough to care what one
   * costs. Compaction passes nothing: it is replacing the history, so it may not lose any of it.
   */
  private renderForSummary(messages: Message[], previewLength?: number): string {
    const cut = (text: string): string =>
      previewLength && text.length > previewLength ? `${text.slice(0, previewLength)}…` : text

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
          return text ? `[user]: ${cut(text)}` : null
        }
        if (m.role === 'assistant') {
          const text = m.content
            .filter((b): b is TextContent => b.type === 'text')
            .map((b) => b.text)
            .join('')
          return text ? `[assistant]: ${cut(text)}` : null
        }
        if (m.role === 'toolResult') {
          return `[tool ${m.toolName}]: ${cut(m.content.map((c) => c.text).join(''))}`
        }
        return null
      })
      .filter(Boolean)
      .join('\n\n')
  }
}
