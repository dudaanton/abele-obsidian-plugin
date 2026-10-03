/**
 * The one shape every source hands to the analysis: named, typed columns and rows of plain
 * values. A `money` column holds whole minor units at the column's `scale` (see `money.ts`); the
 * currency of each row is in a `currency` column beside it, or in `column.currency` when the whole
 * column is one currency.
 */
import { localDay } from '@/helpers/calendarDays'
import { isDate } from './resample'

export type ColumnType = 'date' | 'number' | 'money' | 'string' | 'boolean' | 'list'

export interface Column {
  name: string
  type: ColumnType
  /** Money: decimal places the units are counted at. */
  scale?: number
  /** Money: the currency of the whole column, when it is one. */
  currency?: string
  /**
   * A level (a balance, a weight) rather than a flow: over a period it is its last value, not
   * the sum, and an empty period carries the previous one on.
   */
  level?: boolean
}

export type Cell = string | number | boolean | string[] | null

export type Row = Record<string, Cell>

export interface Table {
  columns: Column[]
  rows: Row[]
  /** What was read and what was left out, and why — passed through to the answer. */
  meta: Record<string, unknown>
}

export function column(table: Table, name: string): Column | undefined {
  return table.columns.find((c) => c.name === name)
}

/** A number written in a note: `72.5`, `"72,5"`, `" 1 200 "`. Anything else is null. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/[\s\u00a0]/g, '')
  if (!/^[-+]?(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** A date as `YYYY-MM-DD`, from a date, a datetime or a `Date`; null otherwise. */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return localDay(v.getTime())
  if (typeof v !== 'string') return null
  const head = v.trim().slice(0, 10)
  return isDate(head) ? head : null
}

export function parseBoolean(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === 'yes') return true
    if (s === 'false' || s === 'no') return false
  }
  return null
}

/** Share of values that have to fit a type for the column to be read as that type. */
const MOSTLY = 0.8

/**
 * The type a column of raw values reads as: the most specific one (nearly) every present value
 * fits. Strings that parse as numbers make a number column, and so on.
 */
export function inferType(values: readonly unknown[]): ColumnType {
  const present = values.filter((v) => v !== null && v !== undefined && v !== '')
  if (!present.length) return 'string'
  // Most values fitting is enough: one `weight: heavy` among a year of numbers is a typo to
  // count, not a reason to read the whole column as text.
  const share = (fits: (v: unknown) => boolean) => present.filter(fits).length / present.length
  if (share((v) => Array.isArray(v)) === 1) return 'list'
  if (share((v) => typeof v === 'boolean') === 1) return 'boolean'
  if (share((v) => typeof v !== 'boolean' && parseNumber(v) !== null) >= MOSTLY) return 'number'
  if (share((v) => parseDate(v) !== null) >= MOSTLY) return 'date'
  return 'string'
}

/** A raw value as a cell of `type`; null where it does not fit, which the caller counts. */
export function coerce(v: unknown, type: ColumnType): Cell {
  if (v === null || v === undefined || v === '') return null
  switch (type) {
    case 'number':
      return parseNumber(v)
    case 'date':
      return parseDate(v)
    case 'boolean':
      return parseBoolean(v)
    case 'list':
      return Array.isArray(v) ? v.map((x) => String(x)) : [String(v)]
    case 'money':
      return parseNumber(v)
    default:
      return Array.isArray(v) ? v.map(String).join(', ') : String(v)
  }
}
