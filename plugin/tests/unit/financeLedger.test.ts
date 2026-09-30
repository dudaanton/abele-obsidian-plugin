import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref, type EffectScope } from 'vue'
import dayjs from 'dayjs'
import { buildLedger, LEDGER_SETTLE_MS, useFinanceLedger } from '@/composables/useFinanceLedger'
import { Transaction } from '@/entities/Transaction'
import { TransactionsList } from '@/entities/TransactionsList'
import { GlobalStore } from '@/stores/GlobalStore'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { useVault } from '../helpers/testEnv'

let scope: EffectScope | undefined
let list: TransactionsList | undefined
const store = GlobalStore.getInstance()
function tx(id: string, overrides: Partial<Transaction> = {}) {
  return reactive(
    Object.assign(
      new Transaction({
        id,
        wikilink: `[[${id}]]`,
        date: dayjs('2024-03-01'),
        amount: 1,
        currency: 'EUR',
      }),
      { loaded: true },
      overrides
    )
  ) as Transaction
}
beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Moscow')
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date('2024-03-01T00:15:00+03:00'))
  useVault([])
  store.transactionsList.value = null
})
afterEach(() => {
  scope?.stop()
  scope = undefined
  list?.cleanup()
  list = undefined
  store.transactionsList.value = null
  VaultWatcherWrapper.destroy()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
function ledger(active = ref(true), settleMs?: number) {
  scope = effectScope()
  return scope.run(() => useFinanceLedger(active, settleMs))!
}
function install(...transactions: Transaction[]) {
  list = new TransactionsList()
  for (const t of transactions) list.transactions.set(t.transactionPath, t)
  store.transactionsList.value = list
  return list
}

describe('buildLedger', () => {
  it('sorts newest date then creation time, stably on ties, preserving the live entity', () => {
    const live = tx('newer', { amount: null, currency: null })
    const items = [
      tx('old', { date: dayjs('2024-02-29') }),
      tx('first'),
      live,
      tx('tie'),
      tx('undated', { date: null }),
      tx('unloaded', { loaded: false }),
    ]
    const ctime = vi.fn((path: string) => (path === 'old.md' ? 999 : path === 'first.md' ? 1 : 2))
    const result = buildLedger(items, () => null, ctime)
    expect(result.map((entry) => entry.id)).toEqual(['newer', 'tie', 'first', 'old'])
    expect(result[0]).toEqual({
      tx: live,
      id: 'newer',
      date: '2024-03-01',
      ctime: 2,
      from: null,
      to: null,
      amount: null,
      currency: null,
    })
    expect(result[0].tx).toBe(live)
    expect(ctime).toHaveBeenCalledTimes(4)
    expect(items.map((item) => item.id)).toEqual([
      'old',
      'first',
      'newer',
      'tie',
      'undated',
      'unloaded',
    ])
  })

  it('resolves every distinct link once per pass, including misses, without resolving empty sides', () => {
    useVault(Array.from({ length: 2000 }, (_, i) => ({ path: `item ${i}.md` })))
    const items = Array.from({ length: 2000 }, (_, i) =>
      tx(`item ${i}`, { from: '[[Cash]]', to: i % 2 ? '[[Missing]]' : null })
    )
    const resolve = vi.fn((link: string) => (link === '[[Cash]]' ? 'Cash.md' : null))
    const ctime = vi.fn(() => 0)
    expect(buildLedger(items, resolve, ctime)).toHaveLength(2000)
    expect(resolve.mock.calls).toEqual([['[[Cash]]'], ['[[Missing]]']])
    expect(ctime).toHaveBeenCalledTimes(2000)
    buildLedger(items, resolve, ctime)
    expect(resolve).toHaveBeenCalledTimes(4)
    expect(buildLedger([], resolve, ctime)).toEqual([])
  })
})

describe('useFinanceLedger — reactive public surface', () => {
  it('starts empty before finance initializes and catches list replacement and clearing', async () => {
    const view = ledger()
    expect(view.entries.value).toEqual([])
    expect(view.rebuilds.value).toBe(1)
    install(tx('first'))
    vi.advanceTimersByTime(LEDGER_SETTLE_MS)
    expect(view.entries.value.map((entry) => entry.id)).toEqual(['first'])
    store.transactionsList.value = null
    vi.advanceTimersByTime(LEDGER_SETTLE_MS)
    expect(view.entries.value).toEqual([])
    expect(view.rebuilds.value).toBe(3)
  })

  it.each([
    { field: 'loaded', change: { loaded: false }, expected: [] },
    { field: 'date', change: { date: dayjs('2024-02-29') }, expected: [{ date: '2024-02-29' }] },
    { field: 'from', change: { from: '[[Cash]]' }, expected: [{ from: 'Cash.md' }] },
    { field: 'to', change: { to: '[[Cash]]' }, expected: [{ to: 'Cash.md' }] },
    { field: 'amount', change: { amount: 0 }, expected: [{ amount: 0 }] },
    { field: 'currency', change: { currency: 'USD' }, expected: [{ currency: 'USD' }] },
  ])('tracks $field changes', ({ change, expected }) => {
    useVault([{ path: 'Cash.md' }])
    const live = tx('first')
    install(live)
    const view = ledger()
    Object.assign(live, change)
    expect(view.rebuilds.value).toBe(1)
    vi.advanceTimersByTime(LEDGER_SETTLE_MS)
    expect(view.entries.value).toMatchObject(expected)
    expect(view.entries.value).toHaveLength(expected.length)
    expect(view.rebuilds.value).toBe(2)
  })

  it('uses a trailing custom settle delay and retracks additions, removals and subsequent edits', () => {
    const first = tx('first')
    const tl = install(first)
    const view = ledger(ref(true), 20)
    first.amount = 2
    vi.advanceTimersByTime(19)
    first.currency = 'USD'
    const second = tx('second')
    tl.transactions.set('second.md', second)
    vi.advanceTimersByTime(19)
    expect(view.rebuilds.value).toBe(1)
    vi.advanceTimersByTime(1)
    expect(view.rebuilds.value).toBe(2)
    expect(view.entries.value.map((entry) => entry.id)).toEqual(['first', 'second'])
    second.amount = 8
    vi.advanceTimersByTime(20)
    expect(view.entries.value[1].amount).toBe(8)
    tl.transactions.delete('first.md')
    vi.advanceTimersByTime(20)
    expect(view.entries.value.map((entry) => entry.id)).toEqual(['second'])
    first.amount = 99
    vi.advanceTimersByTime(20)
    expect(view.rebuilds.value).toBe(4)
  })

  it('does no work hidden, catches up immediately when shown, and cancels pending work on hide and dispose', async () => {
    const live = tx('first')
    install(live)
    const active = ref(false)
    const view = ledger(active)
    live.amount = 2
    vi.advanceTimersByTime(1000)
    expect(view.rebuilds.value).toBe(0)
    expect(view.entries.value).toEqual([])
    active.value = true
    await nextTick()
    expect(view.entries.value[0].amount).toBe(2)
    live.amount = 3
    active.value = false
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(view.rebuilds.value).toBe(1)
    live.amount = 4
    active.value = true
    await nextTick()
    expect(view.entries.value[0].amount).toBe(4)
    expect(view.rebuilds.value).toBe(2)
    live.amount = 5
    scope!.stop()
    vi.advanceTimersByTime(1000)
    live.amount = 6
    vi.advanceTimersByTime(1000)
    expect(view.rebuilds.value).toBe(2)
  })

  it('uses real file creation times, defaults absent files to zero and does not rebuild for body-only edits', () => {
    const app = useVault([{ path: 'first.md' }])
    app.vault.getFileByPath('first.md')!.stat.ctime = 42
    const first = tx('first')
    install(tx('missing'), first)
    const view = ledger()
    expect(view.entries.value.map(({ id, ctime }) => ({ id, ctime }))).toEqual([
      { id: 'first', ctime: 42 },
      { id: 'missing', ctime: 0 },
    ])
    first.title = 'New title'
    first.description = 'New body'
    first.foreignAmount = 5
    vi.advanceTimersByTime(1000)
    expect(view.rebuilds.value).toBe(1)
    expect(view.entries.value[0].tx.title).toBe('New title')
  })

  // BUG: unlike BalanceIndex (64e30464), the screen ledger resolves from the vault
  // root and memoises only the wikilink. Two same-named accounts in different folders
  // resolve to neither (or to the root note), so type/day/period totals disagree with balances.
  it.fails('resolves duplicate wallet names from each transaction note, like BalanceIndex', () => {
    useVault([
      { path: 'Home/Wallet.md', frontmatter: { type: 'account', accountType: 'asset' } },
      { path: 'Work/Wallet.md', frontmatter: { type: 'account', accountType: 'asset' } },
      {
        path: 'Home/Spend.md',
        frontmatter: { type: 'transaction', date: '2024-03-01', from: '[[Wallet]]', amount: 5 },
      },
      {
        path: 'Work/Spend.md',
        frontmatter: { type: 'transaction', date: '2024-03-01', from: '[[Wallet]]', amount: 7 },
      },
    ])
    list = new TransactionsList()
    store.transactionsList.value = list
    const view = ledger()
    expect(view.entries.value.map((entry) => entry.from)).toEqual([
      'Home/Wallet.md',
      'Work/Wallet.md',
    ])
  })
})
