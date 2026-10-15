import { describe, it, expect } from 'vitest'
import { Account, type AccountType } from '@/entities/Account'
import {
  accountRows,
  groupAccountRows,
  normalizeAccountsList,
  DEFAULT_ACCOUNTS_LIST,
  type AccountsListSettings,
  type BalanceSource,
  computedSum,
} from '@/helpers/accountRows'
import type { RateTable } from '@/finance/rates/convert'

interface Spec {
  name: string
  type: AccountType
  currency?: string
  balance?: number
  byCurrency?: Record<string, number>
  excluded?: boolean
  sources?: string[]
}

function world(specs: Spec[]) {
  const accounts = new Map<string, Account>()
  for (const s of specs) {
    const a = new Account({ wikilink: `[[${s.name}]]` })
    a.accountType = s.type
    a.currency = s.currency ?? null
    a.excludeFromTotal = !!s.excluded
    a.sourceAccounts = s.sources ?? []
    accounts.set(`${s.name}.md`, a)
  }
  const spec = (path: string) => specs.find((s) => `${s.name}.md` === path)
  const source: BalanceSource = {
    balance: (path) => spec(path)?.balance ?? 0,
    currencies: (path) => Object.keys(spec(path)?.byCurrency ?? {}),
    balanceIn: (path, cur) => spec(path)?.byCurrency?.[cur] ?? 0,
    resolve: (wikilink) => `${wikilink.replace(/\[\[|\]\]/g, '')}.md`,
  }
  return { accounts, source }
}

const settings = (over: Partial<AccountsListSettings> = {}): AccountsListSettings => ({
  ...DEFAULT_ACCOUNTS_LIST,
  ...over,
})

const names = (rows: { name: string }[]) => rows.map((r) => r.name)

const sample: Spec[] = [
  { name: 'Card', type: 'asset', currency: 'EUR', balance: 120 },
  { name: 'Savings', type: 'asset', currency: 'EUR', balance: 5000 },
  { name: 'Dollars', type: 'asset', currency: 'USD', balance: 0 },
  { name: 'Mortgage', type: 'liability', currency: 'EUR', balance: -9000 },
  { name: 'Lent to Bob', type: 'liability', currency: 'EUR', balance: 300 },
  { name: 'Food', type: 'expense', byCurrency: { EUR: 450, USD: 20 } },
  { name: 'Salary', type: 'revenue', byCurrency: { EUR: -3000 } },
  { name: 'Pension', type: 'asset', currency: 'EUR', balance: 800, excluded: true },
  { name: 'All cash', type: 'computed', currency: 'EUR', sources: ['[[Card]]', '[[Savings]]'] },
]

