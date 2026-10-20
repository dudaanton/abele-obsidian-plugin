import type { JournalEvent } from '@abele/channel-protocol'
import {
  providerSessionUpdates,
  sessionUpdatesOf,
  type SessionCommand,
  type SessionUpdate,
  type SessionUpdateOf,
  type PlanEntry,
  type ToolContent,
} from '@abele/node-protocol'
import type { ChatMessage } from '@/ai/types'
import { readAgentReplyText } from '@/ai/replyLinks'

type ProtocolEvent = Parameters<typeof sessionUpdatesOf>[0]
type Message = (id: string, role: ChatMessage['role']) => ChatMessage
type Diff = Extract<ToolContent, { type: 'diff' }>
const PROVIDERS = ['claude', 'pi', 'acp', 'codex']

/** The agent that wrote a record: its author, or the prefix of its type for older journals. */
export function eventProvider(event: Pick<JournalEvent, 'type' | 'actor'>): string {
  const actor = event.actor as { kind: string; provider?: string }
  if (actor.kind === 'provider' && actor.provider) return actor.provider
  const prefix = event.type.split('.', 1)[0]
  return PROVIDERS.includes(prefix) ? prefix : ''
}

/**
 * The session updates one journal event stands for, the way node-protocol reads them, and also
 * for a provider record whose author is not named (journals and fixtures that do not say who
 * wrote a record still say it in its type). A record the node mapped is read through the
 * `session.update` beside it, never twice.
 */
export function updatesOf(event: JournalEvent): SessionUpdate[] {
  if (event.type === 'session.update' || event.type === 'input.accepted')
    return sessionUpdatesOf(event as ProtocolEvent)
  const data = event.data as Record<string, unknown> | null
  if (!data || typeof data !== 'object' || data.mapped === true) return []
  const actor = event.actor as { kind: string }
  if (actor.kind === 'provider') return sessionUpdatesOf(event as ProtocolEvent)
  const provider = eventProvider(event)
  return provider ? providerSessionUpdates(provider, event.type, data) : []
}

/** What a session's updates say beside its messages. */
export interface UpdateProjection {
  /** The latest «/» list the agent reported, with where it stands in the journal. */
  commands: { list: SessionCommand[]; seq: number } | null
  /** The permission or agent mode now in force, in the agent's own words. */
  mode: string | null
  /** The model and other options the agent reports, by category. */
  options: SessionUpdateOf<'config_option_update'>['options']
  /** The plan as it stands now. */
  plan: PlanEntry[]
}

const KIND_NAME: Record<string, string> = {
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  move: 'Move',
  search: 'Search',
  execute: 'Run',
  think: 'Think',
  fetch: 'Fetch',
  switch_mode: 'Mode',
  other: 'Tool',
}

interface Block {
  text: string
  thinking: string
  final: boolean
}
interface Tool {
  title: string
  status?: string
  content: ToolContent[]
  /** The change the call makes, kept when its result replaces what it showed. */
  diffs: Diff[]
  locations: { path: string; line?: number | null }[]
}

const scoped = (provider: string, run: string, id: string): string =>
  JSON.stringify([provider || 'agent', run, id])

/**
 * Every agent's transcript, read from the one vocabulary the node writes (`session.update`,
 * modelled on ACP): messages and their reasoning, tool calls with their diffs and state, the
 * plan, mode, options and commands. Fed the journal in order, like `LiveTranscript`; it never
 * runs anything.
 */
export class UpdateTranscript {
  private readonly blocks = new Map<string, Map<number, Block>>()
  private readonly tools = new Map<string, Tool>()
  private commands: UpdateProjection['commands'] = null
  private mode: string | null = null
  private options: UpdateProjection['options'] = []
  private plan: PlanEntry[] = []
  private notices = 0
  /** Session state, deliberately independent of turns and process/run ids. */
  private rateLimit = ''

