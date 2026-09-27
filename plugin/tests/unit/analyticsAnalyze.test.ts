/**
 * The analysis spec over hand-made tables, and the two agent tools over a small vault: what
 * `by`, `period`, `limit`, `where` and the analyses do to an answer, and what an agent is told
 * when it asks for something the table cannot give.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { analyzeTable, filterRows, tidy } from '@/analytics/analyze'
import type { Table } from '@/analytics/table'
import { createAgentTools } from '@/ai/tools'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { CHART_VIEW_ID } from '@/bases/ChartView'
import { PROBE_VIEW_TYPE } from '@/analytics/sources/baseProbe'
import { useVault } from '../helpers/testEnv'

const none = async (): Promise<Table> => {
  throw new Error('no other source here')
}

/** Spending in cents: one row per month from January to June, 100, 110 … 150, in two shops. */
function spending(): Table {
  const rows = [100, 110, 120, 130, 140, 150].flatMap((v, i) => [
    { date: `2026-0${i + 1}-10`, amount: v * 100, currency: 'EUR', shop: 'A' },
    { date: `2026-0${i + 1}-20`, amount: 1000, currency: 'EUR', shop: i % 2 ? 'B' : 'C' },
  ])
  return {
    columns: [
      { name: 'date', type: 'date' },
      { name: 'amount', type: 'money', scale: 2 },
      { name: 'currency', type: 'string' },
      { name: 'shop', type: 'string' },
    ],
    rows,
    meta: { source: 'test' },
  }
}

