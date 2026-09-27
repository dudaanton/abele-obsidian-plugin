/**
 * The words of an analysis question — filters, the analyses and their options — and picking the
 * rows and columns it names. Shared by `analyze.ts` and the per-group work in `group.ts`.
 */
import type { AnomalyMethod } from './anomalies'
import type { ForecastMethod } from './forecast'
import type { Agg, Fill, Period } from './resample'
import type { Cell, Column, Row, Table } from './table'

export type Op = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'in'
export interface Filter {
  column: string
  op?: Op
  value: Cell | Cell[]
}

export interface CorrelateWith {
  /** Another source; the same table when left out. */
  source?: unknown
  value: string
  where?: Filter[]
  agg?: Agg
  date?: string
}

export type Analysis =
  | { type: 'describe' }
  | { type: 'series' }
  | { type: 'rolling'; window?: number; agg?: 'mean' | 'sum' }
  | { type: 'trend' }
  | { type: 'seasonality'; by?: 'month' | 'weekday' }
  | {
      type: 'forecast'
      method?: ForecastMethod
      horizon?: number
      window?: number
      season?: number
    }
  | { type: 'anomalies'; method?: AnomalyMethod; threshold?: number }
  | {
      type: 'correlate'
      with: CorrelateWith
      method?: 'pearson' | 'spearman'
      detrend?: boolean
    }

export interface AnalyzeSpec {
  where?: Filter[]
  value?: string
  date?: string
  by?: string
  period?: Period
  agg?: Agg
  fill?: Fill
  from?: string
  to?: string
  limit?: number
  analyses?: (Analysis | Analysis['type'])[]
  chart?: boolean
}

/** Reads another source for `correlate`; given by the caller, which knows how to reach the vault. */
export type SourceReader = (source: unknown) => Promise<Table>

// ── rows ──

function test(cell: Cell, op: Op, value: Cell | Cell[]): boolean {
  const lower = (v: unknown) => String(v ?? '').toLowerCase()
  if (op === 'in') return Array.isArray(value) && value.some((v) => test(cell, '=', v))
  if (Array.isArray(cell)) {
    return op === '!='
      ? !cell.some((c) => test(c, '=', value))
      : cell.some((c) => test(c, op, value))
  }
  if (op === 'contains') return lower(cell).includes(lower(value))
  if (op === '=' || op === '!=') {
    const eq =
      typeof cell === 'number' && typeof value === 'number'
        ? cell === value
        : lower(cell) === lower(value)
    return op === '=' ? eq : !eq
  }
  if (cell === null || value === null) return false
  const a = typeof cell === 'number' ? cell : String(cell)
  const b = typeof cell === 'number' ? Number(value) : String(value)
  return op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : a <= b
}

export function filterRows(table: Table, where: Filter[] | undefined): Row[] {
  if (!where?.length) return table.rows
  for (const f of where) {
    if (!table.columns.some((c) => c.name === f.column)) {
      throw new Error(
        `No column "${f.column}". Columns: ${table.columns.map((c) => c.name).join(', ')}.`
      )
    }
  }
  return table.rows.filter((r) => where.every((f) => test(r[f.column], f.op ?? '=', f.value)))
}

export function pickColumn(
  table: Table,
  name: string | undefined,
  types: Column['type'][],
  what: string
): Column {
  if (name) {
    const c = table.columns.find((x) => x.name === name)
    if (!c) {
      throw new Error(
        `No column "${name}". Columns: ${table.columns.map((x) => `${x.name} (${x.type})`).join(', ')}.`
      )
    }
    if (!types.includes(c.type))
      throw new Error(`Column "${name}" is ${c.type}; ${what} has to be ${types.join(' or ')}.`)
    return c
  }
  const preferred =
    what === 'the date'
      ? table.columns.find((c) => c.name === 'date' && c.type === 'date')
      : undefined
  const c = preferred ?? table.columns.find((x) => types.includes(x.type))
  if (!c)
    throw new Error(
      `The table has no ${types.join(' or ')} column for ${what}. Columns: ${table.columns.map((x) => `${x.name} (${x.type})`).join(', ')}.`
    )
  return c
}
