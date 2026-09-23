import { TFile } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { OpenAIClient } from './client/OpenAIClient'
import type { ModelConfig, ToolDefinition } from './client'
import { parseChat, serializeMetadata } from './ChatLog'
import { ChatService } from './ChatService'
import { activeBranch, conversationLines, renderLines, type ChatLine } from './chatText'
import { DEFAULT_AI_SETTINGS } from './types'

const SYSTEM_PROMPT =
  'You summarize conversations for a list of chats. Reply with ONLY the summary, nothing else.'
const MAX_LENGTH = 300
/** The opening says what the chat was for; the end says where it got to. The middle is cut. */
const HEAD = 4
const TAIL = 6
const PER_LINE = 400

/**
 * The short summary shown under a chat's title in the history.
 *
 * Built from what the person and the agent said and nothing else — see `conversationLines` —
 * so a chat that read a private note does not carry that note into a list anybody can scroll.
 * Answers an empty string when there is nothing to summarise yet, which is a chat the agent
 * has not answered.
 */
export async function requestSummary(
  lines: ChatLine[],
  model: ModelConfig,
  signal: AbortSignal,
  toolDefs: ToolDefinition[] = []
): Promise<string> {
  if (!lines.some((line) => line.role === 'assistant')) return ''

  const picked =
    lines.length > HEAD + TAIL ? [...lines.slice(0, HEAD), ...lines.slice(-TAIL)] : lines
  const prompts = AbeleConfig.getInstance().ai.prompts
  const prompt = (prompts?.summaryPrompt || DEFAULT_AI_SETTINGS.prompts.summaryPrompt).replace(
    '{{messages}}',
    renderLines(picked, PER_LINE)
  )

  let summary = ''
  for await (const event of new OpenAIClient().stream(
    model,
    SYSTEM_PROMPT,
    [{ role: 'user', content: prompt, timestamp: Date.now() }],
    toolDefs,
    { signal }
  )) {
    if (event.type === 'text_delta') summary += event.delta
  }

  return summary
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
    .slice(0, MAX_LENGTH)
}

/**
 * Writes the summary a chat never got — one made before summaries existed, or one whose
 * background request failed.
 *
 * An open chat is summarised through its session, so the session's own record of its file stays
 * true and its next save does not write the metadata back without it. Any other chat gets one
 * metadata record appended, which is how a chat log changes its metadata: the last one wins.
 * Answers the summary written, or null when there was none to write.
 */
export async function backfillSummary(path: string, signal: AbortSignal): Promise<string | null> {
  const service = ChatService.getInstance()
  const session = service.getSessionByFile(path)
  if (session) {
    await session.generateSummary()
    return session.summary.value || null
  }

  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return null

  const parsed = parseChat(await app.vault.read(file))
  if (parsed.metadata?.type !== 'abele-chat' || parsed.metadata.summary) {
    return parsed.metadata?.summary ?? null
  }

  const lines = conversationLines(activeBranch(parsed.messages, parsed.metadata.activeLeafId))
  const summary = await requestSummary(lines, service.getAuxiliaryModelConfig(), signal)
  if (!summary || signal.aborted) return null

  // Read again right before writing: the request took seconds, and a chat that moved on in the
  // meantime has a newer metadata record that this one must not be appended behind.
  const latest = parseChat(await app.vault.read(file)).metadata
  if (!latest || latest.summary) return latest?.summary ?? null
  await app.vault.append(file, serializeMetadata({ ...latest, summary }))
  return summary
}

/**
 * Summaries for the chats somebody is looking at, one request at a time.
 *
 * The history is every chat ever had, so nothing here walks it: a chat is asked for only when
 * its card comes on screen, only once per list, and only while the list is open. Closing the
 * list abandons whatever is still waiting.
 */
export class SummaryBackfill {
  private readonly queue: string[] = []
  private readonly asked = new Set<string>()
  private readonly abort = new AbortController()
  private running = false

  constructor(private readonly onSummary: (path: string, summary: string) => void) {}

  request(path: string): void {
    if (this.asked.has(path) || this.abort.signal.aborted) return
    this.asked.add(path)
    this.queue.push(path)
    void this.drain()
  }

  dispose(): void {
    this.abort.abort()
    this.queue.length = 0
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length && !this.abort.signal.aborted) {
        const path = this.queue.shift()!
        try {
          const summary = await backfillSummary(path, this.abort.signal)
          if (summary && !this.abort.signal.aborted) this.onSummary(path, summary)
        } catch {
          // Best-effort, like every background request: a card without a summary still works.
        }
      }
    } finally {
      this.running = false
    }
  }
}
