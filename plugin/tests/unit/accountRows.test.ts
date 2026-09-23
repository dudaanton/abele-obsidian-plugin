import { describe, it, expect } from 'vitest'
import { Account, type AccountType } from '@/entities/Account'
import {
  accountRows,
  groupAccountRows,
  normalizeAccountsList,
  DEFAULT_ACCOUNTS_LIST,
  type AccountsListSettings,
  type BalanceSource,
} from '@/helpers/accountRows'

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
