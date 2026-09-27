/**
 * One question about one table: which rows, which value, by what and over which periods, and
 * which analyses to run on it. The same spec is what an agent sends to `analyze_data` and what a
 * script passes to `analytics.analyze`; the answer is plain JSON, numbers tidied, money totals
 * exact (`money.ts`), and an `abele-chart` block when asked.
 *
 * Rules that decide the answer, in one place:
 * - Money in several currencies is never added together: the rows are split by currency (as if
 *   `by` included it) unless the source converted them.
 * - `period` turns rows into a series of period totals (or means…), gaps filled by `fill`; every
 *   analysis then works on that series. Without `period` they work on the rows, oldest first —
 *   except those that only make sense over time (trend, forecast, rolling), which pick a period.
 * - `by` splits everything per group; `limit` keeps the largest groups and folds the rest into
 *   one "other".
 */
import { barChart, lineChart, type ChartLine } from './chartSpec'
import { analyseGroup, total, type Ctx, type Point } from './group'
import { decimalsOf, fromUnits } from './money'
import { sumMoney } from '@/helpers/moneySum'
import type { Agg } from './resample'
import { filterRows, pickColumn, type Analysis, type AnalyzeSpec, type SourceReader } from './spec'
import type { Table } from './table'

export { filterRows } from './spec'
export type { Analysis, AnalyzeSpec, CorrelateWith, Filter, Op, SourceReader } from './spec'

const MAX_SERIES = 60

// ── the whole answer ──

