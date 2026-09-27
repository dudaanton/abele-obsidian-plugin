/**
 * A base's rows as a table: the notes a view of a `.base` file finds, with its filters, formulas,
 * sort and limit applied by Obsidian itself (`baseProbe.ts`), and a column for each property the
 * view shows. Typed from the values Bases hands over — numbers, dates, lists — and a text column
 * that holds only numbers (`"7,5"`) is read as numbers.
 */
import { TFile, type App } from 'obsidian'
import { queryBase } from './baseProbe'
import { coerce, inferType, type Column, type Row, type Table } from '../table'

export interface BaseSource {
  kind: 'base'
  /** The `.base` file's path. */
  path: string
  /** Which view; the first when left out. */
  view?: string
}

export interface BaseDeps {
  app: App
  inScope: (path: string) => boolean
  /** The view id the probe borrows (the plugin's chart view). */
  probeType: string
}

interface ValueLike {
  constructor: { type?: string }
  toString(): string
  length?: () => number
  get?: (i: number) => ValueLike
}

/** A Bases value as a plain one: number, boolean, list of strings, a `YYYY-MM-DD…` string, or null. */
export function plainValue(v: unknown): unknown {
  if (v === null || v === undefined) return null
  const val = v as ValueLike
  const type = String(val.constructor?.type ?? '').toLowerCase()
  if (type === 'null') return null
  const text = val.toString()
  switch (type) {
    case 'number': {
      const n = Number(text)
      return Number.isFinite(n) ? n : null
    }
    case 'boolean':
      return text === 'true'
    case 'list': {
      const out: string[] = []
      const n = typeof val.length === 'function' ? val.length() : 0
      for (let i = 0; i < n; i++) out.push(String(val.get(i)?.toString() ?? ''))
      return out
    }
    default:
      return text === '' ? null : text
  }
}

/** `note.weight` → `weight`; file and formula properties keep their prefix. */
export const columnName = (id: string) => (id.startsWith('note.') ? id.slice(5) : id)

export async function readBase(spec: BaseSource, deps: BaseDeps): Promise<Table> {
  const file = deps.app.vault.getAbstractFileByPath(spec.path)
  if (!(file instanceof TFile) || file.extension !== 'base') {
    throw new Error(`No base at ${spec.path} — give the path of a .base file.`)
  }
  if (!deps.inScope(file.path)) throw new Error(`${file.path} is outside this chat's scope.`)

  const result = await queryBase(file, spec.view, deps.probeType)
  const meta: Record<string, unknown> = { source: 'base', base: file.path }
  if (spec.view) meta.view = spec.view

  let outOfScope = 0
  const ids = result.order.filter((id) => id !== 'file.path')
  const records: { path: string; values: unknown[] }[] = []
  for (const entry of result.entries) {
    if (!deps.inScope(entry.file.path)) {
      outOfScope++
      continue
    }
    records.push({ path: entry.file.path, values: ids.map((id) => plainValue(entry.getValue(id))) })
  }

  const columns: Column[] = [{ name: 'path', type: 'string' }]
  const typed = ids.map((id, i) => ({
    name: columnName(id),
    type: inferType(records.map((r) => r.values[i])),
  }))
  columns.push(...typed)

  const unparsed: Record<string, number> = {}
  const rows: Row[] = records.map((r) => {
    const row: Row = { path: r.path }
    typed.forEach((c, i) => {
      const cell = coerce(r.values[i], c.type)
      if (cell === null && r.values[i] !== null) unparsed[c.name] = (unparsed[c.name] ?? 0) + 1
      row[c.name] = cell
    })
    return row
  })
  if (outOfScope) meta.outOfScope = outOfScope
  if (Object.keys(unparsed).length) meta.unparsed = unparsed
  return { columns, rows, meta }
}
