import { describe, expect, it } from 'vitest'
import { convert, sumConverted, tableStatus, type RateTable } from '@/finance/rates/convert'
import { convertedCard } from '@/helpers/financeTotals'
import { accountRows, groupAccountRows, DEFAULT_ACCOUNTS_LIST } from '@/helpers/accountRows'
import { Account, type AccountType } from '@/entities/Account'

const table: RateTable = {
  base: 'USD',
  fetchedAt: '2026-10-14T08:00:00Z',
  fetchedOn: '2026-10-14',
  rates: {
    EUR: { perUsd: 0.5, date: '2026-10-14', source: 'sample' },
    GEL: { perUsd: 2, date: '2026-10-13', source: 'sample' },
  },
}

describe('converting at today’s rates', () => {
  it('goes through the dollar both ways, and says null where a currency has no rate', () => {
    expect(convert(10, 'EUR', 'USD', table)).toBe(20)
    expect(convert(10, 'usd', 'GEL', table)).toBe(20)
    expect(convert(10, 'EUR', 'GEL', table)).toBe(40)
    expect(convert(10, 'PTS', 'USD', table)).toBeNull()
    expect(convert(10, 'EUR', 'USD', null)).toBeNull()
    expect(convert(10, 'USD', 'USD', null)).toBe(10)
  })

  it('adds several currencies up, naming what it left out and the oldest rate it used', () => {
    expect(
      sumConverted(
        [
          { amount: 10, currency: 'EUR' },
          { amount: 4, currency: 'GEL' },
          { amount: 1, currency: 'USD' },
          { amount: 99, currency: 'PTS' },
        ],
        'USD',
        table
      )
    ).toEqual({ total: 23, missing: ['PTS'], oldest: '2026-10-13', currencies: ['EUR', 'GEL', 'USD'] })
  })

  it('calls a table older than four days stale, and none at all never fetched', () => {
    expect(tableStatus(table, '2026-10-16')).toBe('ok')
    expect(tableStatus(table, '2026-10-20')).toBe('stale')
    expect(tableStatus(null, '2026-10-20')).toBe('never')
  })

  it('makes one card of the cards of each currency', () => {
    const card = convertedCard(
      [
        { currency: 'EUR', assets: 100, debt: 10, owed: 0, net: 90 },
        { currency: 'USD', assets: 50, debt: 0, owed: 5, net: 55 },
        { currency: 'PTS', assets: 7, debt: 0, owed: 0, net: 7 },
      ],
      'USD',
      table
    )
    expect(card).toMatchObject({ assets: 250, debt: 20, owed: 5, net: 235, missing: ['PTS'] })
  })
})

describe('accounts by amount, across currencies', () => {
  const accounts = new Map<string, Account>()
  const balances: Record<string, number> = {}
  const add = (name: string, currency: string, balance: number, type: AccountType = 'asset') => {
    const a = new Account({ wikilink: `[[${name}]]` })
    a.accountType = type
    a.currency = currency
    accounts.set(`${name}.md`, a)
    balances[`${name}.md`] = balance
  }
  add('Euro savings', 'EUR', 60)
  add('Dollar card', 'USD', 100)
  add('Travel card', 'GEL', 300)
  add('Shop points', 'PTS', 5000)
  const source = {
    balance: (path: string) => balances[path] ?? 0,
    currencies: () => [],
    balanceIn: () => 0,
    resolve: () => null,
  }
  const settings = { ...DEFAULT_ACCOUNTS_LIST, types: ['asset' as const] }

  it('orders by what each is worth in dollars, one with no rate last', () => {
    expect(accountRows(accounts, source, settings, table).map((r) => r.name)).toEqual([
      'Travel card',
      'Euro savings',
      'Dollar card',
      'Shop points',
    ])
  })

  it('keeps every row’s own order without a table', () => {
    expect(accountRows(accounts, source, settings).map((r) => r.name)[0]).toBe('Shop points')
  })

  it('gives a group of several currencies one sum at today’s rates', () => {
    const [group] = groupAccountRows(accountRows(accounts, source, settings, table), true, {
      table,
      display: 'USD',
    })
    expect(group.converted).toEqual({
      amount: 370,
      currency: 'USD',
      currencies: ['EUR', 'GEL', 'USD'],
      missing: ['PTS'],
    })
  })
})
