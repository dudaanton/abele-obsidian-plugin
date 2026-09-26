import { normalizePath, prepareFuzzySearch, stringifyYaml, type App, TFile } from 'obsidian'
import { Criterion } from '@/entities/Criterion'

/**
 * Which notes a note picker offers — the vocabulary of the script `find()` API, so a script that
 * already knows how to find its notes can offer them the same way.
 *
 * The shorthand fields are AND-combined with each other and with `criteria`:
 * - `name` — the file name contains it;
 * - `folder` — the note is inside that folder, at any depth;
 * - `property` / `value` — the property equals the value, or merely exists without a value.
 *
 * `content` is not in it: a picker narrows its list as a person types, from the metadata Obsidian
 * already holds, and reading every note's text on each keystroke is not something it can do.
 */
export interface NoteFilter {
  name?: string
  folder?: string
  property?: string
  value?: string
  criteria?: FilterCriterion[]
}

export interface FilterCriterion {
  type: 'path' | 'name' | 'property'
  operator: Criterion['operator']
  property?: string
  value?: string
  case_insensitive?: boolean
}

/** What a picker gives back for a note: its vault path, or a wikilink to it. */
export type PickReturns = 'path' | 'link'

/** One line of the picker's list: a note to take, or a name to make a note of. */
export type NotePick = { file: TFile } | { create: string }

const CONTENT_REFUSED =
  'A note picker filters by name, folder, path and properties, not by content: it narrows its ' +
  'list on every keystroke from what Obsidian already knows about each note.'

/** The filter as criteria, refusing what a picker cannot honour. */
export function filterCriteria(filter: NoteFilter | undefined): Criterion[] {
  if (!filter) return []
  const given = filter.criteria ?? []
  if ('content' in filter || given.some((c) => (c.type as string) === 'content')) {
    throw new Error(CONTENT_REFUSED)
  }
  const raw: FilterCriterion[] = [...given]
  if (filter.name) raw.push({ type: 'name', operator: 'contains', value: filter.name })
  if (filter.folder) {
    const folder = normalizePath(filter.folder)
    if (folder) raw.push({ type: 'path', operator: 'startsWith', value: folder + '/' })
  }
  if (filter.property) {
    raw.push(
      filter.value !== undefined && filter.value !== ''
        ? { type: 'property', operator: 'equals', property: filter.property, value: filter.value }
        : { type: 'property', operator: 'exists', property: filter.property }
    )
  }
  return raw.map((c) => {
    const cr = new Criterion()
    cr.type = c.type
    cr.operator = c.operator
    cr.property = c.property ?? ''
    cr.value = c.value ?? ''
    cr.caseInsensitive = c.case_insensitive ?? false
    return cr
  })
}

function passes(app: App, file: TFile, criteria: Criterion[]): boolean {
  if (file.extension !== 'md') return false
  for (const c of criteria) {
    if (c.type === 'path' && !c.checkPathCriterion(file.path)) return false
    if (c.type === 'name' && !c.checkPathCriterion(file.basename)) return false
    if (c.type === 'property') {
      const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {}
      if (!c.checkPropertyCriterion(fm)) return false
    }
  }
  return true
}

/** Whether the note is one the filter lets through. */
export function matchesFilter(app: App, file: TFile, filter: NoteFilter | undefined): boolean {
  return passes(app, file, filterCriteria(filter))
}

/**
 * The notes the filter lets through, in the order a person would look before typing anything:
 * the ones opened lately first, then the rest by name.
 */
export function notesMatching(app: App, filter: NoteFilter | undefined): TFile[] {
  const criteria = filterCriteria(filter)
  const notes = app.vault.getMarkdownFiles().filter((f) => passes(app, f, criteria))
  const recent = app.workspace?.getLastOpenFiles?.() ?? []
  const rank = new Map(recent.map((path, i) => [path, i]))
  return notes.sort((a, b) => {
    const ra = rank.get(a.path) ?? Infinity
    const rb = rank.get(b.path) ?? Infinity
    if (ra !== rb) return ra - rb
    return titleOf(app, a).localeCompare(titleOf(app, b))
  })
}

/** What the note calls itself: its `title` property, else its file name. */
export function titleOf(app: App, file: TFile): string {
  const title = app.metadataCache.getFileCache(file)?.frontmatter?.title
  return typeof title === 'string' && title.trim() ? title.trim() : file.basename
}

/** The folder a note sits in, or empty for the vault's root. */
export function folderOf(file: TFile): string {
  const slash = file.path.lastIndexOf('/')
  return slash < 0 ? '' : file.path.slice(0, slash)
}

