/**
 * Interceptors as an ordered list, and the single interceptor that came before it.
 *
 * An agent or a chat that has `interceptors` runs that list, in its order. One saved before lists
 * has only the single `interceptor*` fields, which read as a list of one. The single fields stay
 * after that as a mirror of the list's first switched-on entry: an older build on another device
 * still runs that one, and writing them (the settings tool, an older device's edit arriving)
 * changes that entry rather than being ignored.
 *
 * Nothing here knows about Obsidian or about how a list is stored.
 */
import { nanoid } from 'nanoid'
import {
  normaliseChecks,
  normaliseContextDepth,
  type InterceptorChecks,
  type InterceptorEntry,
} from '../agents/types'

/** The single interceptor, as agents and chats stored it before lists. */
export interface LegacyInterceptorFields {
  interceptorAgentId?: string
  interceptorContextDepth?: number
  interceptorReplyOnly?: boolean
  interceptorChecks?: InterceptorChecks
  interceptorScript?: string
  interceptorPattern?: string
}

export const LEGACY_INTERCEPTOR_KEYS = [
  'interceptorAgentId',
  'interceptorContextDepth',
  'interceptorReplyOnly',
  'interceptorChecks',
  'interceptorScript',
  'interceptorPattern',
] as const satisfies readonly (keyof LegacyInterceptorFields)[]

/** Which side of the conversation an interceptor is reading. */
export type ChainSide = 'message' | 'answer'

export function newEntryId(): string {
  return `ic-${nanoid(10)}`
}

/** A new entry with today's defaults: reads the person's messages and holds them. */
export function newEntry(patch: Partial<InterceptorEntry> = {}): InterceptorEntry {
  return {
    id: newEntryId(),
    agentId: '',
    script: '',
    checks: 'message',
    pattern: '',
    replyOnly: false,
    contextDepth: 0,
    enabled: true,
    ...patch,
  }
}

/** Has someone to read: a script, or a reviewing agent. */
export function hasReader(entry: Pick<InterceptorEntry, 'agentId' | 'script'>): boolean {
  return Boolean(entry.script || entry.agentId)
}

/** The single interceptor as an entry, or null when the fields name nobody. */
export function legacyEntry(fields: LegacyInterceptorFields, id?: string): InterceptorEntry | null {
  const script = typeof fields.interceptorScript === 'string' ? fields.interceptorScript : ''
  const agentId = typeof fields.interceptorAgentId === 'string' ? fields.interceptorAgentId : ''
  if (!script && !agentId) return null
  return {
    id: id ?? newEntryId(),
    // A script wins over the agent, as it did when there was one interceptor.
    agentId: script ? '' : agentId,
    script,
    checks: normaliseChecks(fields.interceptorChecks),
    pattern: typeof fields.interceptorPattern === 'string' ? fields.interceptorPattern : '',
    replyOnly: fields.interceptorReplyOnly === true,
    contextDepth: normaliseContextDepth(fields.interceptorContextDepth),
    enabled: true,
  }
}

/** The id the single interceptor has as a list of one, the same on every read. */
export const SINGLE_ENTRY_ID = 'ic-single'

/**
 * The list an agent or a chat runs: its own, or the single interceptor as a list of one. This is
 * the whole migration: nothing is rewritten on load, so settings an older build shares stay as
 * they were until the list is first edited, which writes `interceptors`.
 */
export function entriesOf(
  holder: LegacyInterceptorFields & { interceptors?: InterceptorEntry[] }
): InterceptorEntry[] {
  if (Array.isArray(holder.interceptors)) return holder.interceptors
  const single = legacyEntry(holder, SINGLE_ENTRY_ID)
  return single ? [single] : []
}

/** The single fields an older build reads: the first switched-on entry, or none. */
export function legacyFields(list: readonly InterceptorEntry[]): Required<LegacyInterceptorFields> {
  const first = list.find((e) => e.enabled && hasReader(e))
  return {
    interceptorAgentId: first ? (first.script ? '' : first.agentId) : '',
    interceptorContextDepth: first?.contextDepth ?? 0,
    interceptorReplyOnly: first?.replyOnly ?? false,
    interceptorChecks: first?.checks ?? 'message',
    interceptorScript: first?.script ?? '',
    interceptorPattern: first?.pattern ?? '',
  }
}

/**
 * `list` with a change written in the single fields applied to the entry they mirror. Naming
 * nobody removes that entry; naming someone where the list has no switched-on entry puts a new
 * one first. Choosing an agent drops a script and the other way round, as before.
 */
