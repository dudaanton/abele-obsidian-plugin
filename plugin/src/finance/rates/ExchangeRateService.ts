/**
 * Today's exchange rates, fetched once a day and kept on this device. No Obsidian here: the
 * network, the file and the clock come in from outside, so the same service can serve another
 * client and a test can drive it without a network. What it learns goes into the store the
 * screens read (`exchangeRates`).
 */
import dayjs from 'dayjs'
import type { Requester } from '@/calendars/http'
import type { RateTable } from './convert'
import {
  CURRENCY_API,
  FRANKFURTER,
  FRANKFURTER_URL,
  currencyApiUrls,
  mergeRates,
  parseCurrencyApi,
  parseFrankfurter,
  type Rates,
} from './sources'

/** After a failed fetch the next try waits this long, so a device offline for days stays quiet. */
export const RETRY_MS = 60 * 60 * 1000

const USER_AGENT = 'Abele-Obsidian-Plugin (+https://github.com/dudaanton/abele-obsidian-plugin)'

/** What is kept in the cache file. */
export interface RatesCache {
  table: RateTable | null
  lastAttemptAt: string | null
  lastError: string | null
}

/** The part of the screens' store this service writes. */
export interface RatesStore {
  table: RateTable | null
  lastError: string | null
  source: string
  updating: boolean
}

export interface ExchangeRateDeps {
  request: Requester
  storage: { read(): Promise<string | null>; write(text: string): Promise<void> }
  store: RatesStore
  enabled: () => boolean
  /** The currencies the vault holds: when the first source covers them all, the second is not asked. */
  wanted?: () => string[]
  now?: () => Date
}

export class ExchangeRateService {
  private lastAttemptAt: string | null = null
  private inFlight: Promise<void> | null = null

  constructor(private readonly deps: ExchangeRateDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /** The local day: the table is fetched again once the day changes. */
  private today(): string {
    return dayjs(this.now()).format('YYYY-MM-DD')
  }

  /** Reads the kept table; a missing or unreadable file means none yet. */
  async load(): Promise<void> {
    let cache: RatesCache | null = null
    try {
      const text = await this.deps.storage.read()
      cache = text ? readCache(JSON.parse(text)) : null
    } catch (e) {
      console.debug('[Abele rates] cache unreadable, starting without it', e)
    }
    if (!cache) return
    this.lastAttemptAt = cache.lastAttemptAt
    this.deps.store.table = cache.table
    this.deps.store.lastError = cache.lastError
    this.deps.store.source = sourcesOf(cache.table)
  }

  /** Whether a fetch is wanted now: on, no table of today, and not within an hour of a failure. */
  due(): boolean {
    if (!this.deps.enabled()) return false
    const { table, lastError } = this.deps.store
    if (table && table.fetchedOn === this.today()) return false
    if (lastError && this.lastAttemptAt) {
      const since = this.now().getTime() - Date.parse(this.lastAttemptAt)
      if (since >= 0 && since < RETRY_MS) return false
    }
    return true
  }

  /**
   * Fetches today's table: the first source, then the second for codes it lacks or for
   * everything when it failed. Only a table with rates replaces the kept one; a failure keeps
   * it and says why. One fetch at a time: a second call joins the first.
   */
  refresh(): Promise<void> {
    if (!this.deps.enabled()) return Promise.resolve()
    this.inFlight ??= this.fetch().finally(() => {
      this.inFlight = null
      this.deps.store.updating = false
    })
    return this.inFlight
  }

  private async fetch(): Promise<void> {
    const { store } = this.deps
    store.updating = true
    const now = this.now()
    const errors: string[] = []

    let primary: Rates = {}
    try {
      primary = parseFrankfurter(await this.json(FRANKFURTER_URL))
      if (!Object.keys(primary).length) errors.push(`${FRANKFURTER}: no rates in the answer`)
    } catch (e) {
      errors.push(`${FRANKFURTER}: ${message(e)}`)
    }

    const wanted = this.deps.wanted?.().map((c) => c.toUpperCase()) ?? null
    const lacking = !wanted || wanted.some((c) => c !== 'USD' && !primary[c])
    let filler: Rates = {}
    if (!Object.keys(primary).length || lacking) {
      for (const url of currencyApiUrls(now.toISOString().slice(0, 10))) {
        try {
          filler = parseCurrencyApi(await this.json(url))
          if (Object.keys(filler).length) break
        } catch (e) {
          console.debug('[Abele rates] currency-api mirror failed', url, message(e))
        }
      }
      if (!Object.keys(filler).length) errors.push(`${CURRENCY_API}: did not answer`)
    }

    const rates = mergeRates(primary, filler)
    this.lastAttemptAt = now.toISOString()
    if (Object.keys(rates).length) {
      store.table = {
        base: 'USD',
        fetchedAt: now.toISOString(),
        fetchedOn: dayjs(now).format('YYYY-MM-DD'),
        rates,
      }
      store.lastError = null
      store.source = sourcesOf(store.table)
      console.debug('[Abele rates] fetched', Object.keys(rates).length, 'rates from', store.source)
    } else {
      store.lastError = errors.join('; ') || 'no rates'
      console.debug('[Abele rates] fetch failed, keeping the last table', store.lastError)
    }
    await this.save()
  }

  private async json(url: string): Promise<unknown> {
    const response = await this.deps.request({
      url,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    })
    if (response.status < 200 || response.status >= 300)
      throw new Error(`answered ${response.status}`)
    return JSON.parse(response.text)
  }

  private async save(): Promise<void> {
    const cache: RatesCache = {
      table: this.deps.store.table,
      lastAttemptAt: this.lastAttemptAt,
      lastError: this.deps.store.lastError,
    }
    try {
      await this.deps.storage.write(JSON.stringify(cache))
    } catch (e) {
      console.debug('[Abele rates] could not keep the table', e)
    }
  }
}

/** The sources a table's rates came from, the main one first, for the settings line. */
export function sourcesOf(table: RateTable | null): string {
  const used = new Set(Object.values(table?.rates ?? {}).map((r) => r.source))
  return [FRANKFURTER, CURRENCY_API].filter((s) => used.has(s)).join(', ') || FRANKFURTER
}

const message = (e: unknown) =>
  (e instanceof Error ? e.message : typeof e === 'string' ? e : 'failed').slice(0, 120)

/** A kept file as written by `save`, or null when it is anything else. */
export function readCache(json: unknown): RatesCache | null {
  if (!json || typeof json !== 'object') return null
  const { table, lastAttemptAt, lastError } = json as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    table: readTable(table),
    lastAttemptAt: str(lastAttemptAt),
    lastError: str(lastError),
  }
}

function readTable(json: unknown): RateTable | null {
  if (!json || typeof json !== 'object') return null
  const t = json as Record<string, unknown>
  if (t.base !== 'USD' || typeof t.fetchedAt !== 'string' || typeof t.fetchedOn !== 'string')
    return null
  if (!t.rates || typeof t.rates !== 'object') return null
  const rates: Rates = {}
  for (const [code, row] of Object.entries(t.rates as Record<string, unknown>)) {
    const r = row as Record<string, unknown> | null
    if (!r || typeof r.perUsd !== 'number' || !(r.perUsd > 0) || !Number.isFinite(r.perUsd))
      continue
    rates[code.toUpperCase()] = {
      perUsd: r.perUsd,
      date: typeof r.date === 'string' ? r.date : t.fetchedOn,
      source: typeof r.source === 'string' ? r.source : FRANKFURTER,
    }
  }
  return { base: 'USD', fetchedAt: t.fetchedAt, fetchedOn: t.fetchedOn, rates }
}
