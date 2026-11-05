import type { JournalEvent } from '@abele/channel-protocol'
import { reduceTranscript, type NodeTranscript } from './NodeTranscriptReducer'
import { frozen, snapshotOf } from './storeDraft'
import { currentLocale } from '@/i18n'

const projections = new WeakMap<
  readonly JournalEvent[],
  { locale: ReturnType<typeof currentLocale>; limits: Map<number, NodeTranscript> }
>()
const empty = frozen(reduceTranscript([]))

/** Card projections share a journal revision; mutable callers never reuse a projection. */
export function cardTranscript(events: readonly JournalEvent[], limit = Infinity): NodeTranscript {
  events = snapshotOf(events)
  if (!events.length) return empty
  const immutable = Object.isFrozen(events)
  const locale = currentLocale()
  const previous = immutable ? projections.get(events) : undefined
  const limits = previous?.locale === locale ? previous.limits : new Map<number, NodeTranscript>()
  const cached = limits.get(limit)
  if (cached) return cached
  const result = reduceTranscript(limit === Infinity ? events : events.slice(-limit))
  if (immutable) {
    limits.set(limit, frozen(result))
    projections.set(events, { locale, limits })
  }
  return result
}