export function withLegacyPatch(
  list: readonly InterceptorEntry[],
  patch: LegacyInterceptorFields
): InterceptorEntry[] {
  const at = list.findIndex((e) => e.enabled && hasReader(e))
  const current = at >= 0 ? list[at] : newEntry()
  const next: InterceptorEntry = { ...current }
  if (patch.interceptorScript !== undefined) {
    next.script = patch.interceptorScript
    if (patch.interceptorScript) next.agentId = ''
  }
  if (patch.interceptorAgentId !== undefined) {
    next.agentId = patch.interceptorAgentId
    if (patch.interceptorAgentId && patch.interceptorScript === undefined) next.script = ''
  }
  if (patch.interceptorChecks !== undefined) next.checks = normaliseChecks(patch.interceptorChecks)
  if (patch.interceptorPattern !== undefined) next.pattern = patch.interceptorPattern
  if (patch.interceptorReplyOnly !== undefined) next.replyOnly = patch.interceptorReplyOnly
  if (patch.interceptorContextDepth !== undefined)
    next.contextDepth = normaliseContextDepth(patch.interceptorContextDepth)

  if (!hasReader(next)) return at >= 0 ? list.filter((_, i) => i !== at) : [...list]
  if (at >= 0) return list.map((e, i) => (i === at ? next : e))
  return [next, ...list]
}

/** Whether `entry` reads this side at all: switched on and checking it. */
export function readsSide(entry: InterceptorEntry, side: ChainSide): boolean {
  return entry.enabled && hasReader(entry) && (entry.checks === 'both' || entry.checks === side)
}

/** The entries that read `side`, in their order: what "2 of 3" counts. */
export function chainFor(list: readonly InterceptorEntry[], side: ChainSide): InterceptorEntry[] {
  return list.filter((e) => readsSide(e, side))
}

/**
 * A stored list made well-formed: entries that are not objects or name nobody are dropped, each
 * field falls back to its default, ids are made unique, and an agent never reads for itself.
 * `changed` says whether anything that was there had to be corrected.
 */
export function normaliseEntries(
  raw: unknown,
  selfId?: string
): { entries: InterceptorEntry[]; changed: boolean } {
  if (!Array.isArray(raw)) return { entries: [], changed: raw !== undefined }
  let changed = false
  const seen = new Set<string>()
  const entries: InterceptorEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      changed = true
      continue
    }
    const e = item as Record<string, unknown>
    const script = typeof e.script === 'string' ? e.script : ''
    let agentId = typeof e.agentId === 'string' ? e.agentId : ''
    if (script) agentId = ''
    if (selfId && agentId === selfId) agentId = ''
    if (!script && !agentId) {
      changed = true
      continue
    }
    let id = typeof e.id === 'string' && e.id ? e.id : newEntryId()
    if (seen.has(id)) id = newEntryId()
    seen.add(id)
    const entry: InterceptorEntry = {
      id,
      agentId,
      script,
      checks: normaliseChecks(e.checks),
      pattern: typeof e.pattern === 'string' ? e.pattern : '',
      replyOnly: e.replyOnly === true,
      contextDepth: normaliseContextDepth(e.contextDepth),
      enabled: e.enabled !== false,
    }
    if (
      entry.id !== e.id ||
      entry.agentId !== e.agentId ||
      entry.script !== e.script ||
      entry.checks !== e.checks ||
      entry.pattern !== e.pattern ||
      entry.replyOnly !== e.replyOnly ||
      entry.contextDepth !== e.contextDepth ||
      entry.enabled !== e.enabled
    )
      changed = true
    entries.push(entry)
  }
  return { entries, changed }
}

/** Copies, so that editing one list never reaches another. */
export function copyEntries(list: readonly InterceptorEntry[]): InterceptorEntry[] {
  return list.map((e) => ({ ...e }))
}

/**
 * What writing `patch` to an agent or a chat that may have a list really writes: a new list keeps
 * the single fields mirroring it, and the single fields written alone, on a holder with a list,
 * change the entry they mirror. A holder with no list keeps the single fields as they come.
 */
export function interceptorPatch<P extends LegacyInterceptorFields & { interceptors?: InterceptorEntry[] }>(
  holder: LegacyInterceptorFields & { interceptors?: InterceptorEntry[] },
  patch: P
): P {
  if (patch.interceptors) return { ...patch, ...legacyFields(patch.interceptors) }
  if (!Array.isArray(holder.interceptors)) return patch
  const single: LegacyInterceptorFields = {}
  for (const key of LEGACY_INTERCEPTOR_KEYS) {
    if (key in patch) (single as Record<string, unknown>)[key] = patch[key]
  }
  if (!Object.keys(single).length) return patch
  const interceptors = withLegacyPatch(holder.interceptors, single)
  return { ...patch, interceptors, ...legacyFields(interceptors) }
}
