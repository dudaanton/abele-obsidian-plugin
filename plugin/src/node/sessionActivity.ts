import type { JournalEvent } from '@abele/channel-protocol'

/** What a session is doing now, as a list of sessions shows it. */
export interface SessionActivity {
  /** A run, or a long-lived session's turn, is under way. */
  running: boolean
  /** A question to the owner is open. */
  waiting: boolean
  /** The last run or turn ended with an error. */
  failed: boolean
  /** When the work under way began, ms. */
  since?: number
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/**
 * Read from a session's journal without projecting its messages: cheap enough for every session
 * at a place. One process per message reports runs; a long-lived session reports turns.
 */
export function sessionActivity(events: readonly JournalEvent[]): SessionActivity {
  const runs = new Map<string, number>()
  const prompts = new Map<string, string>()
  let failed = false
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const data = record(event.data)
    const run = typeof data.run_id === 'string' ? data.run_id : ''
    switch (event.type) {
      case 'run.started':
      case 'turn.started':
        if (!runs.has(run)) runs.set(run, Date.parse(event.at))
        break
      case 'run.completed':
      case 'run.failed':
      case 'run.interrupted':
        runs.delete(run)
        failed = event.type === 'run.failed'
        break
      case 'turn.completed':
        runs.delete(run)
        failed = data.outcome === 'failed'
        break
      case 'session.process':
        if (data.state === 'exited') runs.delete(run)
        break
      default:
        if (
          event.type.startsWith('prompt.') &&
          event.type !== 'prompt.delivered' &&
          typeof data.prompt_id === 'string' &&
          typeof data.state === 'string'
        )
          prompts.set(data.prompt_id, data.state)
    }
  }
  const since = Math.min(...runs.values())
  return {
    running: runs.size > 0,
    waiting: [...prompts.values()].includes('pending'),
    failed,
    ...(runs.size ? { since } : {}),
  }
}
