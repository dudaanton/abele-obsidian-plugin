/**
 * Rough forecasts of the next few periods, each with the range it could plausibly land in.
 *
 * Three simple methods, because a personal ledger or a weight log is too short and too noisy for
 * anything cleverer to be more than decoration:
 * - `linear` — the least-squares line carried on, with the textbook prediction interval (t-based,
 *   so a short series gets the wide interval it deserves);
 * - `moving-average` — the mean of the last `window` values, flat; the interval from how far each
 *   value fell from the mean of the ones before it;
 * - `seasonal` — the value one season ago (last January for next January); the interval from how
 *   much a value differs from the one a season before, widening by season.
 * Intervals for the last two use normal quantiles on in-sample errors. All of it is an estimate
 * and says so in `note`.
 */
import { tQuantile, Z80, Z95 } from './tdist'

export type ForecastMethod = 'linear' | 'moving-average' | 'seasonal'
export const FORECAST_METHODS: ForecastMethod[] = ['linear', 'moving-average', 'seasonal']

export interface ForecastPoint {
  /** 1 for the first period after the data. */
  step: number
  value: number
  lo80: number
  hi80: number
  lo95: number
  hi95: number
}

export interface Forecast {
  method: ForecastMethod
  horizon: number
  /** Spread of the in-sample errors the interval is built from. */
  residualStdev: number
  points: ForecastPoint[]
  note: string
}

export interface ForecastOptions {
  method: ForecastMethod
  horizon: number
  /** Moving average: how many last values (default 3). */
  window?: number
  /** Seasonal: the season length in periods (12 for months, 7 for days, 52 for weeks). */
  season?: number
}

const NOTE =
  'A rough estimate from past values only: it assumes the future behaves like the past. ' +
  'The 80% and 95% ranges are where the value would land that often if that holds.'

const rms = (errors: number[]): number =>
  errors.length ? Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length) : 0

/** `values` without gaps, oldest first. */
export function forecast(values: readonly number[], opts: ForecastOptions): Forecast {
  const ys = values.filter((v) => Number.isFinite(v))
  const n = ys.length
  const horizon = Math.max(1, Math.min(Math.floor(opts.horizon), 120))
  const points: ForecastPoint[] = []
  const band = (step: number, value: number, h80: number, h95: number): ForecastPoint => ({
    step,
    value,
    lo80: value - h80,
    hi80: value + h80,
    lo95: value - h95,
    hi95: value + h95,
  })

  if (opts.method === 'linear') {
    if (n < 4) throw new Error(`A linear forecast needs at least 4 values; there are ${n}.`)
    const mx = (n - 1) / 2
    const my = ys.reduce((a, b) => a + b, 0) / n
    let sxx = 0
    let sxy = 0
    for (let i = 0; i < n; i++) {
      sxx += (i - mx) ** 2
      sxy += (i - mx) * (ys[i] - my)
    }
    const slope = sxy / sxx
    const intercept = my - slope * mx
    let sse = 0
    for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * i)) ** 2
    const s = Math.sqrt(sse / (n - 2))
    const t80 = tQuantile(0.9, n - 2)
    const t95 = tQuantile(0.975, n - 2)
    for (let h = 1; h <= horizon; h++) {
      const x0 = n - 1 + h
      const se = s * Math.sqrt(1 + 1 / n + (x0 - mx) ** 2 / sxx)
      points.push(band(h, intercept + slope * x0, t80 * se, t95 * se))
    }
    return { method: 'linear', horizon, residualStdev: s, points, note: NOTE }
  }

  if (opts.method === 'moving-average') {
    const w = Math.max(1, Math.floor(opts.window ?? 3))
    if (n < w + 1) {
      throw new Error(
        `A moving-average forecast over ${w} needs at least ${w + 1} values; there are ${n}.`
      )
    }
    const errors: number[] = []
    for (let i = w; i < n; i++) {
      const m = ys.slice(i - w, i).reduce((a, b) => a + b, 0) / w
      errors.push(ys[i] - m)
    }
    const s = rms(errors)
    const value = ys.slice(n - w).reduce((a, b) => a + b, 0) / w
    for (let h = 1; h <= horizon; h++) points.push(band(h, value, Z80 * s, Z95 * s))
    return { method: 'moving-average', horizon, residualStdev: s, points, note: NOTE }
  }

  const m = Math.max(1, Math.floor(opts.season ?? 12))
  if (n < 2 * m) {
    throw new Error(`A seasonal forecast needs two seasons (${2 * m} values); there are ${n}.`)
  }
  const errors: number[] = []
  for (let i = m; i < n; i++) errors.push(ys[i] - ys[i - m])
  const s = rms(errors)
  for (let h = 1; h <= horizon; h++) {
    const k = Math.floor((h - 1) / m)
    const value = ys[n - m + ((h - 1) % m)]
    const widen = Math.sqrt(k + 1)
    points.push(band(h, value, Z80 * s * widen, Z95 * s * widen))
  }
  return { method: 'seasonal', horizon, residualStdev: s, points, note: NOTE }
}