  constructor(
    private readonly message: Message,
    private readonly live: {
      context(used: number | null, limit: number | null): void
      compactionUpdate(update: SessionUpdateOf<'compaction_update'>): void
      summary(text: string): void
    }
  ) {}

  /** The id a message of this agent has in the chat; Claude's keep the ids they always had. */
  messageId(provider: string, run: string, id: string, parent?: string | null): string {
    return provider === 'claude'
      ? JSON.stringify(['claude', run, parent ?? '', id])
      : scoped(provider, run, id)
  }
  toolId(provider: string, run: string, id: string): string {
    return provider === 'claude'
      ? JSON.stringify(['claude-tool', run, id])
      : JSON.stringify([`${provider || 'agent'}-tool`, run, id])
  }

  /** Applies one update; `seq` places what the list and plan say in the journal. */
  apply(update: SessionUpdate, provider: string, run: string, seq: number, turn = ''): void {
    switch (update.kind) {
      case 'agent_message_chunk':
      case 'agent_message':
      case 'agent_thought_chunk':
      case 'agent_thought':
        return this.text(update, provider, run)
      case 'tool_call':
      case 'tool_call_update':
        return this.tool(update, provider, run)
      case 'plan':
        this.plan = update.entries
        this.message(
          JSON.stringify(turn ? ['plan', run, turn] : ['plan', run]),
          'system'
        ).sessionPlan = update.entries
        return
      case 'current_mode_update':
        this.mode = update.mode_id
        return
      case 'config_option_update':
        for (const option of update.options)
          this.options = [...this.options.filter((o) => o.id !== option.id), option]
        return
      case 'available_commands_update':
        this.commands = { list: update.commands, seq }
        return
      case 'usage_update':
        return this.live.context(update.used_tokens, update.max_tokens)
      case 'compaction_update':
        return this.live.compactionUpdate(update)
      case 'compaction_summary':
        return this.live.summary(update.text)
      case 'notice': {
        const rateLimit =
          update.code === 'rate_limit' || /^Usage limit (?:close|reached)\b/.test(update.text)
        if (rateLimit) {
          const state = JSON.stringify([update.level, update.text])
          if (state === this.rateLimit) return
          this.rateLimit = state
        }
        // Older nodes put an ISO instant in the prose. Format on the viewing device,
        // after comparing the original state, so locale does not affect deduplication.
        const text = rateLimit
          ? update.text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (iso) => {
              const time = new Date(iso)
              return Number.isNaN(time.getTime()) ? iso : time.toLocaleString()
            })
          : update.text
        const line = this.message(`notice:${++this.notices}`, 'system')
        line.content = text
        line.sessionMark = { kind: 'notice', level: update.level, text }
        return
      }
      case 'user_message': {
        const m = this.message(`input:${update.message_id}`, 'user')
        const replied = readAgentReplyText(update.text)
        m.content = replied?.content ?? update.text
        if (replied) m.replyTo = replied.replyTo
        return
      }
    }
  }

  private text(
    update: SessionUpdateOf<
      'agent_message_chunk' | 'agent_message' | 'agent_thought_chunk' | 'agent_thought'
    >,
    provider: string,
    run: string
  ): void {
    const parent = update.parent_tool_call_id
    const id = this.messageId(provider, run, update.message_id, parent)
    let blocks = this.blocks.get(id)
    if (!blocks) this.blocks.set(id, (blocks = new Map()))
    const index = update.block ?? 0
    const block = blocks.get(index) ?? { text: '', thinking: '', final: false }
    if (update.kind === 'agent_message') {
      block.text = update.text
      block.final = true
    } else if (update.kind === 'agent_thought') {
      // Reasoning the agent kept to itself is not shown at all, as in the regular chat.
      block.thinking = update.redacted ? '' : update.text
      block.final = true
    } else if (!block.final) {
      if (update.kind === 'agent_message_chunk') block.text += update.text
      else block.thinking += update.text
    }
    blocks.set(index, block)
    if (![...blocks.values()].some((b) => b.text || b.thinking)) return
    const m = this.message(id, 'assistant')
    if (parent) m.parentId = this.toolId(provider, run, parent)
    this.render(m, blocks)
  }

  private render(m: ChatMessage, blocks: Map<number, Block>): void {
    const ordered = [...blocks].sort(([a], [b]) => a - b).map(([, b]) => b)
    m.content = ordered.map((b) => b.text).join('')
    m.thinking =
      ordered
        .map((b) => b.thinking)
        .filter(Boolean)
        .join('\n') || undefined
  }

  private tool(
    update: SessionUpdateOf<'tool_call' | 'tool_call_update'>,
    provider: string,
    run: string
  ): void {
    const id = this.toolId(provider, run, update.tool_call_id)
    const known = this.tools.get(id) ?? { title: '', content: [], diffs: [], locations: [] }
    this.tools.set(id, known)
    const m = this.message(id, 'tool-call')
    m.toolCallId = update.tool_call_id
    if (update.kind === 'tool_call' && update.parent_tool_call_id)
      m.parentId = this.toolId(provider, run, update.parent_tool_call_id)
    if (update.title !== undefined) known.title = update.title
    if (update.locations) known.locations = update.locations
    if (update.content) {
      known.content = update.content
      const diffs = update.content.filter((c): c is Diff => c.type === 'diff')
      if (diffs.length) known.diffs = diffs
    }
    if (update.status) known.status = update.status
    if (update.name) m.toolName = update.name
    else if (!m.toolName || update.tool_kind)
      m.toolName = KIND_NAME[update.tool_kind ?? 'other'] ?? 'Tool'
    if (update.raw_input) m.toolParams = update.raw_input
    else m.toolParams ??= {}
    m.toolTitle = known.title || undefined
    const path = known.locations[0]?.path ?? known.diffs[0]?.path
    m.toolPath = path
    m.toolPaths = [...new Set([...known.locations, ...known.diffs].map((item) => item.path))]
    const status = known.status
    m.toolStatus = status === 'failed' ? 'rejected' : 'approved'
    const text = known.content
      .filter((c): c is Extract<ToolContent, { type: 'content' }> => c.type === 'content')
      .map((c) => c.text)
      .join('\n')
    if (status === 'completed' || status === 'failed') m.toolResult = text
    else if (text) m.content = text
    // A change is shown once it was made; a refused or failed edit did not happen.
    if (status === 'completed' && known.diffs.length)
      m.toolDiff = {
        old: known.diffs.map((d) => d.old_text ?? '').join('\n'),
        new: known.diffs.map((d) => d.new_text).join('\n'),
      }
    else delete m.toolDiff
  }

  /**
   * A message whose whole content was just reported (pi's final snapshot): its blocks that are
   * not in it are gone, text streamed before included.
   */
  keepOnly(id: string, blocks: ReadonlySet<number>): void {
    const known = this.blocks.get(id)
    if (!known) return
    for (const index of [...known.keys()]) if (!blocks.has(index)) known.delete(index)
    this.render(this.message(id, 'assistant'), known)
  }

  /** Whether the chat already shows this call. */
  hasTool(id: string): boolean {
    return this.tools.has(id)
  }

  /** The tool call a node prompt asks about, by the agent's own id. */
  toolByNativeId(nativeId: string, run?: string): string | undefined {
    for (const id of this.tools.keys()) {
      const parts = JSON.parse(id) as string[]
      if (parts[2] === nativeId && (!run || parts[1] === run)) return id
    }
    return undefined
  }

  /** The changes a pending call would make, for the question that asks about it. */
  pendingDiffs(id: string): { path: string; old: string; new: string }[] {
    return (this.tools.get(id)?.diffs ?? []).map((d) => ({
      path: d.path,
      old: d.old_text ?? '',
      new: d.new_text,
    }))
  }

  projection(): UpdateProjection {
    return { commands: this.commands, mode: this.mode, options: this.options, plan: this.plan }
  }
}
