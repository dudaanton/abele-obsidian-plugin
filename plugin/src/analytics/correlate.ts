/**
 * How strongly two series move together: Pearson for straight-line relationships, Spearman for
 * any steady one (and for outliers). Always with how many pairs it stands on and a p-value, and a
 * plain-words hint, because an r from six points means little and two series that both only grow
 * look correlated whatever they are.
 */
import { linearFit } from './trend'
import { tTwoSidedP } from './tdist'

type Maybe = number | null | undefined
const ok = (v: Maybe): v is number => typeof v === 'number' && Number.isFinite(v)

function pairs(xs: readonly Maybe[], ys: readonly Maybe[]): [number[], number[]] {
  const a: number[] = []
  const b: number[] = []
  const n = Math.min(xs.length, ys.length)
  for (let i = 0; i < n; i++) {
    if (ok(xs[i]) && ok(ys[i])) {
      a.push(xs[i])
      b.push(ys[i])
    }
  }
  return [a, b]
}

function pearsonOf(a: number[], b: number[]): number | null {
  const n = a.length
  if (n < 2) return null
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb)
    saa += (a[i] - ma) ** 2
    sbb += (b[i] - mb) ** 2
  }
  if (saa === 0 || sbb === 0) return null
  return Math.max(-1, Math.min(1, sab / Math.sqrt(saa * sbb)))
}

/** Ranks from 1, ties sharing the mean of the ranks they span. */
export function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0])
  const out = new Array<number>(values.length)
  for (let i = 0; i < order.length; ) {
    let j = i
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
    const r = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) out[order[k][1]] = r
    i = j + 1
  }
  return out
}

export function pearson(
  xs: readonly Maybe[],
  ys: readonly Maybe[]
): { r: number | null; n: number } {
  const [a, b] = pairs(xs, ys)
  return { r: pearsonOf(a, b), n: a.length }
}

export function spearman(
  xs: readonly Maybe[],
  ys: readonly Maybe[]
): { r: number | null; n: number } {
  const [a, b] = pairs(xs, ys)
  return { r: pearsonOf(ranks(a), ranks(b)), n: a.length }
}

export interface Correlation {
  method: 'pearson' | 'spearman'
  r: number | null
  n: number
  /** Two-sided p-value of r ≠ 0 (t test with n − 2 degrees of freedom). */
  p: number | null
  detrended: boolean
  hint: string
  warning?: string
}

function strength(r: number): string {
  const a = Math.abs(r)
  const word = a >= 0.7 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'no real'
  if (word === 'no real') return 'no real correlation'
  return `${word} ${r > 0 ? 'positive' : 'negative'} correlation`
}

const diff = (xs: readonly Maybe[]): (number | null)[] =>
  xs.slice(1).map((v, i) => (ok(v) && ok(xs[i]) ? v - xs[i] : null))

export function correlation(
  xs: readonly Maybe[],
  ys: readonly Maybe[],
  opts: { method?: 'pearson' | 'spearman'; detrend?: boolean } = {}
): Correlation {
  const method = opts.method ?? 'pearson'
  const detrended = !!opts.detrend
  const x = detrended ? diff(xs) : xs
  const y = detrended ? diff(ys) : ys
  const { r, n } = method === 'spearman' ? spearman(x, y) : pearson(x, y)
  const base = { method, n, detrended }
  if (r === null) {
    return {
      ...base,
      r: null,
      p: null,
      hint:
        n < 3
          ? 'Too few pairs to say anything.'
          : 'One of the series is constant here, so there is nothing to correlate.',
    }
  }
  const df = n - 2
  const p =
    df > 0 ? (Math.abs(r) === 1 ? 0 : tTwoSidedP(r * Math.sqrt(df / (1 - r * r)), df)) : null
  let hint = strength(r)
  if (n < 8) hint += `, but from only ${n} pairs — too few to trust`
  else if (p !== null && p < 0.01) hint += ', very unlikely to be chance (p < 0.01)'
  else if (p !== null && p < 0.05) hint += ', unlikely to be chance (p < 0.05)'
  else hint += ', could well be chance (p ≥ 0.05)'
  hint += '. Correlation is not causation.'

  let warning: string | undefined
  if (!detrended) {
    const tx = linearFit(xs.map((v) => (ok(v) ? v : null)))
    const ty = linearFit(ys.map((v) => (ok(v) ? v : null)))
    if ((tx.r2 ?? 0) >= 0.5 && (ty.r2 ?? 0) >= 0.5) {
      warning =
        'Both series follow a trend over time, which alone makes them look correlated. ' +
        'Ask again with detrend: true to compare their period-to-period changes instead.'
    }
  }
  return { ...base, r, p, hint, ...(warning ? { warning } : {}) }
}
