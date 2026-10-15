import type { InterceptorEntry } from '@/ai/agents/types'
import { INTERCEPTOR_CHECKS_OPTIONS } from '@/ai/agents/types'
import { SCRIPT_KEY } from './options'

export type { InterceptorEntry }

/** The picker's value for an entry: a script as `script:<name>`, an agent by its id. */
export function keyOf(entry: Pick<InterceptorEntry, 'agentId' | 'script'>): string {
  return entry.script ? `${SCRIPT_KEY}${entry.script}` : entry.agentId
}

/** An entry with the reader a picker value names; a script drops the agent and back. */
export function withKey(entry: InterceptorEntry, key: string): InterceptorEntry {
  return key.startsWith(SCRIPT_KEY)
    ? { ...entry, script: key.slice(SCRIPT_KEY.length), agentId: '' }
    : { ...entry, agentId: key, script: '' }
}

/** The entry's facts after its name, in the order one reads them. */
export function entryFacts(entry: InterceptorEntry): string[] {
  const facts = [INTERCEPTOR_CHECKS_OPTIONS.find((o) => o.value === entry.checks)?.display ?? '']
  if (entry.pattern) facts.push(`matching ${entry.pattern}`)
  if (entry.replyOnly && entry.checks !== 'answer') facts.push('reply only')
  if (entry.script) facts.push('script')
  return facts.filter(Boolean)
}

/** Moves the entry at `from` to `to`, keeping the rest in their order. */
export function moveEntry<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item)
  return next
}
