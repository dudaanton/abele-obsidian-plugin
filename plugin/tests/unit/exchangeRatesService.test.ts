import { describe, expect, it } from 'vitest'
import type { HttpRequest, HttpResponse } from '@/calendars/http'
import {
  ExchangeRateService,
  RETRY_MS,
  readCache,
  type RatesStore,
} from '@/finance/rates/ExchangeRateService'
import {
  FRANKFURTER_URL,
  currencyApiUrls,
  mergeRates,
  parseCurrencyApi,
  parseFrankfurter,
} from '@/finance/rates/sources'

// Synthetic answers in the shape each source gives; the numbers are made up.
const frankfurter = [
  { date: '2026-03-10', base: 'USD', quote: 'EUR', rate: 0.5 },
  { date: '2026-03-09', base: 'USD', quote: 'GEL', rate: 2 },
]
const currencyApi = { date: '2026-03-10', usd: { eur: 0.6, btc: 0.00001, gel: 2.1 } }

const ok = (body: unknown): HttpResponse => ({
  status: 200,
  text: JSON.stringify(body),
  headers: {},
})
const down = (): HttpResponse => ({ status: 503, text: '', headers: {} })

interface Rig {
  service: ExchangeRateService
  store: RatesStore
  calls: string[]
  file: { text: string | null }
  clock: { now: Date }
  enabled: { on: boolean }
}

function rig(
  answer: (url: string) => HttpResponse | Promise<HttpResponse>,
  options: { wanted?: string[]; file?: string | null } = {}
): Rig {
  const calls: string[] = []
  const file = { text: options.file ?? null }
  const clock = { now: new Date('2026-03-10T09:00:00') }
  const enabled = { on: true }
  const store: RatesStore = { table: null, lastError: null, source: '', updating: false }
  const service = new ExchangeRateService({
    request: async (request: HttpRequest) => {
      calls.push(request.url)
      return answer(request.url)
    },
    storage: {
      read: async () => file.text,
      write: async (text) => {
        file.text = text
      },
    },
    store,
    enabled: () => enabled.on,
    wanted: options.wanted ? () => options.wanted! : undefined,
    now: () => clock.now,
  })
  return { service, store, calls, file, clock, enabled }
}

describe('reading the sources', () => {
  it('reads Frankfurter rows with their own days and drops what is not a rate', () => {
    const rates = parseFrankfurter([
      ...frankfurter,
      { date: '2026-03-10', base: 'USD', quote: 'XXX', rate: 0 },
      { date: '2026-03-10', base: 'USD', quote: 'YYY', rate: 'n/a' },
      { date: 'yesterday', base: 'USD', quote: 'ZZZ', rate: 1 },
      { date: '2026-03-10', base: 'EUR', quote: 'GBP', rate: 0.8 },
      null,
    ])
    expect(rates).toEqual({
      EUR: { perUsd: 0.5, date: '2026-03-10', source: 'Frankfurter' },
      GEL: { perUsd: 2, date: '2026-03-09', source: 'Frankfurter' },
    })
    expect(parseFrankfurter({ error: 'nope' })).toEqual({})
  })

  it('reads currency-api with its lowercase codes, crypto included', () => {
    const rates = parseCurrencyApi({
      ...currencyApi,
      usd: { ...currencyApi.usd, usd: 1, bad: -3, inf: Infinity },
    })
    expect(Object.keys(rates).sort()).toEqual(['BTC', 'EUR', 'GEL'])
    expect(rates.BTC).toEqual({ perUsd: 0.00001, date: '2026-03-10', source: 'currency-api' })
    expect(parseCurrencyApi({ usd: { eur: 1 } })).toEqual({})
    expect(parseCurrencyApi('garbage')).toEqual({})
  })

  it('keeps the first source and fills only what it lacks from the second', () => {
    const merged = mergeRates(parseFrankfurter(frankfurter), parseCurrencyApi(currencyApi))
    expect(merged.EUR.source).toBe('Frankfurter')
    expect(merged.EUR.perUsd).toBe(0.5)
    expect(merged.BTC.source).toBe('currency-api')
  })

  it('asks currency-api for the day first, on jsDelivr and then its mirror, then the latest', () => {
    expect(currencyApiUrls('2026-03-10')).toEqual([
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2026-03-10/v1/currencies/usd.min.json',
      'https://2026-03-10.currency-api.pages.dev/v1/currencies/usd.min.json',
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
      'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json',
    ])
  })
})

