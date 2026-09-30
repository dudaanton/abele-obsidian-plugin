import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { AccountsList } from '@/entities/AccountsList'
import { TransactionsList } from '@/entities/TransactionsList'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import type { FakeFileSpec } from '../helpers/fakeVault'
import { useVault } from '../helpers/testEnv'

const account = (name: string, fm: Record<string, unknown> = {}): FakeFileSpec => ({
  path: `${name}.md`,
  frontmatter: { type: 'account', accountType: 'asset', currency: 'EUR', ...fm },
})
const tx = (name: string, fm: Record<string, unknown> = {}): FakeFileSpec => ({
  path: `${name}.md`,
  frontmatter: {
    type: 'transaction',
    date: '2024-03-01',
    amount: 1,
    to: '[[Cash]]',
    currency: 'EUR',
    ...fm,
  },
})
let al: AccountsList
let tl: TransactionsList
let bi: BalanceIndex
function build(specs: FakeFileSpec[]) {
  const app = useVault(specs)
  al = new AccountsList()
  tl = new TransactionsList()
  bi = new BalanceIndex(tl, al)
  return app
}
const at = dayjs('2024-03-31')
beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Moscow')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2024-03-01T00:15:00+03:00'))
})
afterEach(() => {
  bi?.cleanup()
  tl?.cleanup()
  al?.cleanup()
  VaultWatcherWrapper.destroy()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('BalanceIndex — dates, prefix sums and currencies', () => {
  it('has zero totals and empty currency lists for an empty vault', () => {
    build([])
    expect(bi.version.value).toBe(1)
    expect(bi.getBalanceAtDate('Missing.md', at)).toBe(0)
    expect(bi.getBalanceAtDateByCurrency('Missing.md', at, 'EUR')).toBe(0)
    expect(bi.getCurrenciesForAccount('Missing.md')).toEqual([])
    expect(bi.getNetWorthAtDate(at)).toBe(0)
    expect(bi.getTotalForPeriod({ startDate: at, endDate: at })).toBe(0)
  })

  it('includes the starting day, discards older entries, and sorts an unordered leap-month boundary', () => {
    build([
      account('Cash', { startingBalance: '10.10', startingBalanceDate: '2024-02-29' }),
      tx('z later', { date: '2024-03-02', amount: 0.2 }),
      tx('before', { date: '2024-02-28', amount: 999 }),
      tx('b first', { date: '2024-02-29', amount: 0.2 }),
      tx('a first', { date: '2024-02-29', amount: 0.1 }),
      tx('out', { date: '2024-03-01', from: '[[Cash]]', to: null, amount: 0.4 }),
    ])
    expect(dayjs().format('YYYY-MM-DD')).toBe('2024-03-01')
    expect(new Date().toISOString()).toBe('2024-02-29T21:15:00.000Z')
    expect(bi.getBalanceSeries('Cash.md', dayjs('2024-02-28'), dayjs('2024-03-03'))).toEqual([
      { date: '2024-02-28', balance: 0 },
      { date: '2024-02-29', balance: 10.4 },
      { date: '2024-03-01', balance: 10 },
      { date: '2024-03-02', balance: 10.2 },
      { date: '2024-03-03', balance: 10.2 },
    ])
    expect(bi.getBalanceSeries('Cash.md', at, at)).toEqual([{ date: '2024-03-31', balance: 10.2 }])
    expect(bi.getBalanceSeries('Cash.md', at, at.subtract(1, 'day'))).toEqual([])
  })

  it('returns starting balances before the first transaction, with and without a starting date', () => {
    build([
      account('Cash', { startingBalance: 15 }),
      account('Dated', { startingBalance: -20, startingBalanceDate: '2024-03-01' }),
      tx('later', { date: '2024-03-20' }),
    ])
    expect(bi.getBalanceAtDate('Cash.md', dayjs('2024-02-01'))).toBe(15)
    expect(bi.getBalanceAtDate('Dated.md', dayjs('2024-02-29'))).toBe(0)
    expect(bi.getBalanceAtDate('Dated.md', dayjs('2024-03-01'))).toBe(-20)
  })

  it('keeps expense/revenue currencies separate even if those categories have a currency property', () => {
    build([
      account('Cash'),
      account('Food', { accountType: 'expense', currency: 'USD' }),
      account('Salary', { accountType: 'revenue', currency: 'USD' }),
      tx('expense eur', {
        from: '[[Cash]]',
        to: '[[Food]]',
        amount: 10,
        foreignAmount: 12,
        foreignCurrency: 'USD',
      }),
      tx('expense usd', { to: '[[Food]]', amount: 3, currency: 'USD' }),
      tx('salary', { from: '[[Salary]]', amount: 20, foreignAmount: 22, foreignCurrency: 'USD' }),
      tx('no currency', { to: '[[Food]]', amount: 2, currency: null }),
    ])
    expect(bi.getCurrenciesForAccount('Food.md')).toEqual(['EUR', 'USD'])
    expect(bi.getCurrenciesForAccount('Cash.md')).toEqual([])
    expect(bi.getBalanceAtDateByCurrency('Food.md', at, 'EUR')).toBe(10)
    expect(bi.getBalanceAtDateByCurrency('Food.md', at, 'USD')).toBe(3)
    expect(bi.getBalanceAtDateByCurrency('Salary.md', at, 'EUR')).toBe(-20)
    expect(bi.getBalanceAtDate('Food.md', at)).toBe(2)
    expect(bi.getBalanceAtDateByCurrency('Food.md', dayjs('2024-02-29'), 'EUR')).toBe(0)
    expect(
      bi.getBalanceSeriesByCurrency('Food.md', dayjs('2024-02-29'), dayjs('2024-03-02'), 'EUR')
    ).toEqual([
      { date: '2024-02-29', balance: 0 },
      { date: '2024-03-01', balance: 10 },
      { date: '2024-03-02', balance: 10 },
    ])
    expect(bi.getBalanceSeriesByCurrency('Food.md', at, at.subtract(1, 'day'), 'EUR')).toEqual([])
  })

  it('uses a foreign amount on the outgoing wallet and the primary amount on its category', () => {
    build([
      account('Cash'),
      account('Food', { accountType: 'expense' }),
      tx('purchase', {
        from: '[[Cash]]',
        to: '[[Food]]',
        currency: 'USD',
        amount: 11,
        foreignCurrency: 'EUR',
        foreignAmount: 10,
      }),
    ])
    expect(bi.getBalanceAtDate('Cash.md', at)).toBe(-10)
    expect(bi.getBalanceAtDateByCurrency('Food.md', at, 'USD')).toBe(11)
  })

  it('skips unloaded, undated and missing amounts but accepts zero, refunds, self-transfers and unresolved links', () => {
    build([
      account('Cash'),
      tx('unloaded', { amount: 100 }),
      tx('undated', { date: null, amount: 100 }),
      tx('missing amount', { amount: null }),
      tx('zero', { amount: 0 }),
      tx('refund', { amount: -5 }),
      tx('self', { from: '[[Cash]]', amount: 20 }),
      tx('broken', { to: '[[Missing]]', amount: 100 }),
      tx('one side', { from: '[[Missing]]', amount: 2 }),
      tx('no sides', { to: null, amount: 100 }),
    ])
    tl.transactions.get('unloaded.md')!.loaded = false
    bi.rebuild()
    expect(bi.getBalanceAtDate('Cash.md', at)).toBe(-3)
    expect(bi.getBalanceAtDate('Missing.md', at)).toBe(0)
    expect(bi.version.value).toBe(2)
  })

  it('adds thousands of small amounts exactly and rebuilding replaces rather than duplicates entries', () => {
    build([
      account('Cash', { startingBalance: 0.1 }),
      ...Array.from({ length: 2000 }, (_, i) => tx(`small ${i}`, { amount: 0.01 })),
    ])
    expect(bi.getBalanceAtDate('Cash.md', at)).toBe(20.1)
    tl.transactions.get('small 0.md')!.amount = 0.2
    bi.rebuild()
    expect(bi.getBalanceAtDate('Cash.md', at)).toBe(20.29)
    tl.transactions.clear()
    bi.rebuild()
    expect(bi.getBalanceAtDate('Cash.md', at)).toBe(0.1)
  })
})

describe('BalanceIndex — net worth and period queries', () => {
  it('adds signed debts, excludes opted-out accounts and categories, and never converts currencies', () => {
    build([
      account('Cash', { startingBalance: 100.1 }),
      account('Borrowed', { accountType: 'liability', startingBalance: -30.2 }),
      account('Lent', { accountType: 'liability', startingBalance: 20.3 }),
      account('Dollars', { currency: 'USD', startingBalance: 5 }),
      account('Hidden', { startingBalance: 999, excludeFromTotal: true }),
      account('Hidden debt', {
        accountType: 'liability',
        startingBalance: -999,
        excludeFromTotal: true,
      }),
      ...['expense', 'revenue', 'computed'].map((accountType) =>
        account(accountType, { accountType, startingBalance: 1000 })
      ),
    ])
    expect(bi.getNetWorthAtDateByCurrency(at, 'EUR')).toBe(90.2)
    expect(bi.getNetWorthAtDateByCurrency(at, 'USD')).toBe(5)
    expect(bi.getNetWorthAtDateByCurrency(at, 'GBP')).toBe(0)
    expect(bi.getNetWorthAtDate(at)).toBe(95.2)
  })

  it('filters inclusive dates, category and direction; period amounts stay primary, not wallet-converted', () => {
    build([
      account('Cash'),
      account('Other'),
      { path: 'Tags/Food.md' },
      { path: 'Tags/Rent.md' },
      tx('before', { date: '2024-02-29', amount: 500 }),
      tx('after', { date: '2024-04-01', amount: 500 }),
      tx('out', { from: '[[Cash|Card]]', to: '[[Other]]', amount: 0.1, category: '[[Food]]' }),
      tx('in', { date: '2024-03-31', from: '[[Other]]', amount: 0.2, category: '[[Food]]' }),
      tx('self', { from: '[[Cash]]', amount: 0.3, category: '[[Rent]]' }),
      tx('foreign', { amount: 2, currency: 'USD', foreignAmount: 1.8, foreignCurrency: 'EUR' }),
      tx('missing category', { amount: 0 }),
      tx('undated', { date: null }),
      tx('missing amount', { amount: null }),
      tx('unloaded', { amount: 999 }),
    ])
    tl.transactions.get('unloaded.md')!.loaded = false
    const period = { startDate: dayjs('2024-03-01'), endDate: at }
    expect(bi.getTotalForPeriod(period)).toBe(2.6)
    expect(bi.getTotalForPeriod({ ...period, accountPath: 'Cash.md' })).toBe(2.1)
    expect(bi.getTotalForPeriod({ ...period, accountPath: 'Cash.md', direction: 'from' })).toBe(0.4)
    expect(bi.getTotalForPeriod({ ...period, accountPath: 'Cash.md', direction: 'to' })).toBe(2.5)
    expect(bi.getTotalForPeriod({ ...period, categoryPath: 'Tags/Food.md' })).toBe(0.3)
    expect(
      bi.getTotalForPeriod({ ...period, categoryPath: 'Tags/Food.md', accountPath: 'Cash.md' })
    ).toBe(0.1)
    expect(bi.getTotalForPeriod({ ...period, categoryPath: 'Missing.md' })).toBe(0)
    expect(bi.getTotalForPeriod({ ...period, accountPath: 'Missing.md' })).toBe(0)
    expect(bi.getTotalForPeriod({ startDate: at, endDate: period.startDate })).toBe(0)
  })

  it('resolves period categories from the transaction folder and clears negative link-cache entries on rebuild', () => {
    const app = build([
      account('Cash'),
      { path: 'Home/Tag.md' },
      { path: 'Work/Tag.md' },
      tx('Home/first', { category: '[[Tag]]', amount: 3 }),
      tx('Work/second', { category: '[[Tag]]', to: '[[Future]]', amount: 7 }),
    ])
    const period = { startDate: dayjs('2024-03-01'), endDate: at }
    expect(bi.getTotalForPeriod({ ...period, categoryPath: 'Home/Tag.md' })).toBe(3)
    expect(bi.getTotalForPeriod({ ...period, categoryPath: 'Work/Tag.md' })).toBe(7)
    const resolve = vi.spyOn(app.metadataCache, 'getFirstLinkpathDest')
    resolve.mockImplementation((link) =>
      link === 'Future.md' ? app.vault.getFileByPath('Cash.md') : null
    )
    bi.rebuild()
    expect(bi.getBalanceAtDate('Cash.md', at)).toBe(7)
    resolve.mockRestore()
  })

  it('rebuilds on the first resolve and finance metadata, ignores unrelated changes, and cleans cached sums', () => {
    const app = build([
      account('Cash', { startingBalance: 10 }),
      tx('purchase'),
      { path: 'Plain.md' },
    ])
    const rebuild = vi.spyOn(bi, 'rebuild')
    app.emit('metadataCache', 'resolved')
    app.emit('metadataCache', 'resolved')
    expect(rebuild).toHaveBeenCalledTimes(1)
    app.emit('metadataCache', 'changed', app.vault.getFileByPath('Plain.md'))
    expect(rebuild).toHaveBeenCalledTimes(1)
    app.emit('metadataCache', 'changed', app.vault.getFileByPath('Cash.md'))
    app.emit('metadataCache', 'changed', app.vault.getFileByPath('purchase.md'))
    expect(rebuild).toHaveBeenCalledTimes(3)
    const off = vi.spyOn(app.metadataCache, 'offref')
    bi.cleanup()
    expect(off).toHaveBeenCalledTimes(3)
    expect(bi.getBalanceAtDate('Cash.md', at)).toBe(10)
    bi.cleanup()
    expect(off).toHaveBeenCalledTimes(3)
  })
})
