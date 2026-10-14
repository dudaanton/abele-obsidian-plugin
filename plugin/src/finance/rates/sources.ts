/**
 * Where today's exchange rates come from, and how each answer is read. Both sources are public,
 * need no key, and are asked for the whole table against the dollar, so a request never says
 * which currencies the vault holds. Pure: no network here, only the addresses and the parsing.
 */
import type { RateTable } from './convert'

export type RateRow = RateTable['rates'][string]
export type Rates = Record<string, RateRow>

export const FRANKFURTER = 'Frankfurter'
export const CURRENCY_API = 'currency-api'

/** Official rates of central banks, about 165 currencies, no crypto. */
export const FRANKFURTER_URL = 'https://api.frankfurter.dev/v2/rates?base=USD'

/**
 * The fallback and the filler for codes the first lacks (crypto, rare ones), in the order its
 * author asks clients to try: the day's release on jsDelivr, the same on its Cloudflare mirror,
 * then the latest release on both, which may be a day behind.
 */
export function currencyApiUrls(day: string): string[] {
  const path = 'v1/currencies/usd.min.json'
  return [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/${path}`,
    `https://${day}.currency-api.pages.dev/${path}`,
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/${path}`,
    `https://latest.currency-api.pages.dev/${path}`,
  ]
}

const CODE = /^[A-Z0-9]{2,10}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

const usable = (rate: unknown): rate is number =>
  typeof rate === 'number' && Number.isFinite(rate) && rate > 0

/** `[{date, base, quote, rate}]`: one row per currency, each with the day its rate is for. */
export function parseFrankfurter(json: unknown): Rates {
  const rates: Rates = {}
  if (!Array.isArray(json)) return rates
  for (const row of json as Array<Record<string, unknown>>) {
    if (!row || typeof row !== 'object') continue
    const text = (v: unknown) => (typeof v === 'string' ? v : '')
    if (text(row.base).toUpperCase() !== 'USD') continue
    const code = text(row.quote).toUpperCase()
    const date = text(row.date)
    if (!CODE.test(code) || code === 'USD' || !DAY.test(date) || !usable(row.rate)) continue
    rates[code] = { perUsd: row.rate, date, source: FRANKFURTER }
  }
  return rates
}

/** `{date, usd: {eur: 0.92, btc: 0.000009, …}}`: lowercase codes, one day for the whole table. */
export function parseCurrencyApi(json: unknown): Rates {
  const rates: Rates = {}
  if (!json || typeof json !== 'object') return rates
  const { date, usd } = json as { date?: unknown; usd?: unknown }
  if (typeof date !== 'string' || !DAY.test(date) || !usd || typeof usd !== 'object') return rates
  for (const [key, rate] of Object.entries(usd as Record<string, unknown>)) {
    const code = key.toUpperCase()
    if (!CODE.test(code) || code === 'USD' || !usable(rate)) continue
    rates[code] = { perUsd: rate, date, source: CURRENCY_API }
  }
  return rates
}

/** The first source wins; the second only fills the codes the first has no rate for. */
export function mergeRates(primary: Rates, filler: Rates): Rates {
  return { ...filler, ...primary }
}
