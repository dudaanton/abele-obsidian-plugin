/**
 * Values that stand out. `iqr` (the default) flags anything beyond 1.5 interquartile ranges
 * outside the middle half — robust, since the outliers themselves barely move the quartiles.
 * `zscore` flags anything more than `threshold` sample standard deviations from the mean; with
 * few values one big outlier inflates the deviation enough to hide itself, which is why it is not
 * the default.
 */
import { mean, percentile, present, stdev } from './stats'

export type AnomalyMethod = 'iqr' | 'zscore'

export interface Anomalies {
  method: AnomalyMethod
  threshold: number
  bounds: { low: number; high: number } | null
  /** Positions in the input, the value, and how far out it is (IQRs past the fence, or z). */
  items: { index: number; value: number; score: number }[]
}

export function anomalies(
  values: readonly (number | null | undefined)[],
  opts: { method?: AnomalyMethod; threshold?: number } = {}
): Anomalies {
  const method = opts.method ?? 'iqr'
  const xs = present(values)
  const items: Anomalies['items'] = []

  if (method === 'iqr') {
    const threshold = opts.threshold ?? 1.5
    const sorted = [...xs].sort((a, b) => a - b)
    const q1 = percentile(sorted, 25)
    const q3 = percentile(sorted, 75)
    if (q1 === null || q3 === null || xs.length < 4) {
      return { method, threshold, bounds: null, items }
    }
    const iqr = q3 - q1
    const low = q1 - threshold * iqr
    const high = q3 + threshold * iqr
    values.forEach((v, index) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return
      if (v < low || v > high) {
        const past = v > high ? v - q3 : q1 - v
        items.push({ index, value: v, score: iqr === 0 ? Infinity : past / iqr })
      }
    })
    return { method, threshold, bounds: { low, high }, items }
  }

  const threshold = opts.threshold ?? 3
  const m = mean(xs)
  const sd = stdev(xs)
  if (m === null || sd === null || sd === 0) return { method, threshold, bounds: null, items }
  values.forEach((v, index) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return
    const z = (v - m) / sd
    if (Math.abs(z) > threshold) items.push({ index, value: v, score: z })
  })
  return { method, threshold, bounds: { low: m - threshold * sd, high: m + threshold * sd }, items }
}
