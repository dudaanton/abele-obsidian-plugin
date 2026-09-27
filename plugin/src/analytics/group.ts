/**
 * Everything asked of one group of rows: its series over periods and each analysis on it.
 */
import { anomalies } from './anomalies'
import type { ChartLine } from './chartSpec'
import { correlation } from './correlate'
import { forecast } from './forecast'
import { fromUnits, sumUnits, toUnits } from './money'
import {
  nextPeriod,
  periodStart,
  resample,
  rolling,
  type Agg,
  type Fill,
  type Period,
  type PeriodValue,
} from './resample'
import { filterRows, pickColumn, type Analysis, type AnalyzeSpec, type SourceReader } from './spec'
import { describe as summarize } from './stats'
import type { Column, Row, Table } from './table'
import { seasonality, trend } from './trend'

const SEASON: Record<Period, number> = { day: 7, week: 52, month: 12, quarter: 4, year: 1 }
const MAX_ROWS_LISTED = 30

// ── series of one group ──

export interface Point {
  date: string | null
  value: number | null
  /** Money in units, for exact totals. */
  units: number | null
  row: Row
}

export interface Ctx {
  spec: AnalyzeSpec
  valueCol: Column
  dateCol: Column | null
  money: boolean
  scale: number
  period: Period | null
  agg: Agg
  fill: Fill
  weekStartsOnMonday: boolean
  /** For a level: the column that tells one account's balance from another's. */
  levelKey?: string
}

function exactSum(ctx: Ctx) {
  return ctx.money
    ? (vs: number[]) => fromUnits(sumUnits(vs.map((v) => toUnits(v, ctx.scale))), ctx.scale)
    : undefined
}

function seriesOf(points: Point[], ctx: Ctx, period: Period): PeriodValue[] {
  // Several balances in one group (net worth by hand, three accounts asked for at once): each
  // account's level per period, carried over its own gaps, then the accounts added up — not
  // whichever account's balance happened to come last.
  if (ctx.valueCol.level && ctx.levelKey) {
    const key = ctx.levelKey
    const byAccount = new Map<string, Point[]>()
    for (const p of points) {
      const k = String(p.row[key] ?? '')
      let list = byAccount.get(k)
      if (!list) byAccount.set(k, (list = []))
      list.push(p)
    }
    if (byAccount.size > 1) {
      // Every account over the same range, so one that stopped changing is still counted.
      const dates = points
        .map((p) => p.date)
        .filter((d): d is string => !!d)
        .sort()
      const range = { from: ctx.spec.from ?? dates[0], to: ctx.spec.to ?? dates[dates.length - 1] }
      const each = [...byAccount.values()].map((pts) => plainSeries(pts, ctx, period, range))
      const periods = [...new Set(each.flatMap((s) => s.map((p) => p.period)))].sort()
      const add = exactSum(ctx) ?? ((vs: number[]) => vs.reduce((a, b) => a + b, 0))
      return periods.map((period) => {
        const found = each.map((s) => s.find((p) => p.period === period)).filter((p) => !!p)
        const values = found.map((p) => p.value).filter((v): v is number => v !== null)
        return {
          period,
          value: values.length ? add(values) : null,
          n: found.reduce((n, p) => n + p.n, 0),
        }
      })
    }
  }
  return plainSeries(points, ctx, period)
}

function plainSeries(
  points: Point[],
  ctx: Ctx,
  period: Period,
  range: { from?: string; to?: string } = ctx.spec
): PeriodValue[] {
  return resample(
    points.filter((p) => p.date).map((p) => ({ date: p.date, value: p.value })),
    {
      period,
      agg: ctx.agg,
      fill: ctx.fill,
      from: range.from,
      to: range.to,
      weekStartsOnMonday: ctx.weekStartsOnMonday,
      add: exactSum(ctx),
    }
  )
}

export function total(points: Point[], ctx: Ctx): number | null {
  const values = points.map((p) => p.value).filter((v): v is number => v !== null)
  if (ctx.agg === 'count') return points.length
  if (ctx.agg === 'sum' && ctx.money) {
    return fromUnits(
      sumUnits(points.map((p) => p.units).filter((u): u is number => u !== null)),
      ctx.scale
    )
  }
  const s = summarize(values)
  switch (ctx.agg) {
    case 'sum':
      return s.sum ?? 0
    case 'mean':
      return s.mean
    case 'median':
      return s.median
    case 'min':
      return s.min
    case 'max':
      return s.max
    case 'first':
      return values[0] ?? null
    case 'last':
      return values[values.length - 1] ?? null
  }
}