export async function analyzeTable(
  table: Table,
  spec: AnalyzeSpec,
  readOther: SourceReader,
  weekStartsOnMonday = true
): Promise<Record<string, unknown>> {
  const analyses: Analysis[] = (spec.analyses?.length ? spec.analyses : ['describe']).map((a) =>
    typeof a === 'string' ? ({ type: a } as Analysis) : a
  )
  const rows = filterRows(table, spec.where)
  const valueCol = pickColumn(table, spec.value, ['number', 'money'], 'the value')
  const dateCol = table.columns.some((c) => c.type === 'date')
    ? pickColumn(table, spec.date, ['date'], 'the date')
    : null
  const money = valueCol.type === 'money'
  const scale = valueCol.scale ?? 2
  const agg: Agg = spec.agg ?? (valueCol.level ? 'last' : money ? 'sum' : 'mean')
  const needsDate =
    spec.period || analyses.some((a) => a.type !== 'describe' && a.type !== 'anomalies')
  if (needsDate && !dateCol)
    throw new Error(
      'The table has no date column, so it has no periods or trends; only describe and anomalies work on it.'
    )

  const ctx: Ctx = {
    spec,
    valueCol,
    dateCol,
    money,
    scale,
    period: spec.period ?? null,
    agg,
    fill:
      spec.fill ??
      (agg === 'sum' || agg === 'count'
        ? 'zero'
        : valueCol.level && agg === 'last'
          ? 'previous'
          : 'none'),
    weekStartsOnMonday,
    levelKey:
      valueCol.level && spec.by !== 'account' && table.columns.some((c) => c.name === 'account')
        ? 'account'
        : undefined,
  }
  const warnings = new Set<string>()

  // Money in more than one currency is kept apart.
  const currencies =
    money && !valueCol.currency && table.columns.some((c) => c.name === 'currency')
      ? [...new Set(rows.map((r) => String(r.currency ?? '')))]
      : []
  // Grouping by currency already keeps them apart.
  const splitCurrency = currencies.length > 1 && spec.by !== 'currency'
  if (splitCurrency)
    warnings.add(
      `The amounts are in ${currencies.length} currencies (${currencies.join(', ')}), so each is counted apart. Give the source a currency to convert them into one.`
    )
  if (spec.by && !table.columns.some((c) => c.name === spec.by)) {
    throw new Error(
      `No column "${spec.by}" to group by. Columns: ${table.columns.map((c) => c.name).join(', ')}.`
    )
  }

  const groups = new Map<string, Point[]>()
  /** The one currency a group's money is in, when the rows hold more than one. */
  const groupCurrency = new Map<string, string>()
  for (const row of rows) {
    const raw = row[valueCol.name]
    const units = money && typeof raw === 'number' ? raw : null
    const value = typeof raw === 'number' ? (money ? fromUnits(raw, scale) : raw) : null
    const date = dateCol ? (row[dateCol.name] as string | null) : null
    const byCell = spec.by ? row[spec.by] : null
    const keys = spec.by
      ? Array.isArray(byCell)
        ? byCell.length
          ? byCell
          : ['(none)']
        : [byCell === null || byCell === '' ? '(none)' : String(byCell)]
      : ['all']
    for (const k of keys) {
      const key = splitCurrency
        ? spec.by
          ? `${k} · ${String(row.currency || '?')}`
          : String(row.currency || '?')
        : String(k)
      let g = groups.get(key)
      if (!g) groups.set(key, (g = []))
      g.push({ date, value, units, row })
      if (currencies.length > 1) groupCurrency.set(key, String(row.currency || '?'))
    }
  }
  const grouped = !!spec.by || splitCurrency

  // Groups, largest first, the tail folded into "other".
  const ranked = [...groups.entries()]
    .map(([key, pts]) => ({ key, pts, total: total(pts, ctx) }))
    .sort((a, b) => Math.abs(b.total ?? 0) - Math.abs(a.total ?? 0))
  const limit = Math.max(1, spec.limit ?? 12)
  let kept = ranked
  if (ranked.length > limit) {
    // The tail is folded per currency: an "other" never adds euros to dollars.
    const rest = ranked.slice(limit - 1)
    const tails = new Map<string, typeof rest>()
    for (const g of rest) {
      const cur = groupCurrency.get(g.key) ?? ''
      let list = tails.get(cur)
      if (!list) tails.set(cur, (list = []))
      list.push(g)
    }
    kept = ranked.slice(0, limit - 1)
    for (const [cur, list] of tails) {
      const pts = list.flatMap((g) => g.pts)
      const key = `other (${list.length})${cur ? ` · ${cur}` : ''}`
      if (cur) groupCurrency.set(key, cur)
      kept.push({ key, pts, total: total(pts, ctx) })
    }
  }

  const out: Record<string, unknown> = {
    source: table.meta,
    rows: rows.length,
    value: valueCol.name,
    ...(money
      ? { currency: valueCol.currency ?? (currencies.length === 1 ? currencies[0] : 'per group') }
      : {}),
    agg,
  }

  if (grouped) {
    const all =
      ctx.agg === 'sum' && currencies.length <= 1 ? sumMoney(kept.map((g) => g.total ?? 0)) : null
    out.groups = kept.map((g) => ({
      group: g.key,
      count: g.pts.length,
      [agg]: g.total,
      ...(all ? { share: g.total !== null ? (g.total / all) * 100 : null } : {}),
    }))
  }

  const results: Record<string, unknown> = {}
  const lines: ChartLine[] = []
  let labels: string[] = []
  for (const g of kept) {
    const { result, series, chart } = await analyseGroup(
      g.pts,
      analyses,
      ctx,
      table,
      readOther,
      warnings
    )
    if (series) {
      const wantSeries = analyses.some((a) => a.type === 'series')
      if (wantSeries || series.length <= MAX_SERIES) result.series = series
      else
        result.series = `${series.length} ${ctx.period}s; ask for the "series" analysis to list them.`
      lines.push({
        name: grouped ? g.key : valueCol.name,
        points: new Map(series.map((p) => [p.period, p.value])),
      })
      labels = union(
        labels,
        series.map((p) => p.period)
      )
      if (!grouped) {
        lines.push(...chart)
        for (const c of chart) labels = union(labels, [...c.points.keys()])
      }
    }
    if (Object.keys(result).length) results[g.key] = result
  }
  if (ctx.period) {
    out.period = ctx.period
    out.fill = ctx.fill
  }
  if (grouped) out.results = results
  else Object.assign(out, results.all ?? {})

  if (spec.chart) {
    const unit = money ? ((out.currency as string | undefined) ?? '') : valueCol.name
    const title = `${valueCol.name}${ctx.period ? ` by ${ctx.period}` : ''}${spec.by ? ` per ${spec.by}` : ''}`
    if (lines.length && labels.length) out.chart = lineChart(title, labels, lines, unit)
    else if (grouped)
      out.chart = barChart(
        title,
        kept.map((g) => ({ label: g.key, value: g.total ?? 0 })),
        unit
      )
  }
  if (warnings.size) out.warnings = [...warnings]
  return tidy(out, money ? Math.max(4, scale) : 4) as Record<string, unknown>
}

function union(a: string[], b: string[]): string[] {
  const set = new Set([...a, ...b])
  return [...set].sort()
}

/** Numbers rounded for reading: `decimals` places for sizeable ones, four significant for small. */
export function tidy(v: unknown, decimals = 4): unknown {
  if (typeof v === 'number') {
    if (!Number.isFinite(v))
      return v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : null
    // Already short — an exact money total, a count, a percentile of whole values — stays as is.
    if (Number.isInteger(v) || decimalsOf(v) <= decimals) return v
    const r = Math.abs(v) >= 1 ? Number(v.toFixed(decimals)) : Number(v.toPrecision(4))
    return r + 0
  }
  if (Array.isArray(v)) return v.map((x) => tidy(x, decimals))
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidy(x, decimals)]))
  }
  return v
}