describe('analyzeTable', () => {
  it('describes the rows by default', async () => {
    const a = await analyzeTable(spending(), {}, none)
    expect(a.rows).toBe(12)
    expect(a.currency).toBe('EUR')
    // 100 + … + 150 = 750, plus six tens
    expect((a.describe as { sum: number }).sum).toBe(810)
  })

  it('sums per period and fits a trend through them', async () => {
    const a = await analyzeTable(
      spending(),
      { where: [{ column: 'shop', value: 'A' }], period: 'month', analyses: ['trend'] },
      none
    )
    expect((a.series as { value: number }[]).map((p) => p.value)).toEqual([
      100, 110, 120, 130, 140, 150,
    ])
    expect(a.trend).toMatchObject({ slopePerPeriod: 10, r2: 1, direction: 'up', changePct: 50 })
  })

  it('labels a forecast with the periods it is for', async () => {
    const a = await analyzeTable(
      spending(),
      {
        where: [{ column: 'shop', value: 'A' }],
        period: 'month',
        analyses: [{ type: 'forecast', method: 'linear', horizon: 2 }],
        chart: true,
      },
      none
    )
    const f = a.forecast as { points: { period: string; value: number }[]; note: string }
    expect(f.points.map((p) => [p.period, p.value])).toEqual([
      ['2026-07', 160],
      ['2026-08', 170],
    ])
    expect(a.chart).toMatch(/^```abele-chart\n/)
    expect(a.chart).toContain('forecast')
    expect(a.chart).toContain('2026-08')
  })

  it('totals per group with shares, and folds the tail into "other"', async () => {
    const a = await analyzeTable(spending(), { by: 'shop', limit: 2 }, none)
    expect(a.groups).toEqual([
      { group: 'A', count: 6, sum: 750, share: expect.any(Number) },
      { group: 'other (2)', count: 6, sum: 60, share: expect.any(Number) },
    ])
    const shares = (a.groups as { share: number }[]).map((g) => g.share)
    expect(shares[0] + shares[1]).toBeCloseTo(100, 6)
  })

  it('draws group totals as bars', async () => {
    const a = await analyzeTable(spending(), { by: 'shop', chart: true }, none)
    expect(a.chart).toContain('"type":"bar"')
  })

  it('finds the unusual rows and says which they are', async () => {
    const t = spending()
    t.rows.push({ date: '2026-06-25', amount: 99900, currency: 'EUR', shop: 'Z' })
    const a = await analyzeTable(t, { analyses: ['anomalies'] }, none)
    const items = (a.anomalies as { items: { shop: string; value: number }[] }).items
    expect(items).toEqual([expect.objectContaining({ shop: 'Z', value: 999, date: '2026-06-25' })])
  })

  it('says what is wrong with a question', async () => {
    await expect(analyzeTable(spending(), { value: 'shop' }, none)).rejects.toThrow(/is string/)
    await expect(analyzeTable(spending(), { by: 'colour' }, none)).rejects.toThrow(
      /No column "colour"/
    )
    expect(() => filterRows(spending(), [{ column: 'nope', value: 1 }])).toThrow(/Columns: date/)
  })

  it('filters with comparisons and lists', () => {
    const t = spending()
    expect(filterRows(t, [{ column: 'date', op: '>=', value: '2026-06-01' }])).toHaveLength(2)
    expect(filterRows(t, [{ column: 'shop', op: 'in', value: ['B', 'C'] }])).toHaveLength(6)
    expect(filterRows(t, [{ column: 'amount', op: '>', value: 120 }])).toHaveLength(3)
  })

  it('rounds for reading without touching exact totals', () => {
    expect(tidy({ a: 7.6000000000000005, b: 0.000123456, c: 500.3, d: [1 / 3] })).toEqual({
      a: 7.6,
      b: 0.0001235,
      c: 500.3,
      d: [0.3333],
    })
  })
})

describe('the agent tools', () => {
  beforeEach(() => {
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
    ScopeResolver.getInstance().fullVaultAccess.value = true
    useVault([
      {
        path: 'A/Card.md',
        frontmatter: { type: 'account', accountType: 'asset', currency: 'EUR' },
      },
      { path: 'A/Food.md', frontmatter: { type: 'account', accountType: 'expense' } },
      ...[12.1, 7.45, 30].map((amount, i) => ({
        path: `T/${i}.md`,
        frontmatter: {
          type: 'transaction',
          date: `2026-0${i + 1}-01`,
          from: '[[Card]]',
          to: '[[Food]]',
          amount,
          currency: 'EUR',
        },
      })),
    ])
  })

  const tool = (name: string) => createAgentTools().find((t) => t.name === name)!
  const call = async (name: string, params: Record<string, unknown>) =>
    JSON.parse(((await tool(name).execute('1', params)).content[0] as { text: string }).text)

  it('are offered to agents', () => {
    const names = createAgentTools().map((t) => t.name)
    expect(names).toContain('read_data')
    expect(names).toContain('analyze_data')
  })

  it('read_data profiles a source', async () => {
    const r = await call('read_data', { source: { kind: 'finance' }, limit: 1 })
    expect(r.rows).toBe(3)
    expect(r.sample).toEqual([expect.objectContaining({ amount: 12.1, kind: 'expense' })])
    expect(r.more).toBe(2)
    expect(r.columns.find((c: { name: string }) => c.name === 'amount')).toMatchObject({
      type: 'money',
      min: 7.45,
      max: 30,
    })
  })

  it('analyze_data answers with exact totals', async () => {
    const r = await call('analyze_data', {
      source: { kind: 'finance', only: 'expense' },
      period: 'month',
      analyses: ['describe'],
    })
    expect(r.series.map((p: { value: number }) => p.value)).toEqual([12.1, 7.45, 30])
    expect(r.describe.sum).toBe(49.55)
  })

  it('honours the chat scope', async () => {
    ScopeResolver.getInstance().fullVaultAccess.value = false
    const r = await call('read_data', { source: { kind: 'finance' } })
    expect(r.rows).toBe(0)
    expect(r.source.outOfScope).toBe(3)
  })

  it('borrow the chart view id for the base probe', () => {
    expect(PROBE_VIEW_TYPE).toBe(CHART_VIEW_ID)
  })
})
