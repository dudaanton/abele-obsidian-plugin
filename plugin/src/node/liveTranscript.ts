import type { ChatMessage } from '@/ai/types'
import type { BackgroundTask, ContextUse } from './sessionLive'
import { uiField, uiMessage } from '@/i18n/streamBErrors'
import { agentText } from '@/i18n/streamBText'

/** What the journal says about a long-lived session beside its messages. */
export interface LiveProjection {
  /** The node keeps one process for this chat: it has reported one. */
  live: boolean
  tasks: BackgroundTask[]
  context: ContextUse | null
  compacting: boolean
}

type Message = (id: string, role: ChatMessage['role']) => ChatMessage
interface Runs {
  add(run: string): void
  delete(run: string): void
}

/** Events of a long-lived session that are bookkeeping, read here and never shown as details. */
const QUIET = new Set([
  'turn.interrupt_requested',
  'session.message.sent',
  'claude.status',
  'claude.rate_limit',
  'claude.task',
])

const taskKind = (type: string | null): BackgroundTask['kind'] =>
  /bash|shell|command/i.test(type ?? '')
    ? 'command'
    : /monitor|watch/i.test(type ?? '')
      ? 'monitor'
      : 'agent'

/**
 * A long-lived session's own events (`docs/claude-sessions.md` of the node): its process and
 * turns instead of runs, the background tasks it reports, its context, compacting and what woke
 * it. Like `UpdateTranscript`, it is fed the journal in order and answers whether it took an event.
 */
export class LiveTranscript {
  private live = false
  private tasks: BackgroundTask[] = []
  /** When each task was first seen running, ms: the node does not say when it started. */
  private readonly since = new Map<string, number>()
  private context_: ContextUse | null = null
  /** The compaction line closed last, until something else happens in the session. */
  private closed?: ChatMessage
  private compaction?: ChatMessage
  /** What the last background task to end said, for the line its turn starts with. */
  private notified = ''
  private marks = 0

  constructor(
    private readonly message: Message,
    private readonly runs: Runs,
    private readonly finish: (inputs: string[], outcome: string) => void
  ) {}

  apply(type: string, data: Record<string, unknown>, at: number): boolean {
    const text = (key: string) => (typeof data[key] === 'string' ? data[key] : '')
    const run = text('run_id')
    if (!QUIET.has(type) && type !== 'claude.task') this.live = true
    switch (type) {
      case 'session.process':
        if (data.state === 'exited') {
          this.runs.delete(run)
          this.tasks = []
          if (this.compaction?.sessionMark?.kind === 'compacting') this.dropCompaction()
        }
        return true
      case 'turn.started':
        this.closed = undefined
        this.runs.add(run)
        if (data.trigger === 'task') {
          const woke = this.mark()
          woke.sessionMark = { kind: 'woke', ...(this.notified ? { text: this.notified } : {}) }
        }
        this.notified = ''
        return true
      case 'turn.completed':
        this.runs.delete(run)
        this.finish(
          Array.isArray(data.input_ids) ? data.input_ids.map(String) : [],
          text('outcome')
        )
        return true
      case 'session.tasks': {
        const list = Array.isArray(data.tasks) ? (data.tasks as Record<string, unknown>[]) : []
        this.tasks = list.map((task) => {
          const id = String(task.task_id)
          if (!this.since.has(id)) this.since.set(id, at)
          const described = typeof task.description === 'string' && task.description
          const item: BackgroundTask = {
            id,
            kind: taskKind(typeof task.task_type === 'string' ? task.task_type : null),
            title: described || agentText('streamB.unnamedBackgroundTask'),
            since: this.since.get(id) ?? at,
          }
          if (!described) uiField(item, 'title', uiMessage('streamB.unnamedBackgroundTask'))
          return item
        })
        return true
      }
      case 'session.context': {
        const used = data.total_tokens,
          limit = data.max_tokens
        this.context_ =
          typeof used === 'number' && typeof limit === 'number' && limit > 0
            ? { used, limit }
            : null
        return true
      }
      case 'compaction.started':
        this.started()
        return true
      case 'compaction.completed':
        if (data.result !== 'success')
          this.ended({ failed: true, error: text('error') || undefined })
        else
          this.ended({
            failed: false,
            ...(typeof data.pre_tokens === 'number' ? { before: data.pre_tokens } : {}),
            ...(typeof data.post_tokens === 'number' ? { after: data.post_tokens } : {}),
          })
        return true
      case 'compaction.summary':
        this.summary(text('text'))
        return true
    }
    if (type === 'claude.task' && data.subtype === 'task_notification')
      this.notified = text('summary') || this.notified
    if (!QUIET.has(type)) return false
    return true
  }

  /** The context meter, from whichever record reported it. */
  context(used: number | null, limit: number | null): void {
    this.context_ = used !== null && limit !== null && limit > 0 ? { used, limit } : this.context_
  }

  /** A compaction reported as a session update, by an agent the node does not frame itself. */
  compactionUpdate(update: {
    state: string
    pre_tokens?: number | null
    post_tokens?: number | null
    error?: string | null
  }): void {
    if (update.state === 'started') this.started()
    else if (update.state === 'failed')
      this.ended({ failed: true, error: update.error || undefined })
    else
      this.ended({
        failed: false,
        ...(typeof update.pre_tokens === 'number' ? { before: update.pre_tokens } : {}),
        ...(typeof update.post_tokens === 'number' ? { after: update.post_tokens } : {}),
      })
  }

  summary(text: string): void {
    // The retelling goes with the line it belongs to; a large one is a stored artifact.
    if (this.compaction?.sessionMark?.kind === 'compacted' && text) this.compaction.content = text
  }

  private started(): void {
    this.closed = undefined
    if (this.compaction?.sessionMark?.kind !== 'compacting') this.compaction = this.mark()
    this.compaction.sessionMark = { kind: 'compacting' }
  }

  /**
   * The end of a compaction. The node and the agent may both report one end (the node's own
   * record and the agent's status): the second fills in what the first left out, never a line
   * of its own.
   */
  private ended(end: { failed: boolean; error?: string; before?: number; after?: number }): void {
    const open = this.compaction?.sessionMark?.kind === 'compacting' ? this.compaction : undefined
    const again = !open && !!this.closed
    const line = open ?? this.closed ?? this.mark()
    const was = again ? line.sessionMark : undefined
    if (end.failed) {
      // A success already said stands.
      if (was?.kind === 'compacted') return
      const text = end.error ?? was?.text
      line.sessionMark = { kind: 'failed', ...(text ? { text } : {}) }
      this.compaction = undefined
    } else {
      const before = end.before ?? was?.before
      const after = end.after ?? was?.after
      line.sessionMark = {
        kind: 'compacted',
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
      }
      this.compaction = line
    }
    this.closed = line
  }

  private mark(): ChatMessage {
    return this.message(`live-mark:${++this.marks}`, 'system')
  }

  private dropCompaction(): void {
    if (!this.compaction) return
    this.compaction.sessionMark = {
      kind: 'failed',
      text: agentText('streamB.stoppedWithSession'),
    }
    uiField(this.compaction.sessionMark, 'text', uiMessage('streamB.stoppedWithSession'))
    this.compaction = undefined
  }

  /** Read after the last event. */
  projection(): LiveProjection {
    return {
      live: this.live,
      tasks: this.tasks,
      context: this.context_,
      compacting: this.compaction?.sessionMark?.kind === 'compacting',
    }
  }
}