export async function analyseGroup(
  points: Point[],
  analyses: Analysis[],
  ctx: Ctx,
  table: Table,
  readOther: SourceReader,
  warnings: Set<string>
): Promise<{ result: Record<string, unknown>; series: PeriodValue[] | null; chart: ChartLine[] }> {
  const result: Record<string, unknown> = {}
  const chart: ChartLine[] = []
  const overTime = analyses.some((a) =>
    ['trend', 'forecast', 'rolling', 'correlate', 'series'].includes(a.type)
  )
  const period = ctx.period ?? (overTime ? (ctx.money ? 'month' : 'day') : null)
  if (period && !ctx.period) ctx.period = period
  const series = period ? seriesOf(points, ctx, period) : null
  const values = series ? series.map((p) => p.value) : points.map((p) => p.value)

  for (const a of analyses) {
    switch (a.type) {
      case 'describe': {
        const s = summarize(values)
        // A money total is added up in units from the rows themselves, so it is exact whether
        // the values described are the rows or the period sums they make.
        if (ctx.money && (!series || ctx.agg === 'sum')) {
          const { from, to } = ctx.spec
          const inRange = (d: string | null) =>
            !series || (!!d && (!from || d >= from) && (!to || d <= to))
          s.sum = fromUnits(
            sumUnits(
              points
                .filter((p) => inRange(p.date))
                .map((p) => p.units)
                .filter((u): u is number => u !== null)
            ),
            ctx.scale
          )
        }
        result.describe = { ...s, over: series ? `${period} ${ctx.agg}s` : 'rows' }
        break
      }
      case 'series':
        break // added below whenever there is a series
      case 'rolling': {
        const w = a.window ?? 3
        const r = rolling(values, w, a.agg ?? 'mean')
        result.rolling = {
          window: w,
          values: series.map((p, i) => ({ period: p.period, value: r[i] })),
        }
        chart.push({
          name: `rolling ${a.agg ?? 'mean'} (${w})`,
          points: new Map(series.map((p, i) => [p.period, r[i]])),
        })
        break
      }
      case 'trend':
        result.trend = trend(series)
        break
      case 'seasonality': {
        const by = a.by ?? (period === 'day' ? 'weekday' : 'month')
        const base = seriesOf(points, ctx, by === 'weekday' ? 'day' : 'month')
        result.seasonality = seasonality(
          base.map((p) => ({
            date: periodStart(p.period, by === 'weekday' ? 'day' : 'month'),
            value: p.value,
          })),
          by
        )
        break
      }
      case 'forecast': {
        const p = period ?? 'month'
        const s = series ?? seriesOf(points, ctx, p)
        const known = s.filter((x) => x.value !== null)
        if (known.length < s.length)
          warnings.add(
            'Some periods are empty; the forecast works around them, each value kept in its own period. Fill them (fill: "zero" or "previous") if empty means zero or unchanged.'
          )
        const method =
          a.method ?? (s.length >= 2 * SEASON[p] && SEASON[p] > 1 ? 'seasonal' : 'linear')
        const f = forecast(
          s.map((x) => x.value),
          {
            method,
            horizon: a.horizon ?? 3,
            window: a.window,
            season: a.season ?? SEASON[p],
          }
        )
        let key = s[s.length - 1]?.period
        const labelled = f.points.map((pt) => {
          key = key ? nextPeriod(key, p) : String(pt.step)
          return { period: key, ...pt }
        })
        result.forecast = { ...f, points: labelled }
        chart.push({ name: 'forecast', points: new Map(labelled.map((x) => [x.period, x.value])) })
        chart.push({ name: 'low 80%', points: new Map(labelled.map((x) => [x.period, x.lo80])) })
        chart.push({ name: 'high 80%', points: new Map(labelled.map((x) => [x.period, x.hi80])) })
        break
      }
      case 'anomalies': {
        const found = anomalies(values, { method: a.method, threshold: a.threshold })
        result.anomalies = {
          ...found,
          items: found.items
            .slice(0, MAX_ROWS_LISTED)
            .map((it) =>
              series
                ? { period: series[it.index].period, value: it.value, score: it.score }
                : { ...pickRow(points[it.index].row), value: it.value, score: it.score }
            ),
          ...(found.items.length > MAX_ROWS_LISTED
            ? { more: found.items.length - MAX_ROWS_LISTED }
            : {}),
        }
        break
      }
      case 'correlate': {
        const w = a.with
        const other = w.source ? await readOther(w.source) : table
        const col = pickColumn(other, w.value, ['number', 'money'], 'the value to correlate with')
        const dcol = pickColumn(other, w.date, ['date'], 'the date')
        const otherMoney = col.type === 'money'
        // Of the same table, the other column is read from the rows this answer is about — the
        // question's filters and this group — not from the whole table.
        const rows = filterRows(other, w.where, w.source ? other.rows : points.map((p) => p.row))
        const pts = rows.map((r) => ({
          date: r[dcol.name] as string | null,
          value:
            typeof r[col.name] === 'number'
              ? otherMoney
                ? fromUnits(r[col.name] as number, col.scale ?? 2)
                : (r[col.name] as number)
              : null,
        }))
        const ys = resample(
          pts.filter((p) => p.date),
          {
            period: period,
            agg: w.agg ?? (otherMoney ? 'sum' : 'mean'),
            fill: (w.agg ?? (otherMoney ? 'sum' : 'mean')) === 'sum' ? 'zero' : 'none',
            from: ctx.spec.from,
            to: ctx.spec.to,
            weekStartsOnMonday: ctx.weekStartsOnMonday,
          }
        )
        const byKey = new Map(ys.map((p) => [p.period, p.value]))
        const x = series.map((p) => p.value)
        const y = series.map((p) => byKey.get(p.period) ?? null)
        result.correlate = {
          with: w.value,
          period,
          ...correlation(x, y, { method: a.method, detrend: a.detrend }),
        }
        break
      }
    }
  }
  return { result, series, chart }
}

/** A row as it is shown beside an anomaly: date, the text columns, the file. */
function pickRow(row: Row): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'amount' || k === 'balance') continue
    if (v !== null && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = v
  }
  return out
}
