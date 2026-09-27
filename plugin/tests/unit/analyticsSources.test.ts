/**
 * The analytics sources over a small vault whose every number is worked out by hand here: a
 * euro card that starts with 100 on 2026-01-01, a dollar wallet, a salary, food and rent.
 *
 *   2025-12-20  Salary → Card      50 EUR   (before the card's start: a transaction, not a balance)
 *   2026-01-05  Salary → Card    1000 EUR   income
 *   2026-01-10  Card → Food       0.1 EUR   groceries
 *   2026-01-11  Card → Food       0.2 EUR   groceries
 *   2026-02-01  Card → Rent       500 EUR
 *   2026-02-15  Card → Dollars    110 EUR = 120 USD   (the only rate in the vault)
 *   2026-03-03  Dollars → Food     12 USD
 */
import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import { readFinance, type FinanceSource } from '@/analytics/sources/finance'
import { readNotes } from '@/analytics/sources/notes'
import { analyzeTable } from '@/analytics/analyze'
import { fromUnits } from '@/analytics/money'
import { AccountsList } from '@/entities/AccountsList'
import { TransactionsList } from '@/entities/TransactionsList'
import { BalanceIndex } from '@/entities/BalanceIndex'
import type { Table } from '@/analytics/table'
import type { FakeFileSpec } from '../helpers/fakeVault'
import { useVault } from '../helpers/testEnv'

const account = (name: string, fm: Record<string, unknown>): FakeFileSpec => ({
  path: `Accounts/${name}.md`,
  frontmatter: { type: 'account', ...fm },
})
let n = 0
const tx = (fm: Record<string, unknown>): FakeFileSpec => ({
  path: `Transactions/tx ${++n}.md`,
  frontmatter: { type: 'transaction', ...fm },
})

const FILES: FakeFileSpec[] = [
  account('Card', {
    accountType: 'asset',
    currency: 'EUR',
    startingBalance: 100,
    startingBalanceDate: '2026-01-01',
  }),
  account('Dollars', { accountType: 'asset', currency: 'USD' }),
  account('Salary', { accountType: 'revenue' }),
  account('Food', { accountType: 'expense' }),
  account('Rent', { accountType: 'expense' }),
  { path: 'Categories/Groceries.md', frontmatter: { type: 'finance-category' } },
  { path: 'Trips/Lisbon.md', frontmatter: {} },
  tx({ date: '2025-12-20', from: '[[Salary]]', to: '[[Card]]', amount: 50, currency: 'EUR' }),
  tx({ date: '2026-01-05', from: '[[Salary]]', to: '[[Card]]', amount: 1000, currency: 'EUR' }),
  tx({
    date: '2026-01-10',
    from: '[[Card]]',
    to: '[[Food]]',
    amount: 0.1,
    currency: 'EUR',
    category: '[[Groceries]]',
    groups: ['[[Lisbon]]'],
  }),
  tx({
    date: '2026-01-11',
    from: '[[Card]]',
    to: '[[Food]]',
    amount: 0.2,
    currency: 'EUR',
    category: '[[Groceries]]',
  }),
  tx({ date: '2026-02-01', from: '[[Card]]', to: '[[Rent]]', amount: 500, currency: 'EUR' }),
  tx({
    date: '2026-02-15',
    from: '[[Card]]',
    to: '[[Dollars]]',
    amount: 110,
    currency: 'EUR',
    foreignAmount: 120,
    foreignCurrency: 'USD',
  }),
  tx({ date: '2026-03-03', from: '[[Dollars]]', to: '[[Food]]', amount: 12, currency: 'USD' }),
]

const everywhere = () => true
function finance(spec: Omit<FinanceSource, 'kind'>, inScope: (p: string) => boolean = everywhere) {
  const app = useVault(FILES)
  return readFinance(
    { kind: 'finance', ...spec },
    { app: app as never, inScope, today: '2026-03-31' }
  )
}
const noOther = async (): Promise<Table> => {
  throw new Error('not used')
}
const money = (t: Table, column: string) => {
  const c = t.columns.find((x) => x.name === column)!
  return t.rows.map((r) => fromUnits(r[column] as number, c.scale!))
}

