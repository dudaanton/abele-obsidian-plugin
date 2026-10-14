import { addMoney } from '@/helpers/moneySum'

/**
 * Today's exchange rates, one table for every currency against the US dollar, and the arithmetic
 * that puts amounts of different currencies side by side. Every converted figure is approximate:
 * today's rate stands for every past day, and a currency with no rate is left out and named,
 * never guessed. Nothing here changes a balance in its own currency.
 */
export interface RateTable {
  base: 'USD'
  /** The instant of the successful fetch. */
  fetchedAt: string
  /** The local day of that fetch: the table is fetched again on another day. */
  fetchedOn: string
  /** How many units of each currency one US dollar buys, with the day the rate is for. */
  rates: Record<string, { perUsd: number; date: string; source: string }>
}

/** A table older than this many days is said to be stale: weekends and holidays lag a day or three. */
export const STALE_DAYS = 4

export type RateStatus = 'ok' | 'stale' | 'missing' | 'never'

const code = (currency: string | null | undefined) => (currency ?? '').trim().toUpperCase()

const perUsd = (currency: string, table: RateTable | null): number | null => {
  const c = code(currency)
  if (!c) return null
  if (c === 'USD') return 1
  const rate = table?.rates[c]?.perUsd
  return rate && Number.isFinite(rate) && rate > 0 ? rate : null
}

/** An amount in another currency, or null when either has no rate. */
export function convert(
  amount: number,
  from: string,
  to: string,
  table: RateTable | null
): number | null {
  const a = perUsd(from, table)
  const b = perUsd(to, table)
  if (a === null || b === null) return null
  return (amount / a) * b
}

/** What one unit of `from` is worth in `to`, for the words of a tooltip. */
export const unitRate = (from: string, to: string, table: RateTable | null) =>
  convert(1, from, to, table)

/**
 * Amounts of several currencies as one sum in `to`: the total of those with a rate, the codes
 * left out for want of one, and the oldest day among the rates used.
 */
export function sumConverted(
  items: Iterable<{ amount: number; currency: string }>,
  to: string,
  table: RateTable | null
): { total: number; missing: string[]; oldest: string | null; currencies: string[] } {
  let total = 0
  const missing = new Set<string>()
  const used = new Set<string>()
  let oldest: string | null = null
  for (const { amount, currency } of items) {
    const c = code(currency)
    const value = convert(amount, c, to, table)
    if (value === null) {
      missing.add(c)
      continue
    }
    total = addMoney(total, Math.round(value * 100) / 100)
    used.add(c)
    const day = c === 'USD' ? null : (table?.rates[c]?.date ?? null)
    if (day && (!oldest || day < oldest)) oldest = day
  }
  return { total, missing: [...missing].sort(), oldest, currencies: [...used].sort() }
}

/** Whether a converted figure can be shown, and how much it can be trusted. */
export function tableStatus(
  table: RateTable | null,
  today: string
): Exclude<RateStatus, 'missing'> {
  if (!table) return 'never'
  const age = (Date.parse(today) - Date.parse(table.fetchedOn)) / 86_400_000
  return age > STALE_DAYS ? 'stale' : 'ok'
}