describe('accountRows', () => {
  it('lists mixed categories by currency as signed net flow and retains their type in settings', () => {
    const { accounts, source } = world([
      { name: 'Sample exchange', type: 'mixed', byCurrency: { EUR: -18, USD: 4 } },
    ])
    const options = normalizeAccountsList({ types: ['mixed'], hideZero: false })
    expect(options.types).toEqual(['mixed'])
    const rows = accountRows(accounts, source, options)
    expect(rows.map((r) => [r.currency, r.balance])).toEqual([
      ['EUR', -18],
      ['USD', 4],
    ])
    expect(groupAccountRows(rows, true)[0].label).toBe('Mixed')
  })
  it('sorts by the size of the balance by default, debts included', () => {
    const { accounts, source } = world(sample)
    expect(names(accountRows(accounts, source, settings()))).toEqual([
      'Mortgage',
      'All cash',
      'Savings',
      'Pension',
      'Lent to Bob',
      'Card',
    ])
  })

  it('sorts by signed balance or by name when asked', () => {
    const { accounts, source } = world(sample)
    expect(names(accountRows(accounts, source, settings({ sort: 'balance' }))).at(-1)).toBe(
      'Mortgage'
    )
    expect(names(accountRows(accounts, source, settings({ sort: 'name' })))[0]).toBe('All cash')
  })

  it('shows empty accounts only when asked', () => {
    const { accounts, source } = world(sample)
    expect(names(accountRows(accounts, source, settings()))).not.toContain('Dollars')
    expect(names(accountRows(accounts, source, settings({ hideZero: false })))).toContain('Dollars')
  })

  it('adds up a computed account from its sources', () => {
    const { accounts, source } = world(sample)
    const row = accountRows(accounts, source, settings()).find((r) => r.name === 'All cash')
    expect(row?.balance).toBe(5120)
  })

  it("converts a computed account's sources in another currency instead of adding them as its own", () => {
    const { accounts, source } = world([
      { name: 'Card', type: 'asset', currency: 'EUR', balance: 120 },
      { name: 'Lari', type: 'asset', currency: 'GEL', balance: 400 },
      { name: 'Both', type: 'computed', currency: 'EUR', sources: ['[[Card]]', '[[Lari]]'] },
    ])
    const table: RateTable = {
      base: 'USD',
      fetchedAt: '2026-03-10T08:00:00Z',
      fetchedOn: '2026-03-10',
      rates: {
        EUR: { perUsd: 0.5, date: '2026-03-10', source: 'sample' },
        GEL: { perUsd: 2, date: '2026-03-10', source: 'sample' },
      },
    }
    const both = (t: RateTable | null) =>
      accountRows(accounts, source, settings({ types: ['computed'] }), t)[0]
    // 400 GEL is 200 USD is 100 EUR at these rates.
    expect(both(table)).toMatchObject({ currency: 'EUR', balance: 220 })
    // Without rates the lari cannot be counted, and is left out rather than taken for euros.
    expect(both(null)).toMatchObject({ currency: 'EUR', balance: 120 })
  })

  it('orders debts in different currencies by what they are worth in dollars, not by their own numbers', () => {
    const { accounts, source } = world([
      { name: 'Euro loan', type: 'liability', currency: 'EUR', balance: -8950 },
      { name: 'Dollar loan', type: 'liability', currency: 'USD', balance: -11098 },
    ])
    // 0.5 EUR to the dollar: 8,950 EUR is 17,900 USD, more than the 11,098 USD loan.
    const table: RateTable = {
      base: 'USD',
      fetchedAt: '2026-03-10T08:00:00Z',
      fetchedOn: '2026-03-10',
      rates: { EUR: { perUsd: 0.5, date: '2026-03-10', source: 'sample' } },
    }
    expect(names(accountRows(accounts, source, settings(), table))).toEqual([
      'Euro loan',
      'Dollar loan',
    ])
    expect(names(accountRows(accounts, source, settings({ sort: 'balance' }), table))).toEqual([
      'Dollar loan',
      'Euro loan',
    ])
    // Without rates their own numbers decide, and the dollars come first.
    expect(names(accountRows(accounts, source, settings()))).toEqual(['Dollar loan', 'Euro loan'])
  })

  it('sums a computed account with no currency of its own in the currency its sources share', () => {
    expect(
      computedSum(
        [
          { amount: 5, currency: 'GEL' },
          { amount: 7, currency: 'GEL' },
        ],
        '',
        null
      )
    ).toEqual({ amount: 12, currency: 'GEL', converted: false, missing: [] })
    expect(
      computedSum(
        [
          { amount: 5, currency: 'GEL' },
          { amount: 7, currency: 'PTS' },
        ],
        'GEL',
        null
      )
    ).toEqual({ amount: 5, currency: 'GEL', converted: false, missing: ['PTS'] })
  })

  it('lists expense and income accounts per currency, as amounts spent and earned', () => {
    const { accounts, source } = world(sample)
    const rows = accountRows(accounts, source, settings({ types: ['expense', 'revenue'] }))
    expect(rows.map((r) => [r.name, r.currency, r.balance])).toEqual([
      ['Salary', 'EUR', 3000],
      ['Food', 'EUR', 450],
      ['Food', 'USD', 20],
    ])
  })

  it('filters by currency and can leave excluded accounts out', () => {
    const { accounts, source } = world(sample)
    const rows = accountRows(
      accounts,
      source,
      settings({ currency: 'EUR', showExcluded: false, types: ['asset'] })
    )
    expect(names(rows)).toEqual(['Savings', 'Card'])
  })
})

describe('groupAccountRows', () => {
  it('groups by type in a fixed order and totals per currency without excluded accounts', () => {
    const { accounts, source } = world(sample)
    const groups = groupAccountRows(accountRows(accounts, source, settings()), true)

    expect(groups.map((g) => g.label)).toEqual(['Assets', 'Debts', 'Computed'])
    expect(groups[0].totals).toEqual([{ currency: 'EUR', amount: 5120 }])
    expect(groups[1].totals).toEqual([{ currency: 'EUR', amount: -8700 }])
  })

  it('keeps one flat list when not grouping', () => {
    const { accounts, source } = world(sample)
    const groups = groupAccountRows(accountRows(accounts, source, settings()), false)
    expect(groups).toHaveLength(1)
    expect(groups[0].rows).toHaveLength(6)
  })
})

describe('normalizeAccountsList', () => {
  it('fills a missing or damaged copy from the defaults', () => {
    expect(normalizeAccountsList(undefined)).toEqual(DEFAULT_ACCOUNTS_LIST)
    expect(
      normalizeAccountsList({
        sort: 'nonsense',
        types: ['revenue', 'bogus', 'asset'],
        currency: ' usd',
      })
    ).toEqual({ ...DEFAULT_ACCOUNTS_LIST, types: ['asset', 'revenue'], currency: 'USD' })
  })
})
