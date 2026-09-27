/**
 * Descriptive statistics over a list of numbers, with what is missing counted rather than
 * guessed at. The sample variance divides by n − 1; percentiles interpolate linearly between the
 * two nearest ranks (numpy's default, Excel's `PERCENTILE.INC`).
 */

export type Maybe = number | null | undefined

/** The finite numbers in `values`, in order. */
export function present(values: readonly Maybe[]): number[] {
  const out: number[] = []
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
  return out
}

export function sum(values: readonly number[]): number {
  let s = 0
  for (const v of values) s += v
  return s
}

export function mean(values: readonly number[]): number | null {
  return values.length ? sum(values) / values.length : null
}

/** Sample variance (n − 1); null for fewer than two values. */
export function variance(values: readonly number[]): number | null {
  const n = values.length
  if (n < 2) return null
  const m = sum(values) / n
  let ss = 0
  for (const v of values) ss += (v - m) ** 2
  return ss / (n - 1)
}

export function stdev(values: readonly number[]): number | null {
  const v = variance(values)
  return v === null ? null : Math.sqrt(v)
}

/** The `p`th percentile (0–100) of values already sorted ascending. */
export function percentile(sorted: readonly number[], p: number): number | null {
  const n = sorted.length
  if (!n) return null
  const h = ((n - 1) * Math.min(Math.max(p, 0), 100)) / 100
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}

export function median(values: readonly number[]): number | null {
  return percentile(
    [...values].sort((a, b) => a - b),
    50
  )
}

export interface Summary {
  count: number
  missing: number
  sum: number | null
  mean: number | null
  median: number | null
  stdev: number | null
  variance: number | null
  min: number | null
  max: number | null
  p10: number | null
  p25: number | null
  p75: number | null
  p90: number | null
}

export function describe(values: readonly Maybe[]): Summary {
  const xs = present(values)
  const sorted = [...xs].sort((a, b) => a - b)
  const n = xs.length
  return {
    count: n,
    missing: values.length - n,
    sum: n ? sum(xs) : null,
    mean: mean(xs),
    median: percentile(sorted, 50),
    stdev: stdev(xs),
    variance: variance(xs),
    min: n ? sorted[0] : null,
    max: n ? sorted[n - 1] : null,
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
  }
}
