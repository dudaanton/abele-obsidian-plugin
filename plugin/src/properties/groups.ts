/**
 * A groups property: the list of links that says which notes a note belongs to (`ScopeResolver`,
 * `NoteRelations`). Any note can be a group — it becomes one by being named in another note's
 * `groups` — so there is no type or folder to look for: the groups worth offering are the notes
 * the vault already names there, most members first, and after them any other note by name.
 *
 * Entries are kept exactly as written — a link with an alias keeps it, a link by full path stays
 * one — and a new one is written as a plain wikilink. Taking off the last one leaves the property
 * empty.
 */

/** The entries a value holds, as stored: text only, empty ones dropped. */
export function groupEntries(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [value]
  return entries.filter((e): e is string => typeof e === 'string' && e.trim() !== '')
}

/** Whether a value is this widget's to draw: a link, a list of them, or nothing yet. */
export function isGroupsValue(value: unknown): boolean {
  if (value == null || typeof value === 'string') return true
  return Array.isArray(value) && value.every((v) => v == null || typeof v === 'string')
}

const WIKILINK = /^\s*\[\[([^\]]+)\]\]\s*$/

/**
 * What an entry points at, without its alias or heading: `[[Work/Garden|Garden]]` is
 * `Work/Garden`. Text that is not a link is read as a note's name, the way it would be typed.
 */
export function groupLinkpath(entry: string): string {
  const match = WIKILINK.exec(entry)
  const inner = match ? match[1] : entry
  return inner.split('|')[0].split('#')[0].trim()
}

/** The alias an entry gives its link, if it gives one. */
export function groupAlias(entry: string): string | null {
  const match = WIKILINK.exec(entry)
  if (!match) return null
  const bar = match[1].indexOf('|')
  const alias = bar >= 0 ? match[1].slice(bar + 1).trim() : ''
  return alias || null
}

/** The name a group is shown by: its alias, else the note's own name, else the link's last part. */
export function groupTitle(entry: string, basename?: string | null): string {
  const alias = groupAlias(entry)
  if (alias) return alias
  if (basename) return basename
  const path = groupLinkpath(entry)
  return path.split('/').pop()?.replace(/\.md$/i, '') || entry
}

/** A new entry for a note, by the link text Obsidian would write for it. */
export function groupLink(linktext: string): string {
  return `[[${linktext}]]`
}

/**
 * The stored list with `entry` added at the end, or null when it points at a note already there.
 * `target` tells which note an entry points at — the same note by another spelling is the same
 * group.
 */
export function addGroup(
  value: unknown,
  entry: string,
  target: (entry: string) => string
): string[] | null {
  const held = groupEntries(value)
  const want = target(entry)
  if (!want || held.some((e) => target(e) === want)) return null
  return [...held, entry]
}

/** The stored list without the entry at `index`: null once nothing is left. */
export function removeGroupAt(value: unknown, index: number): string[] | null {
  const rest = groupEntries(value).filter((_, i) => i !== index)
  return rest.length ? rest : null
}

/** A note that can be offered as a group. */
export interface GroupNote {
  path: string
  title: string
  /** How many notes name it in their groups. */
  members: number
}

/**
 * The notes named as groups anywhere in the vault, most members first. `values` holds each
 * note's raw `groups` value; `target` resolves an entry to the path of the note it points at, or
 * null when there is no such note — a link to nothing is no group.
 */
export function collectGroups(
  values: Iterable<{ value: unknown; source: string }>,
  target: (entry: string, source: string) => string | null,
  title: (path: string) => string
): GroupNote[] {
  const counts = new Map<string, number>()
  for (const { value, source } of values) {
    const seen = new Set<string>()
    for (const entry of groupEntries(value)) {
      const path = target(entry, source)
      if (!path || seen.has(path)) continue
      seen.add(path)
      counts.set(path, (counts.get(path) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([path, members]) => ({ path, title: title(path), members }))
    .sort((a, b) => b.members - a.members || a.title.localeCompare(b.title))
}

const fold = (text: string) => text.toLowerCase().trim()

/**
 * The groups worth offering for what is typed, less the notes the property already holds (`held`,
 * by path) and the note itself: the vault's groups first, most members first, then — once
 * something is typed — any other note whose name or path matches. In each part, names that start
 * with the text come before those that only contain it.
 */
export function suggestGroups(
  groups: readonly GroupNote[],
  notes: readonly { path: string; title: string }[],
  held: ReadonlySet<string>,
  query: string,
  limit = 50
): GroupNote[] {
  const q = fold(query)
  const free = (n: { path: string }) => !held.has(n.path)
  const rank = <T extends { path: string; title: string }>(list: readonly T[]): T[] => {
    const open = list.filter(free)
    if (!q) return open
    const starts = open.filter((n) => fold(n.title).startsWith(q))
    const within = open.filter(
      (n) =>
        !fold(n.title).startsWith(q) &&
        (fold(n.title).includes(q) || fold(n.path.replace(/\.md$/i, '')).includes(q))
    )
    return [...starts, ...within]
  }
  const used = rank(groups)
  if (!q) return used.slice(0, limit)
  const known = new Set(groups.map((g) => g.path))
  const others = rank(notes.filter((n) => !known.has(n.path))).map((n) => ({ ...n, members: 0 }))
  return [...used, ...others].slice(0, limit)
}
