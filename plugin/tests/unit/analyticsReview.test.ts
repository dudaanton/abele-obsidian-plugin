/**
 * What an independent review of the analytics tools found, one test each: scope held for the
 * whole call and for every account, currencies never mixed by folding, filters in the units the
 * agent reads, correlation over the rows the question is about, forecasts on the real calendar,
 * several balances added up rather than one picked, and exact money left unrounded.
 */
import { describe, it, expect } from 'vitest'
import { readFinance } from '@/analytics/sources/finance'
import { analyzeTable, filterRows, tidy } from '@/analytics/analyze'
import { forecast } from '@/analytics/forecast'
import { sourceDeps } from '@/analytics'
import { ScopeResolver } from '@/ai/ScopeResolver'
import type { Table } from '@/analytics/table'
import { useVault } from '../helpers/testEnv'

const none = async (): Promise<Table> => {
  throw new Error('no other source')
}

describe('scope', () => {
  it('leaves accounts outside the scope out of net worth, opening balances included', () => {
    const app = useVault([
      {
        path: 'Mine/Card.md',
        frontmatter: {
          type: 'account',
          accountType: 'asset',
          currency: 'EUR',
          startingBalance: 100,
          startingBalanceDate: '2026-01-01',
        },
      },
      {
        path: 'Secret/Vault.md',
        frontmatter: {
          type: 'account',
          accountType: 'asset',
          currency: 'EUR',
          startingBalance: 5000,
          startingBalanceDate: '2026-01-01',
        },
      },
    ])
    const t = readFinance(
      { kind: 'finance', measure: 'balance' },
      { app: app as never, inScope: (p) => p.startsWith('Mine/'), today: '2026-01-31' }
    )
    expect(t.rows.map((r) => r.balance)).toEqual([10000, 10000]) // 100.00 in cents, first and last day
    expect(t.meta.accountsOutOfScope).toBe(1)
  })

  it('holds the scope the call started with, whatever chat becomes active meanwhile', () => {
    const mine = new ScopeResolver()
    const other = new ScopeResolver()
    other.fullVaultAccess.value = true
    const deps = sourceDeps({ scope: mine })
    const otherDeps = sourceDeps({ scope: other })
    expect(otherDeps.inScope('Anything.md')).toBe(true)
    expect(deps.inScope('Anything.md')).toBe(false)
  })
})

function shops(): Table {
  const row = (date: string, shop: string, amount: number, currency: string, visits: number) => ({
    date,
    shop,
    amount,
    currency,
    visits,
  })
  return {
    columns: [
      { name: 'date', type: 'date' },
      { name: 'shop', type: 'string' },
      { name: 'amount', type: 'money', scale: 2 },
      { name: 'currency', type: 'string' },
      { name: 'visits', type: 'number' },
    ],
    rows: [
      row('2026-01-01', 'A', 100, 'EUR', 1),
      row('2026-01-02', 'A', 200, 'EUR', 2),
      row('2026-01-03', 'A', 300, 'EUR', 3),
      row('2026-01-04', 'A', 400, 'EUR', 4),
      row('2026-01-05', 'A', 500, 'EUR', 5),
      row('2026-01-01', 'B', 50, 'EUR', 5),
      row('2026-01-02', 'B', 50, 'EUR', 4),
      row('2026-01-03', 'B', 50, 'EUR', 3),
      row('2026-01-04', 'B', 50, 'EUR', 2),
      row('2026-01-05', 'B', 50, 'EUR', 1),
      row('2026-01-01', 'C', 70, 'USD', 0),
      row('2026-01-02', 'D', 30, 'USD', 0),
      row('2026-01-03', 'E', 20, 'EUR', 0),
    ],
    meta: {},
  }
}

describe('grouping', () => {
  it('folds the tail per currency, never adding euros to dollars', async () => {
    const a = await analyzeTable(shops(), { by: 'shop', limit: 3 }, none)
    const groups = a.groups as { group: string; sum: number }[]
    for (const g of groups) expect(g.group).toMatch(/· (EUR|USD)$/)
    const other = groups.filter((g) => g.group.startsWith('other'))
    // the tail: B·EUR 2.50, E·EUR 0.20 / C·USD 0.70, D·USD 0.30 — whichever fall past the limit
    for (const g of other) expect(g.group).not.toMatch(/EUR.*USD|USD.*EUR/)
    const eur = groups.filter((g) => g.group.endsWith('EUR')).reduce((s, g) => s + g.sum, 0)
    const usd = groups.filter((g) => g.group.endsWith('USD')).reduce((s, g) => s + g.sum, 0)
    expect(eur).toBeCloseTo(17.7, 9)
    expect(usd).toBeCloseTo(1, 9)
  })

  it('filters money in the decimals the agent reads, not in cents', () => {
    expect(
      filterRows(shops(), [{ column: 'amount', op: '>', value: 4 }]).map((r) => r.amount)
    ).toEqual([500])
  })

  it('correlates within the rows the question is about', async () => {
    const a = await analyzeTable(
      shops(),
      {
        where: [{ column: 'shop', value: 'A' }],
        period: 'day',
        agg: 'sum',
        analyses: [{ type: 'correlate', with: { value: 'visits' } }],
      },
      none
    )
    // A's amounts and A's visits both rise 1..5; B's visits fall and must not come in
    expect(a.correlate).toMatchObject({ r: 1, n: 5 })
  })
})

describe('forecast over gaps', () => {
  it('keeps each value in its own period', () => {
    // 1, (empty), 5, 7, 9 lies on the line 2x + 1; the next period is 11
    const f = forecast([1, null, 5, 7, 9], { method: 'linear', horizon: 1 })
    expect(f.points[0].value).toBeCloseTo(11, 9)
  })

  it('does so from a series with an empty month', async () => {
    const t: Table = {
      columns: [
        { name: 'date', type: 'date' },
        { name: 'w', type: 'number' },
      ],
      rows: [
        { date: '2026-01-10', w: 1 },
        { date: '2026-03-10', w: 5 },
        { date: '2026-04-10', w: 7 },
        { date: '2026-05-10', w: 9 },
      ],
      meta: {},
    }
    const a = await analyzeTable(
      t,
      { period: 'month', analyses: [{ type: 'forecast', method: 'linear', horizon: 1 }] },
      none
    )
    const f = a.forecast as { points: { period: string; value: number }[] }
    expect(f.points[0]).toMatchObject({ period: '2026-06', value: 11 })
  })
})

describe('several balances', () => {
  it('adds the accounts up per period instead of taking the last one seen', async () => {
    const t: Table = {
      columns: [
        { name: 'date', type: 'date' },
        { name: 'account', type: 'string' },
        { name: 'balance', type: 'money', scale: 2, level: true },
        { name: 'currency', type: 'string' },
      ],
      rows: [
        { date: '2026-01-01', account: 'Card', balance: 10000, currency: 'EUR' },
        { date: '2026-01-01', account: 'Savings', balance: 5000, currency: 'EUR' },
        { date: '2026-01-02', account: 'Card', balance: 12000, currency: 'EUR' },
      ],
      meta: {},
    }
    const a = await analyzeTable(t, { period: 'day', analyses: ['series'] }, none)
    expect((a.series as { value: number }[]).map((p) => p.value)).toEqual([150, 170])
  })
})

describe('rounding for reading', () => {
  it('leaves an exact small amount alone', () => {
    expect(tidy(0.12345678, 8)).toBe(0.12345678)
    expect(tidy(0.07)).toBe(0.07)
    expect(tidy(1 / 3)).toBe(0.3333)
  })
})