describe('finance: transactions', () => {
  it('classifies each one as the sidebar does', () => {
    const t = finance({})
    expect(t.rows).toHaveLength(7)
    expect(t.rows.map((r) => r.kind)).toEqual([
      'income',
      'income',
      'expense',
      'expense',
      'expense',
      'transfer',
      'expense',
    ])
    expect(t.rows[2]).toMatchObject({
      from: 'Card',
      to: 'Food',
      category: 'Groceries',
      groups: ['Lisbon'],
    })
  })

  it('adds up money exactly', async () => {
    const t = finance({ categories: ['Groceries'] })
    const a = await analyzeTable(t, {}, noOther)
    // 0.1 + 0.2 in floats is 0.30000000000000004
    expect((a.describe as { sum: number }).sum).toBe(0.3)
  })

  it('keeps currencies apart, and converts with the rate the vault implies', async () => {
    const split = await analyzeTable(finance({ only: 'expense' }), { by: 'currency' }, noOther)
    expect(split.groups).toEqual([
      { group: 'EUR', count: 3, sum: 500.3 },
      { group: 'USD', count: 1, sum: 12 },
    ])
    const plain = await analyzeTable(finance({ only: 'expense' }), {}, noOther)
    expect(plain.warnings).toEqual([expect.stringMatching(/2 currencies/)])

    const eur = finance({ only: 'expense', currency: 'EUR' })
    // 12 USD at 110/120 EUR per dollar, the rate of 2026-02-15, is 11 EUR
    expect(money(eur, 'amount')).toEqual([0.1, 0.2, 500, 11])
    expect(eur.meta.ratesUsed).toEqual([{ pair: 'USD→EUR', rate: 0.916667, asOf: '2026-02-15' }])
  })

  it('counts what it cannot convert instead of dropping it silently', () => {
    const t = finance({ only: 'expense', currency: 'GBP' })
    expect(t.rows).toHaveLength(0)
    expect(t.meta.unconverted).toEqual({ EUR: 3, USD: 1 })
    expect(t.meta.warning).toMatch(/could not be converted/)
  })

  it('filters by date, account and linked note, and leaves out what is out of scope', () => {
    expect(finance({ from: '2026-01-01', to: '2026-01-31' }).rows).toHaveLength(3)
    expect(finance({ accounts: ['Dollars'] }).rows).toHaveLength(2)
    expect(finance({ linkedTo: 'Lisbon' }).rows).toHaveLength(1)
    const scoped = finance({}, (p) => p !== 'Transactions/tx 5.md')
    expect(scoped.rows).toHaveLength(6)
    expect(scoped.meta.outOfScope).toBe(1)
  })

  it('names an account it does not know', () => {
    expect(() => finance({ accounts: ['Nowhere'] })).toThrow(/No account called "Nowhere"/)
  })
})

describe('finance: flow', () => {
  it('signs money in and out of an account', () => {
    const t = finance({ measure: 'flow', accounts: ['Card'] })
    expect(money(t, 'amount')).toEqual([50, 1000, -0.1, -0.2, -500, -110])
  })

  it('sees a cross-currency transfer in each wallet own currency', () => {
    const t = finance({ measure: 'flow', accounts: ['Card', 'Dollars'], only: 'transfer' })
    expect(t.rows.map((r) => [r.account, r.currency])).toEqual([
      ['Card', 'EUR'],
      ['Dollars', 'USD'],
    ])
    expect(money(t, 'amount')).toEqual([-110, 120])
  })

  it('needs accounts', () => {
    expect(() => finance({ measure: 'flow' })).toThrow(/needs `accounts`/)
  })
})