describe('the daily fetch', () => {
  it('fetches once a day and keeps the table in the file', async () => {
    const r = rig((url) => (url === FRANKFURTER_URL ? ok(frankfurter) : ok(currencyApi)), {
      wanted: ['EUR', 'USD'],
    })
    expect(r.service.due()).toBe(true)
    await r.service.refresh()
    // Frankfurter covered every currency held, so the second source was not asked.
    expect(r.calls).toEqual([FRANKFURTER_URL])
    expect(r.store.table?.fetchedOn).toBe('2026-03-10')
    expect(r.store.table?.rates.EUR.perUsd).toBe(0.5)
    expect(r.store.source).toBe('Frankfurter')
    expect(r.service.due()).toBe(false)

    const kept = readCache(JSON.parse(r.file.text!))
    expect(kept?.table?.rates.GEL.date).toBe('2026-03-09')

    r.clock.now = new Date('2026-03-11T00:05:00')
    expect(r.service.due()).toBe(true)
  })

  it('fills a currency the first source lacks from the second', async () => {
    const r = rig((url) => (url === FRANKFURTER_URL ? ok(frankfurter) : ok(currencyApi)), {
      wanted: ['EUR', 'BTC'],
    })
    await r.service.refresh()
    expect(r.calls).toEqual([FRANKFURTER_URL, currencyApiUrls('2026-03-10')[0]])
    expect(r.store.table?.rates.BTC.source).toBe('currency-api')
    expect(r.store.table?.rates.EUR.source).toBe('Frankfurter')
    expect(r.store.source).toBe('Frankfurter, currency-api')
  })

  it('falls back to currency-api, mirror after mirror, when Frankfurter is down', async () => {
    const urls = currencyApiUrls('2026-03-10')
    const r = rig((url) => (url === urls[2] ? ok(currencyApi) : down()))
    await r.service.refresh()
    expect(r.calls).toEqual([FRANKFURTER_URL, urls[0], urls[1], urls[2]])
    expect(r.store.table?.rates.EUR.source).toBe('currency-api')
    expect(r.store.lastError).toBeNull()
  })

  it('keeps the last table when everything fails, and tries again an hour later at most', async () => {
    const previous = {
      table: {
        base: 'USD',
        fetchedAt: '2026-03-01T08:00:00.000Z',
        fetchedOn: '2026-03-01',
        rates: { EUR: { perUsd: 0.4, date: '2026-03-01', source: 'Frankfurter' } },
      },
      lastAttemptAt: null,
      lastError: null,
    }
    const r = rig(() => Promise.reject(new Error('offline')), { file: JSON.stringify(previous) })
    await r.service.load()
    expect(r.store.table?.rates.EUR.perUsd).toBe(0.4)
    expect(r.service.due()).toBe(true)

    await r.service.refresh()
    expect(r.store.table?.rates.EUR.perUsd).toBe(0.4)
    expect(r.store.lastError).toMatch(/Frankfurter: offline/)
    expect(r.service.due()).toBe(false)

    // The failure is in the file too, so a restart does not knock again at once.
    const again = rig(() => down(), { file: r.file.text })
    again.clock.now = r.clock.now
    await again.service.load()
    expect(again.service.due()).toBe(false)

    r.clock.now = new Date(r.clock.now.getTime() + RETRY_MS - 1000)
    expect(r.service.due()).toBe(false)
    r.clock.now = new Date(r.clock.now.getTime() + 2000)
    expect(r.service.due()).toBe(true)
  })

  it('asks nothing while fetching is off', async () => {
    const r = rig(() => ok(frankfurter))
    r.enabled.on = false
    expect(r.service.due()).toBe(false)
    await r.service.refresh()
    expect(r.calls).toEqual([])
  })

  it('runs one fetch at a time', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const r = rig(
      async () => {
        await gate
        return ok(frankfurter)
      },
      { wanted: ['EUR'] }
    )
    const first = r.service.refresh()
    const second = r.service.refresh()
    expect(r.store.updating).toBe(true)
    release()
    await Promise.all([first, second])
    expect(r.calls).toEqual([FRANKFURTER_URL])
    expect(r.store.updating).toBe(false)
  })

  it('starts without a table when the file is unreadable', async () => {
    const r = rig(() => ok(frankfurter), { file: '{not json' })
    await r.service.load()
    expect(r.store.table).toBeNull()
    expect(readCache({ table: { base: 'EUR' } })?.table).toBeNull()
  })
})
