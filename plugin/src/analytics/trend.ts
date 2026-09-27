/**
 * Which way a series is going, how fast, and how much of its movement a straight line explains;
 * and how a value differs by month of the year or day of the week.
 */
import { mean } from './stats'
import { isDate, toUtc } from './resample'

export interface LinearFit {
  slope: number | null
  intercept: number | null
  /** Share of the variation the line explains, 0–1; null when the values do not vary. */
  r2: number | null
  n: number
}

/**
 * Ordinary least squares of the values against their position (0, 1, 2…). A gap keeps its
 * place, so a missing month does not pull the months after it one step closer.
 */
export function linearFit(values: readonly (number | null)[]): LinearFit {
  const xs: number[] = []
  const ys: number[] = []
  values.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      xs.push(i)
      ys.push(v)
    }
  })
  const n = xs.length
  if (n < 2) return { slope: null, intercept: null, r2: null, n }
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2
    sxy += (xs[i] - mx) * (ys[i] - my)
    syy += (ys[i] - my) ** 2
  }
  const slope = sxy / sxx
  const intercept = my - slope * mx
  const r2 = syy === 0 ? null : (sxy * sxy) / (sxx * syy)
  return { slope, intercept, r2, n }
}

export interface Trend {
  n: number
  slopePerPeriod: number | null
  r2: number | null
  first: { period: string; value: number } | null
  last: { period: string; value: number } | null
  /** Last against first, in percent; null when the first is zero or missing. */
  changePct: number | null
  /** The last period against the one before it, in percent. */
  lastVsPreviousPct: number | null
  /** `flat` when the line explains little (r² < 0.1) or does not move. */
  direction: 'up' | 'down' | 'flat' | null
  strength: 'strong' | 'moderate' | 'weak' | null
}

const pct = (from: number, to: number): number | null =>
  from === 0 ? null : ((to - from) / Math.abs(from)) * 100

export function trend(series: readonly { period: string; value: number | null }[]): Trend {
  const fit = linearFit(series.map((p) => p.value))
  const filled = series.filter(
    (p): p is { period: string; value: number } =>
      typeof p.value === 'number' && Number.isFinite(p.value)
  )
  const first = filled[0] ?? null
  const last = filled[filled.length - 1] ?? null
  const prev = filled[filled.length - 2] ?? null
  const r2 = fit.r2
  let direction: Trend['direction'] = null
  if (fit.slope !== null) {
    direction =
      fit.slope === 0 || (r2 !== null && r2 < 0.1) ? 'flat' : fit.slope > 0 ? 'up' : 'down'
  }
  return {
    n: fit.n,
    slopePerPeriod: fit.slope,
    r2,
    first: first ? { period: first.period, value: first.value } : null,
    last: last ? { period: last.period, value: last.value } : null,
    changePct: first && last ? pct(first.value, last.value) : null,
    lastVsPreviousPct: prev && last ? pct(prev.value, last.value) : null,
    direction,
    strength: r2 === null ? null : r2 >= 0.6 ? 'strong' : r2 >= 0.3 ? 'moderate' : 'weak',
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export interface Seasonality {
  by: 'month' | 'weekday'
  overallMean: number | null
  /** One per month or weekday that has values, in calendar order. */
  buckets: { bucket: string; mean: number; n: number; index: number | null }[]
}

/**
 * The mean per month of the year (or day of the week), and each against the mean of all values
 * (`index` 1.2 = 20% above usual). Only months with values are listed; `n` says how many years
 * or weeks each mean stands on.
 */
export function seasonality(
  points: readonly { date: string; value: number | null }[],
  by: 'month' | 'weekday'
): Seasonality {
  const groups = new Map<number, number[]>()
  const all: number[] = []
  for (const p of points) {
    if (!isDate(p.date) || typeof p.value !== 'number' || !Number.isFinite(p.value)) continue
    const k =
      by === 'month' ? +p.date.slice(5, 7) - 1 : (new Date(toUtc(p.date)).getUTCDay() + 6) % 7
    let g = groups.get(k)
    if (!g) groups.set(k, (g = []))
    g.push(p.value)
    all.push(p.value)
  }
  const overall = mean(all)
  const names = by === 'month' ? MONTHS : WEEKDAYS
  const buckets = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, vs]) => {
      const m = mean(vs)
      return { bucket: names[k], mean: m, n: vs.length, index: overall ? m / overall : null }
    })
  return { by, overallMean: overall, buckets }
}
