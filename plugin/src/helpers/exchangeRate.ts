/**
 * The exchange rate between the two sides of a transaction in two currencies.
 *
 * A transaction note keeps `amount` in `currency` and `foreignAmount` in `foreignCurrency`;
 * the rate is only their ratio and is never stored. The rate a new one starts from is the one
 * last used between the same pair in the vault. Nothing is fetched: the plugin has no service
 * to ask, and a rate from the owner's own bank statement is the one that matters anyway.
 */
import type dayjs from 'dayjs'
import { DATE_FORMAT } from '@/constants/dates'

const RATE_PRECISION = 1e6

/** What one unit of the first side buys of the second, or `null` without both sides. */
export function rateBetween(amount: number | null, foreignAmount: number | null): number | null {
  if (!amount || !foreignAmount || amount <= 0 || foreignAmount <= 0) return null
  return Math.round((foreignAmount / amount) * RATE_PRECISION) / RATE_PRECISION
}

/** An amount at a rate, to the cent. */
export function applyRate(amount: number | null, rate: number | null): number | null {
  if (amount == null || rate == null || !Number.isFinite(amount * rate)) return null
  return Math.round(amount * rate * 100) / 100
}

export interface RatedTransaction {
  date: dayjs.Dayjs | null
  currency: string | null
  amount: number | null
  foreignCurrency: string | null
  foreignAmount: number | null
}

/**
 * The rate last used from `base` to `quote`, and the day it was used. A transaction written the
 * other way round — dollars into euros — counts too, as the inverse.
 */
export function lastUsedRate(
  transactions: Iterable<RatedTransaction>,
  base: string,
  quote: string
): { rate: number; date: string } | null {
  let best: { rate: number; date: string } | null = null
  for (const t of transactions) {
    if (!t.date || !t.currency || !t.foreignCurrency) continue
    let rate: number | null = null
    if (t.currency === base && t.foreignCurrency === quote) {
      rate = rateBetween(t.amount, t.foreignAmount)
    } else if (t.currency === quote && t.foreignCurrency === base) {
      rate = rateBetween(t.foreignAmount, t.amount)
    }
    if (rate === null) continue
    const date = t.date.format(DATE_FORMAT)
    if (!best || date > best.date) best = { rate, date }
  }
  return best
}
