/**
 * The analytics toolkit as the agent tools and scripts use it: read a source into a table, look
 * at what it holds, run an analysis spec on it. Pure arithmetic lives in the modules beside this
 * one; this is where the vault, the chat's scope and the settings come in.
 */
import dayjs from 'dayjs'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { analyzeTable, filterRows, tidy, type AnalyzeSpec, type Filter } from './analyze'
import { fromUnits } from './money'
import { readSource, type SourceDeps } from './sources'
import { PROBE_VIEW_TYPE } from './sources/baseProbe'
import { describe as summarize } from './stats'
import type { Row, Table } from './table'

export type { AnalyzeSpec, Filter }
export type { SourceSpec } from './sources'

/**
 * `skipScope` is for scripts, which reach the whole vault as their other file operations do; an
 * agent's tools see only what the chat's scope reaches.
 */
export interface ReadOptions {
  skipScope?: boolean
}

export function sourceDeps(opts: ReadOptions = {}): SourceDeps {
  return {
    app: GlobalStore.getInstance().app,
    inScope: opts.skipScope ? () => true : (path) => ScopeResolver.getInstance().isInScope(path),
    today: dayjs().format('YYYY-MM-DD'),
    probeType: PROBE_VIEW_TYPE,
  }
}

const weekStartsOnMonday = () => AbeleConfig.getInstance().weekStartsOnMonday !== false

/** A table's rows with money written as decimals, as a person (or an agent) reads them. */
export function plainRows(table: Table, rows: Row[] = table.rows): Row[] {
  const money = table.columns.filter((c) => c.type === 'money')
  if (!money.length) return rows
  return rows.map((r) => {
    const out = { ...r }
    for (const c of money) {
      const v = r[c.name]
      if (typeof v === 'number') out[c.name] = fromUnits(v, c.scale ?? 2)
    }
    return out
  })
}

/** Reads a source; money columns in decimals. */
export async function readTable(
  source: unknown,
  opts: ReadOptions = {}
): Promise<{ columns: Table['columns']; rows: Row[]; meta: Table['meta'] }> {
  const table = await readSource(source, sourceDeps(opts))
  return { columns: table.columns, rows: plainRows(table), meta: table.meta }
}

/**
 * What a source holds: its columns with a short profile of each (range and mean of numbers,
 * span of dates, the commonest values of text), how many rows, and the first `limit` of them.
 */
export async function profileSource(
  source: unknown,
  opts: { where?: Filter[]; limit?: number } & ReadOptions = {}
): Promise<Record<string, unknown>> {
  const table = await readSource(source, sourceDeps(opts))
  const rows = filterRows(table, opts.where)
  const plain = plainRows(table, rows)
  const columns = table.columns.map((c) => {
    const values = plain.map((r) => r[c.name])
    const present = values.filter((v) => v !== null && v !== '' && !(Array.isArray(v) && !v.length))
    const base: Record<string, unknown> = { name: c.name, type: c.type }
    if (c.currency) base.currency = c.currency
    if (c.level) base.level = true
    base.filled = present.length
    if (c.type === 'number' || c.type === 'money') {
      const s = summarize(present as number[])
      Object.assign(base, { min: s.min, max: s.max, mean: s.mean })
    } else if (c.type === 'date') {
      const sorted = (present as string[]).slice().sort()
      Object.assign(base, { first: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null })
    } else if ((c.type === 'string' || c.type === 'list') && c.name !== 'path') {
      const counts = new Map<string, number>()
      for (const v of present) {
        for (const x of Array.isArray(v) ? v : [v])
          counts.set(String(x), (counts.get(String(x)) ?? 0) + 1)
      }
      base.distinct = counts.size
      base.top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([value, n]) => `${value} (${n})`)
    }
    return base
  })
  const limit = Math.max(0, Math.min(opts.limit ?? 20, 500))
  return tidy({
    source: table.meta,
    rows: rows.length,
    columns,
    sample: plain.slice(0, limit),
    ...(rows.length > limit ? { more: rows.length - limit } : {}),
  }) as Record<string, unknown>
}

/** Runs an analysis spec (`source` included) and returns the answer as plain JSON. */
export async function analyzeSource(
  spec: AnalyzeSpec & { source: unknown },
  opts: ReadOptions = {}
): Promise<Record<string, unknown>> {
  const deps = sourceDeps(opts)
  const table = await readSource(spec.source, deps)
  return analyzeTable(table, spec, (other) => readSource(other, deps), weekStartsOnMonday())
}