/**
 * The list for what has been typed so far, fuzzy-matched on the title and the path the way the
 * quick switcher matches. With `create`, a name no note has yet is offered as a new note at the
 * end — never ahead of a note that exists.
 */
export function noteSuggestions(
  app: App,
  opts: {
    filter?: NoteFilter
    query: string
    exclude?: ReadonlySet<string>
    create?: boolean
    limit?: number
  }
): NotePick[] {
  const limit = opts.limit ?? 100
  const query = opts.query.trim()
  const notes = notesMatching(app, opts.filter).filter((f) => !opts.exclude?.has(f.path))

  let found: TFile[]
  if (!query) {
    found = notes
  } else {
    const fuzzy = prepareFuzzySearch(query)
    found = notes
      .map((file) => {
        const byTitle = fuzzy(titleOf(app, file))
        const byPath = fuzzy(file.path.replace(/\.md$/, ''))
        const score = Math.max(byTitle?.score ?? -Infinity, byPath?.score ?? -Infinity)
        return { file, score }
      })
      .filter((m) => m.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .map((m) => m.file)
  }

  const picks: NotePick[] = found.slice(0, limit).map((file) => ({ file }))
  const name = safeName(query)
  if (opts.create && name) {
    const taken = notes.some(
      (f) => f.basename.toLowerCase() === name.toLowerCase() || titleOf(app, f) === name
    )
    if (!taken) picks.push({ create: name })
  }
  return picks
}

/**
 * A note from what a script or an agent wrote for it: a vault path, a path without `.md`, a
 * wikilink with or without its alias, or a bare name as a link would resolve it.
 */
export function resolveNote(app: App, raw: string): TFile | null {
  let text = raw.trim()
  const link = /^!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(text)
  if (link) text = link[1].trim()
  if (!text) return null
  const direct = app.vault.getAbstractFileByPath(text)
  if (direct instanceof TFile) return direct
  const withExt = app.vault.getAbstractFileByPath(text + '.md')
  if (withExt instanceof TFile) return withExt
  return app.metadataCache.getFirstLinkpathDest(text.replace(/\.md$/, ''), '') ?? null
}

/** The note as a picker hands it back. */
export function formatPick(app: App, file: TFile, returns: PickReturns | undefined): string {
  if (returns !== 'link') return file.path
  const text = app.metadataCache.fileToLinktext?.(file, '', true) ?? shortestLink(app, file)
  return `[[${text}]]`
}

/** The name alone where no other note has it, the path where one does — Obsidian's default. */
function shortestLink(app: App, file: TFile): string {
  const clash = app.vault
    .getMarkdownFiles()
    .some((f) => f !== file && f.basename.toLowerCase() === file.basename.toLowerCase())
  return clash ? file.path.replace(/\.md$/, '') : file.basename
}

/** A name with what a file name cannot carry taken out, as `create()` does. */
function safeName(name: string): string {
  return name
    .replace(/[*"\\/<>:|?#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Makes the note a picker offered to create, so that it passes the filter it was offered under:
 * in the filter's folder, carrying the property it asks for. `groups contains [[X]]` is a list
 * holding `[[X]]`, which is how a note joins a group.
 */
export async function createPickedNote(
  app: App,
  name: string,
  filter: NoteFilter | undefined
): Promise<TFile> {
  const properties: Record<string, unknown> = {}
  for (const c of filterCriteria(filter)) {
    if (c.type !== 'property' || !c.property || c.caseInsensitive) continue
    if (c.operator === 'equals') properties[c.property] = c.value
    else if (c.operator === 'contains') properties[c.property] = [c.value]
  }

  const folder = filter?.folder
    ? normalizePath(filter.folder)
    : (app.fileManager?.getNewFileParent?.('')?.path ?? '')
  const base = folder && folder !== '/' ? `${folder}/` : ''
  const clean = safeName(name) || 'Untitled'
  let path = `${base}${clean}.md`
  for (let i = 1; app.vault.getAbstractFileByPath(path); i++) path = `${base}${clean} ${i}.md`

  if (base && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder).catch(() => {})
  }
  const head = Object.keys(properties).length ? `---\n${stringifyYaml(properties)}---\n` : ''
  return app.vault.create(path, head)
}

/** A picker's answer as a list: a JSON array, an array, or one note on its own. */
export function pickItems(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter((s) => s.trim())
  if (typeof raw !== 'string') return []
  const text = raw.trim()
  if (!text) return []
  if (text.startsWith('[') && !text.startsWith('[[')) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed.map(String).filter((s) => s.trim())
    } catch {
      // Not JSON: one note whose name begins with a bracket.
    }
  }
  return [text]
}
