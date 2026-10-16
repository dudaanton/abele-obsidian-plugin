import type { ChatMessage } from '@/ai/types'
import type { BackgroundTask, ContextUse } from './sessionLive'

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
 * it. Like `ClaudeTranscript`, it is fed the journal in order and answers whether it took an event.
 */
export class LiveTranscript {
  private live = false
  private tasks: BackgroundTask[] = []
  /** When each task was first seen running, ms: the node does not say when it started. */
  private readonly since = new Map<string, number>()
  private context: ContextUse | null = null
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
          return {
            id,
            kind: taskKind(typeof task.task_type === 'string' ? task.task_type : null),
            title:
              typeof task.description === 'string' && task.description
                ? task.description
                : 'A background task',
            since: this.since.get(id) ?? at,
          }
        })
        return true
      }
      case 'session.context': {
        const used = data.total_tokens,
          limit = data.max_tokens
        this.context =
          typeof used === 'number' && typeof limit === 'number' && limit > 0
            ? { used, limit }
            : null
        return true
      }
      case 'compaction.started':
        if (this.compaction?.sessionMark?.kind !== 'compacting') this.compaction = this.mark()
        this.compaction.sessionMark = { kind: 'compacting' }
        return true
      case 'compaction.completed': {
        const open = this.compaction?.sessionMark?.kind === 'compacting'
        if (data.result !== 'success') {
          const line = open ? this.compaction! : this.mark()
          delete line.sessionMark
          line.error = `Compacting failed${text('error') ? `: ${text('error')}` : ''}`
          this.compaction = undefined
          return true
        }
        const line = open ? this.compaction! : this.mark()
        line.sessionMark = {
          kind: 'compacted',
          ...(typeof data.pre_tokens === 'number' ? { before: data.pre_tokens } : {}),
          ...(typeof data.post_tokens === 'number' ? { after: data.post_tokens } : {}),
        }
        this.compaction = line
        return true
      }
      case 'compaction.summary':
        // The retelling goes with the line it belongs to; a large one is a stored artifact.
        if (this.compaction?.sessionMark?.kind === 'compacted' && text('text'))
          this.compaction.content = text('text')
        return true
    }
    if (type === 'claude.task' && data.subtype === 'task_notification')
      this.notified = text('summary') || this.notified
    if (!QUIET.has(type)) return false
    return true
  }

  private mark(): ChatMessage {
    return this.message(`live-mark:${++this.marks}`, 'system')
  }

  private dropCompaction(): void {
    if (!this.compaction) return
    delete this.compaction.sessionMark
    this.compaction.error = 'Compacting stopped with the session'
    this.compaction = undefined
  }

  /** Read after the last event. */
  projection(): LiveProjection {
    return {
      live: this.live,
      tasks: this.tasks,
      context: this.context,
      compacting: this.compaction?.sessionMark?.kind === 'compacting',
    }
  }
}
