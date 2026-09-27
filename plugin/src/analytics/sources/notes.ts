/**
 * Ordinary notes as a table — daily notes with `weight` and `sleep`, a folder of workouts —
 * one row per note, one column per property. Each column's type is read from its values, and a
 * value that does not fit (a `weight: heavy` among numbers) is counted rather than guessed at.
 */
import type { App } from 'obsidian'
import { coerce, inferType, parseDate, type Column, type Row, type Table } from '../table'

export interface NotesSource {
  kind: 'notes'
  /** Only notes under this folder. */
  folder?: string
  /** Only notes whose `type` property is this. */
  type?: string
  /** Only notes whose properties equal these values (a list property: contains it). */
  where?: Record<string, string | number | boolean>
  /** Only notes with this tag, `#` optional. */
  tag?: string
  /**
   * The property holding each note's date. Left out: a `YYYY-MM-DD` in the file name (daily
   * notes), then `date`, then `created`.
   */
  date?: string
  /** The properties to read. Left out: every property the matching notes have, up to 40. */
  columns?: string[]
  /** Dates, `YYYY-MM-DD`, both included — only notes with a date then. */
  from?: string
  to?: string
}

export interface NotesDeps {
  app: App
  inScope: (path: string) => boolean
}

const MAX_COLUMNS = 40
const MAX_ROWS = 50_000
const SKIP = new Set(['position', 'tags', 'aliases', 'cssclasses'])

function equalsLoose(actual: unknown, wanted: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((a) => equalsLoose(a, wanted))
  if (actual === wanted) return true
  const norm = (v: unknown) =>
    String(v)
      .replace(/^\[\[|\]\]$/g, '')
      .trim()
      .toLowerCase()
  return actual !== null && actual !== undefined && norm(actual) === norm(wanted)
}

export function readNotes(spec: NotesSource, deps: NotesDeps): Table {
  const { app } = deps
  const folder = spec.folder?.replace(/^\/+|\/+$/g, '')
  const tag = spec.tag?.replace(/^#/, '').toLowerCase()
  const meta: Record<string, unknown> = { source: 'notes' }
  let outOfScope = 0
  let noDate = 0

  const found: { path: string; name: string; date: string | null; fm: Record<string, unknown> }[] =
    []
  for (const file of app.vault.getMarkdownFiles()) {
    if (folder && !file.path.startsWith(folder + '/')) continue
    const cache = app.metadataCache.getFileCache(file)
    const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>
    if (spec.type && !equalsLoose(fm.type, spec.type)) continue
    if (spec.where && !Object.entries(spec.where).every(([k, v]) => equalsLoose(fm[k], v))) continue
    if (tag) {
      const tags = [
        ...(Array.isArray(fm.tags) ? fm.tags : typeof fm.tags === 'string' ? [fm.tags] : []),
        ...((cache as { tags?: { tag: string }[] } | null)?.tags ?? []).map((t) => t.tag),
      ].map((t) => String(t).replace(/^#/, '').toLowerCase())
      if (!tags.some((t) => t === tag || t.startsWith(tag + '/'))) continue
    }
    if (!deps.inScope(file.path)) {
      outOfScope++
      continue
    }
    const date = spec.date
      ? parseDate(fm[spec.date])
      : (file.basename.match(/\d{4}-\d{2}-\d{2}/)?.[0] ??
        parseDate(fm.date) ??
        parseDate(fm.created))
    if (spec.from || spec.to) {
      if (!date) {
        noDate++
        continue
      }
      if ((spec.from && date < spec.from) || (spec.to && date > spec.to)) continue
    }
    found.push({ path: file.path, name: file.basename, date, fm })
    if (found.length >= MAX_ROWS) {
      meta.truncated = `Stopped at ${MAX_ROWS} notes.`
      break
    }
  }

  const names =
    spec.columns ??
    [...new Set(found.flatMap((n) => Object.keys(n.fm)))]
      .filter((k) => !SKIP.has(k) && k !== spec.date)
      .slice(0, MAX_COLUMNS)

  const columns: Column[] = [
    { name: 'date', type: 'date' },
    { name: 'name', type: 'string' },
    { name: 'path', type: 'string' },
  ]
  const unparsed: Record<string, number> = {}
  const typed = names
    .filter((n) => n !== 'date' && n !== 'name' && n !== 'path')
    .map((n) => ({ name: n, type: inferType(found.map((f) => f.fm[n])) }))
  columns.push(...typed)

  const rows: Row[] = found
    .sort((a, b) =>
      (a.date ?? '') < (b.date ?? '') ? -1 : (a.date ?? '') > (b.date ?? '') ? 1 : 0
    )
    .map((n) => {
      const row: Row = { date: n.date, name: n.name, path: n.path }
      for (const c of typed) {
        const raw = n.fm[c.name]
        const cell = coerce(raw, c.type)
        if (cell === null && raw !== null && raw !== undefined && raw !== '') {
          unparsed[c.name] = (unparsed[c.name] ?? 0) + 1
        }
        row[c.name] = cell
      }
      return row
    })

  if (outOfScope) meta.outOfScope = outOfScope
  if (noDate) meta.skippedNoDate = noDate
  if (Object.keys(unparsed).length) meta.unparsed = unparsed
  return { columns, rows, meta }
}
