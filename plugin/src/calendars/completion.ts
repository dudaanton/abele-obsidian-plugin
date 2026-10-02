/** Owner marks, independent of the calendar server and of any UI or storage API. */
import type { CalendarEvent } from './events'

export interface CompletionMark {
  feedId: string
  /** Last seen in a successful read, or when ticked, in epoch milliseconds. */
  seenAt: number
}
export type CompletionMarks = Record<string, CompletionMark>

export interface CompletionStorage {
  read(): CompletionMarks
  write(marks: CompletionMarks): Promise<void>
}

/** Unambiguous even when a UID contains separators. No device-local timestamp here. */
export function completionKey(event: CalendarEvent): string {
  return JSON.stringify([event.feedId, event.uid, event.recurrenceId ?? null])
}

export function completionMarksFrom(raw: unknown): CompletionMarks {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([key, value]) => {
        if (!value || typeof value !== 'object') return false
        const mark = value as CompletionMark
        try {
          const identity: unknown = JSON.parse(key)
          return (
            Array.isArray(identity) &&
            identity.length === 3 &&
            identity[0] === mark.feedId &&
            typeof identity[1] === 'string' &&
            (identity[2] === null || typeof identity[2] === 'string') &&
            typeof mark.feedId === 'string' &&
            Number.isFinite(mark.seenAt) &&
            mark.seenAt >= 0
          )
        } catch {
          return false
        }
      })
      .map(([key, value]) => [key, { ...(value as CompletionMark) }])
  )
}

const RETENTION_MS = 180 * 86400000
const DAY_MS = 86400000

export class EventCompletionStore {
  private pending: Promise<void> = Promise.resolve()
  constructor(private readonly storage: CompletionStorage) {}

  private update(change: () => Promise<void>): Promise<void> {
    const next = this.pending.then(change)
    this.pending = next.catch(() => {})
    return next
  }

  isDone(event: CalendarEvent): boolean {
    return (
      event.recurrenceId !== undefined && Object.hasOwn(this.storage.read(), completionKey(event))
    )
  }

  setDone(event: CalendarEvent, done: boolean, now: number): Promise<void> {
    return this.update(async () => {
      if (!event.uid || event.recurrenceId === undefined)
        throw new Error('Refresh the calendar before marking this occurrence.')
      const marks = { ...this.storage.read() }
      const key = completionKey(event)
      if (done) marks[key] = { feedId: event.feedId, seenAt: now }
      else delete marks[key]
      await this.storage.write(marks)
    })
  }

  /** Only call for a successful feed read (or a removed feed), never a network failure. */
  reconcile(feedId: string, events: readonly CalendarEvent[], now: number): Promise<void> {
    return this.update(async () => {
      const seen = new Set(events.map(completionKey))
      const marks = { ...this.storage.read() }
      let changed = false
      for (const [key, mark] of Object.entries(marks)) {
        if (mark.feedId !== feedId) continue
        if (seen.has(key)) {
          // No write every few minutes just to advance a retention clock.
          if (now - mark.seenAt >= DAY_MS) {
            marks[key] = { ...mark, seenAt: now }
            changed = true
          }
        } else if (now - mark.seenAt >= RETENTION_MS) {
          delete marks[key]
          changed = true
        }
      }
      if (changed) await this.storage.write(marks)
    })
  }
}
