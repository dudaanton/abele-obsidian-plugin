/**
 * Putting dated values into periods — days, weeks, months, quarters, years — with every period
 * in the range present, including the empty ones, and a rule for what an empty one holds.
 *
 * Dates are `YYYY-MM-DD` strings and all arithmetic is on UTC midnights, so no time zone or
 * daylight-saving change can move a value into the neighbouring day.
 */
import { addDays } from '@/helpers/calendarDays'
export { addDays } from '@/helpers/calendarDays'
import { mean, median, present, sum } from './stats'

export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year'
export const PERIODS: Period[] = ['day', 'week', 'month', 'quarter', 'year']
export type Agg = 'sum' | 'mean' | 'median' | 'min' | 'max' | 'count' | 'first' | 'last'
export const AGGS: Agg[] = ['sum', 'mean', 'median', 'min', 'max', 'count', 'first', 'last']
/**
 * What an empty period holds: `zero` for flows (nothing was spent), `none` for levels (nobody
 * weighed themselves), `previous` to carry the last level on, `linear` to draw it across.
 */
export type Fill = 'none' | 'zero' | 'previous' | 'linear'
export const FILLS: Fill[] = ['none', 'zero', 'previous', 'linear']

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

export function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export function toUtc(date: string): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))
}

export function fromUtc(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** The key of the period `date` falls in: the day, the first day of its week, `YYYY-MM`, `YYYY-Q3`, `YYYY`. */
export function periodKey(date: string, period: Period, weekStartsOnMonday = true): string {
  switch (period) {
    case 'day':
      return date
    case 'week': {
      const dow = new Date(toUtc(date)).getUTCDay() // 0 = Sunday
      const back = weekStartsOnMonday ? (dow + 6) % 7 : dow
      return addDays(date, -back)
    }
    case 'month':
      return date.slice(0, 7)
    case 'quarter':
      return `${date.slice(0, 4)}-Q${Math.floor((+date.slice(5, 7) - 1) / 3) + 1}`
    case 'year':
      return date.slice(0, 4)
  }
}

/** The first day of the period a key names. */
export function periodStart(key: string, period: Period): string {
  switch (period) {
    case 'day':
    case 'week':
      return key
    case 'month':
      return `${key}-01`
    case 'quarter':
      return `${key.slice(0, 4)}-${pad((+key.slice(6) - 1) * 3 + 1)}-01`
    case 'year':
      return `${key}-01-01`
  }
}

/** The key of the period after `key`. */
export function nextPeriod(key: string, period: Period): string {
  switch (period) {
    case 'day':
      return addDays(key, 1)
    case 'week':
      return addDays(key, 7)
    case 'month': {
      const y = +key.slice(0, 4)
      const m = +key.slice(5, 7)
      return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`
    }
    case 'quarter': {
      const y = +key.slice(0, 4)
      const q = +key.slice(6)
      return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`
    }
    case 'year':
      return String(+key + 1)
  }
}

/** Every period key from `first` to `last`, both included. */
export function periodRange(
  first: string,
  last: string,
  period: Period,
  weekStartsOnMonday = true
): string[] {
  void weekStartsOnMonday // keys already name week starts; kept for symmetry with periodKey
  const out: string[] = []
  // A hard stop, so a malformed key cannot loop for ever.
  for (let k = first; k <= last && out.length < 100_000; k = nextPeriod(k, period)) out.push(k)
  return out
}

export function aggregate(values: readonly number[], agg: Agg): number | null {
  if (agg === 'count') return values.length
  if (!values.length) return agg === 'sum' ? 0 : null
  switch (agg) {
    case 'sum':
      return sum(values)
    case 'mean':
      return mean(values)
    case 'median':
      return median(values)
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
    case 'first':
      return values[0]
    case 'last':
      return values[values.length - 1]
  }
}

export interface DatedValue {
  date: string
  value: number | null
}

export interface PeriodValue {
  period: string
  value: number | null
  /** How many values fell in the period; 0 means the value, if any, was filled in. */
  n: number
}

export interface ResampleOptions {
  period: Period
  agg: Agg
  fill: Fill
  from?: string
  to?: string
  weekStartsOnMonday?: boolean
  /**
   * Adds values up as given instead of with float `sum` — the analytics money path passes
   * integer units and an exact adder here.
   */
  add?: (values: number[]) => number
}

/** Dated values into periods, oldest first, every period in the range present. */
export function resample(points: readonly DatedValue[], opts: ResampleOptions): PeriodValue[] {
  const monday = opts.weekStartsOnMonday !== false
  const sorted = points
    .filter((p) => isDate(p.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const buckets = new Map<string, number[]>()
  for (const p of sorted) {
    if (opts.from && p.date < opts.from) continue
    if (opts.to && p.date > opts.to) continue
    const key = periodKey(p.date, opts.period, monday)
    let b = buckets.get(key)
    if (!b) buckets.set(key, (b = []))
    if (typeof p.value === 'number' && Number.isFinite(p.value)) b.push(p.value)
  }
  const keys = [...buckets.keys()]
  const first = opts.from ? periodKey(opts.from, opts.period, monday) : keys[0]
  const last = opts.to ? periodKey(opts.to, opts.period, monday) : keys[keys.length - 1]
  if (!first || !last) return []

  const out: PeriodValue[] = periodRange(first, last, opts.period).map((period) => {
    const values = buckets.get(period) ?? []
    if (!values.length) return { period, value: null, n: 0 }
    const value = opts.agg === 'sum' && opts.add ? opts.add(values) : aggregate(values, opts.agg)
    return { period, value, n: values.length }
  })
  return fillGaps(out, opts.agg === 'count' ? 'zero' : opts.fill)
}

/** Fills the periods with no values (`n === 0`) the way `fill` says. */
export function fillGaps(series: PeriodValue[], fill: Fill): PeriodValue[] {
  if (fill === 'none') return series
  if (fill === 'zero') return series.map((p) => (p.n === 0 ? { ...p, value: 0 } : p))
  const out = series.map((p) => ({ ...p }))
  if (fill === 'previous') {
    let prev: number | null = null
    for (const p of out) {
      if (p.n === 0) p.value = prev
      else prev = p.value
    }
    return out
  }
  // linear: between the nearest filled neighbours; the ends stay empty
  for (let i = 0; i < out.length; i++) {
    if (out[i].n !== 0) continue
    let a = i - 1
    while (a >= 0 && out[a].n === 0) a--
    let b = i + 1
    while (b < out.length && out[b].n === 0) b++
    const va = a >= 0 ? out[a].value : null
    const vb = b < out.length ? out[b].value : null
    if (va === null || vb === null) continue
    out[i].value = va + ((vb - va) * (i - a)) / (b - a)
  }
  return out
}

/**
 * A rolling mean (or sum) over `window` places. A place whose window is not yet full, or holds a
 * gap, is null: an average of fewer values than asked for would look like the same thing.
 */
export function rolling(
  values: readonly (number | null)[],
  window: number,
  agg: 'mean' | 'sum' = 'mean'
): (number | null)[] {
  const w = Math.max(1, Math.floor(window))
  return values.map((_, i) => {
    if (i < w - 1) return null
    const slice = values.slice(i - w + 1, i + 1)
    const xs = present(slice)
    if (xs.length < w) return null
    const s = sum(xs)
    return agg === 'sum' ? s : s / w
  })
}
