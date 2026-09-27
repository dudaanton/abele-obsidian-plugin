/**
 * Money as whole minor units — cents for two decimal places — so that adding it up is integer
 * arithmetic and cannot drift. Amounts are floats in the notes (`amount: 12.34`); each one is
 * turned into units once, on the way in, at a scale wide enough for every amount in the data,
 * and back into a decimal only on the way out. `0.1 + 0.2` is `0.30000000000000004` in floats
 * and 30 units here.
 */

/** Most decimal places a scale is widened to — enough for crypto, still exact in a double. */
export const MAX_SCALE = 8
/** The scale money gets when every amount is whole or has fewer places. */
export const DEFAULT_SCALE = 2

/** How many decimal places `x` is written with. */
export function decimalsOf(x: number): number {
  if (!Number.isFinite(x) || Number.isInteger(x)) return 0
  let s = String(x)
  if (/e/i.test(s)) s = x.toFixed(20).replace(/0+$/, '')
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : Math.min(s.length - dot - 1, 20)
}

/** The scale that holds every amount in `values` exactly: at least 2, at most `MAX_SCALE`. */
export function scaleFor(values: Iterable<number>): number {
  let scale = DEFAULT_SCALE
  for (const v of values) scale = Math.max(scale, Math.min(decimalsOf(v), MAX_SCALE))
  return scale
}

function checkSafe(units: number): number {
  if (!Number.isSafeInteger(units)) {
    throw new Error('An amount is too large to add up exactly.')
  }
  return units
}

/** `x` in minor units at `scale`, rounded to the nearest unit. */
export function toUnits(x: number, scale: number): number {
  return checkSafe(Math.round(x * 10 ** scale))
}

/** Minor units back into a decimal amount; the nearest double to the exact decimal. */
export function fromUnits(units: number, scale: number): number {
  // Dividing an exact integer by a power of ten gives the double closest to the decimal, which
  // prints as that decimal. `+ 0` turns a -0 into 0.
  return units / 10 ** scale + 0
}

/** Adds minor units, refusing a total that could no longer be held exactly. */
export function sumUnits(units: Iterable<number>): number {
  let total = 0
  for (const u of units) total = checkSafe(total + u)
  return total
}

/** Rounds a derived amount (a mean, a slope) to what money is written with, plus two places. */
export function roundMoney(x: number | null, scale: number): number | null {
  if (x === null || !Number.isFinite(x)) return null
  return Number(x.toFixed(Math.min(scale + 2, 12))) + 0
}
