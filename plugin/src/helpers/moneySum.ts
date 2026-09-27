/**
 * Adding money up the way the notes write it. Amounts are floats (`amount: 0.1`), and adding
 * floats leaves residue — 0.1 + 0.2 is 0.30000000000000004, and a balance built from a thousand
 * transactions ends a hair off the decimal it means. Each addition here is made in whole units
 * of the smallest decimal either side has (cents for ordinary money, more for crypto) and turned
 * back into the double nearest that decimal, so a running total never drifts. The analytics
 * tools count in the same units (`analytics/money.ts`), so what an agent computes and what the
 * app shows agree exactly.
 */
import { decimalsOf, MAX_SCALE } from '@/analytics/money'

export function addMoney(a: number, b: number): number {
  const scale = Math.min(Math.max(decimalsOf(a), decimalsOf(b)), MAX_SCALE)
  if (scale === 0) return a + b
  const f = 10 ** scale
  const units = Math.round(a * f) + Math.round(b * f)
  // Too large to count in small units exactly: plain addition is then the better answer.
  if (!Number.isSafeInteger(units)) return a + b
  return units / f + 0
}

export function sumMoney(values: Iterable<number>): number {
  let total = 0
  for (const v of values) total = addMoney(total, v)
  return total
}
