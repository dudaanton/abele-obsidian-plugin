/**
 * What `AbeleConfig` needs to tell one settings file from another by what it says rather than
 * by how it is spelled.
 *
 * `data.json` syncs between devices and the later save wins. A device that wrote the file back
 * every time it read another device's copy — the same settings, serialised in another key order
 * or merely saved again on the way through a reload — would hand it straight back, and two
 * devices would pass it between them for ever. So the file is compared as *canonical JSON*: the
 * text `JSON.stringify` makes of it once every object's keys are sorted. Two files that say the
 * same thing give the same string, whatever order their keys were written in and whatever
 * whitespace was around them.
 */

import { isPrototypeName } from '@/helpers/prototypeNames'

/**
 * How long a reload waits before it looks at a file that would not parse a second time.
 *
 * Writes to the settings file are not atomic — Obsidian's adapter truncates and writes, and so
 * does the sync — so a reload that lands mid-write finds a short file. Half a second is far
 * longer than a write of a few kilobytes takes, and short enough that nobody sees the wait.
 */
export const UNREADABLE_RETRY_MS = 500

/**
 * The value as JSON with every object's keys in sorted order.
 *
 * JSON's own rules otherwise: `undefined` properties are left out, `toJSON` is honoured (the
 * replacer sees what it returned), and arrays keep their order, since in settings the order of
 * a list is part of what it says.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return inner
    const source = inner as Record<string, unknown>
    // `fromEntries` rather than assignment: a hand-edited file may hold a `__proto__` key, and
    // assigning it would set the copy's prototype instead of keeping the key.
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, source[key]])
    )
  })
}

/** Whether a value read off disk is a settings object at all, rather than nothing or garbage. */
export function isSettingsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms))

/** One setting this copy changed in memory: where it sits, and what it is now (absent: gone). */
export interface LocalChange {
  path: string[]
  value: unknown
}

/**
 * What changed in memory since the settings were last read or written: every place `mine` says
 * something other than `base`, as deep as both are objects. A list is one value — in settings
 * its order is part of what it says, and two edits to one list do not merge.
 *
 * With no `base` at all everything is a change: nothing was ever read to tell them apart.
 * `keep` names top-level keys never counted, whatever they hold.
 */
export function localChanges(
  base: unknown,
  mine: unknown,
  keep: readonly string[] = []
): LocalChange[] {
  if (base === null || base === undefined) return [{ path: [], value: mine }]
  const changes: LocalChange[] = []
  const walk = (was: unknown, now: unknown, path: string[]): void => {
    if (isSettingsObject(was) && isSettingsObject(now)) {
      for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
        if (path.length === 0 && keep.includes(key)) continue
        // A name that reaches a prototype is no setting, and put back it would re-prototype
        // the copy the merge builds (`setAt`).
        if (isPrototypeName(key)) continue
        walk(was[key], now[key], [...path, key])
      }
      return
    }
    if (canonicalJson(was) !== canonicalJson(now)) changes.push({ path, value: now })
  }
  walk(base, mine, [])
  return changes
}

/**
 * `theirs` with `changes` put back on top: a file that arrived, with what this copy changed in
 * memory meanwhile. Nothing of `theirs` is modified; the objects on a changed path are copies.
 */
export function reapply(theirs: unknown, changes: readonly LocalChange[]): unknown {
  let result = theirs
  for (const { path, value } of changes) result = setAt(result, path, value)
  return result
}

/**
 * `target` with `value` at `path`, every object on the way a copy. A path through a name that
 * reaches a prototype changes nothing: assigned, `__proto__` would set the copy's prototype
 * rather than a key. The key itself is defined, not assigned, for the same reason.
 */
function setAt(target: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value
  if (path.some(isPrototypeName)) return target
  const [key, ...rest] = path
  const copy: Record<string, unknown> = isSettingsObject(target) ? { ...target } : {}
  const inner = setAt(
    Object.prototype.hasOwnProperty.call(copy, key) ? copy[key] : undefined,
    rest,
    value
  )
  if (inner === undefined) delete copy[key]
  else {
    Object.defineProperty(copy, key, {
      value: inner,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return copy
}

/** Obsidian's `vault.adapter.stat`, as much of it as a settings file's stamp needs. */
interface StampAdapter {
  stat(path: string): Promise<{ size: number; mtime: number } | null>
}

/**
 * The plugin's `data.json` as its size and mtime, or null for no file — or for a plugin with no
 * disk to ask (a test's), which then never looks again before a save.
 *
 * A save compares this against the stamp of the file it last read or wrote: a different one
 * means something else wrote the file since, and it is read again before anything is written
 * over it. A stat rather than a read, because most saves find the file as they left it.
 */
export function settingsStampOf(plugin: unknown): () => Promise<string | null> {
  const host = plugin as
    | { app?: { vault?: { adapter?: Partial<StampAdapter> } }; manifest?: { dir?: string } }
    | null
    | undefined
  const adapter = host?.app?.vault?.adapter
  const dir = host?.manifest?.dir
  if (!adapter || typeof adapter.stat !== 'function' || !dir) return async () => null
  const stat = adapter.stat.bind(adapter)
  return async () => {
    try {
      const found = await stat(`${dir}/data.json`)
      return found ? `${found.size}:${found.mtime}` : null
    } catch {
      return null
    }
  }
}