describe('finance: balance', () => {
  it('starts at the starting balance and moves with every transaction after it', () => {
    const t = finance({ measure: 'balance', accounts: ['Card'] })
    expect(t.rows.map((r) => r.date)).toEqual([
      '2026-01-01',
      '2026-01-05',
      '2026-01-10',
      '2026-01-11',
      '2026-02-01',
      '2026-02-15',
      '2026-03-31',
    ])
    expect(money(t, 'balance')).toEqual([100, 1100, 1099.9, 1099.7, 599.7, 489.7, 489.7])
  })

  it('agrees with the balance the app shows', () => {
    const app = useVault(FILES)
    const al = new AccountsList()
    const tl = new TransactionsList()
    const bi = new BalanceIndex(tl, al)
    try {
      for (const [name, date] of [
        ['Card', '2026-02-20'],
        ['Dollars', '2026-03-31'],
      ]) {
        const t = readFinance(
          { kind: 'finance', measure: 'balance', accounts: [name], to: date },
          { app: app as never, inScope: everywhere, today: date }
        )
        const last = money(t, 'balance').pop()!
        expect(last).toBeCloseTo(bi.getBalanceAtDate(`Accounts/${name}.md`, dayjs(date)), 9)
      }
    } finally {
      bi.cleanup()
      tl.cleanup()
      al.cleanup()
    }
  })

  it('reads as the balance at the end of every month', async () => {
    const t = finance({ measure: 'balance', accounts: ['Card'] })
    const a = await analyzeTable(t, { period: 'month', analyses: ['series'] }, noOther)
    expect(a.agg).toBe('last')
    expect(a.fill).toBe('previous')
    expect(
      (a.series as { period: string; value: number }[]).map((p) => [p.period, p.value])
    ).toEqual([
      ['2026-01', 1099.7],
      ['2026-02', 489.7],
      ['2026-03', 489.7],
    ])
  })

  it('gives net worth per currency, or in one', () => {
    const t = finance({ measure: 'balance', to: '2026-03-31' })
    const last = (cur: string) =>
      money({ ...t, rows: t.rows.filter((r) => r.currency === cur) }, 'balance').pop()
    expect(last('EUR')).toBe(489.7)
    expect(last('USD')).toBe(108)
    const eur = finance({ measure: 'balance', currency: 'EUR', to: '2026-03-31' })
    // 489.7 + 108 · 110/120 = 489.7 + 99 = 588.7
    expect(money(eur, 'balance').pop()).toBe(588.7)
  })

  it('refuses a balance of a category', () => {
    expect(() => finance({ measure: 'balance', accounts: ['Food'] })).toThrow(/no balance/)
  })
})

describe('notes', () => {
  const NOTES: FakeFileSpec[] = [
    { path: 'Daily/2026-09-01.md', frontmatter: { weight: 80, sleep: '7,5', tags: ['health'] } },
    { path: 'Daily/2026-09-02.md', frontmatter: { weight: 79.5, sleep: 7 } },
    { path: 'Daily/2026-09-03.md', frontmatter: { weight: 79, sleep: 8 } },
    { path: 'Daily/2026-09-04.md', frontmatter: { weight: 78.5, sleep: 6 } },
    { path: 'Daily/2026-09-05.md', frontmatter: { weight: 'heavy', sleep: 9 } },
    { path: 'Other/Note.md', frontmatter: { weight: 1 } },
  ]
  const read = (spec: Record<string, unknown>) =>
    readNotes({ kind: 'notes', ...spec }, { app: useVault(NOTES) as never, inScope: everywhere })

  it('reads daily notes as rows dated by their names, typed by their values', () => {
    const t = read({ folder: 'Daily' })
    expect(t.rows).toHaveLength(5)
    expect(t.columns.find((c) => c.name === 'weight')?.type).toBe('number')
    expect(t.rows.map((r) => r.sleep)).toEqual([7.5, 7, 8, 6, 9])
    expect(t.rows[0].date).toBe('2026-09-01')
    expect(t.meta.unparsed).toEqual({ weight: 1 })
  })

  it('narrows by date and tag', () => {
    expect(read({ folder: 'Daily', from: '2026-09-03' }).rows).toHaveLength(3)
    expect(read({ tag: '#health' }).rows).toHaveLength(1)
  })

  it('analyses a property over days and against another', async () => {
    const t = read({ folder: 'Daily' })
    const a = await analyzeTable(
      t,
      {
        value: 'weight',
        analyses: ['describe', 'trend', { type: 'correlate', with: { value: 'sleep' } }],
      },
      noOther
    )
    // mean of the days that have a weight: (80 + 79.5 + 79 + 78.5) / 4
    expect((a.describe as { mean: number }).mean).toBe(79.25)
    expect((a.trend as { slopePerPeriod: number }).slopePerPeriod).toBeCloseTo(-0.5, 9)
    expect(a.correlate).toMatchObject({ n: 4, method: 'pearson' })
  })
})
