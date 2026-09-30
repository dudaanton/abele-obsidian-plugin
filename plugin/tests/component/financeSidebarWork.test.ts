/**
 * How much work one new transaction costs the finance sidebar.
 *
 * Counted in link resolutions and file lookups against the fake vault rather than in
 * milliseconds, so the numbers are the same on every machine.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import type { TFile } from 'obsidian'
import { nextTick } from 'vue'
import FinanceSidebar from '@/components/FinanceSidebar.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { FakeApp, FakeFileSpec } from '../helpers/fakeVault'
import { useVault } from '../helpers/testEnv'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'

// happy-dom has no canvas. The charts are drawn by a library the sidebar only hands data to.
vi.mock('@/bases/echarts', () => ({
  echartsInit: () => ({
    on() {},
    setOption() {},
    clear() {},
    resize() {},
    dispose() {},
    isDisposed: () => false,
  }),
  getThemeColors: () => ({ text: '', textFaint: '', income: '', expense: '' }),
}))

const COUNT = 2000

function fixture(): FakeFileSpec[] {
  const specs: FakeFileSpec[] = [
    {
      path: 'Accounts/Card.md',
      frontmatter: { type: 'account', accountType: 'asset', currency: 'EUR' },
    },
    { path: 'Accounts/Food.md', frontmatter: { type: 'account', accountType: 'expense' } },
    { path: 'Accounts/Salary.md', frontmatter: { type: 'account', accountType: 'revenue' } },
  ]
  // Every fixture transaction predates a newly added one, including on the month's first day.
  // Otherwise tied dates can leave the new item beyond the sidebar's first page.
  const start = dayjs().subtract(1, 'day')
  for (let i = 0; i < COUNT; i++) {
    const income = i % 10 === 0
    specs.push({
      path: `Transactions/tx ${i}.md`,
      frontmatter: {
        type: 'transaction',
        date: start.subtract(i % 90, 'day').format('YYYY-MM-DD'),
        from: income ? '[[Salary]]' : '[[Card]]',
        to: income ? '[[Card]]' : '[[Food]]',
        amount: 10 + (i % 7),
        currency: 'EUR',
      },
    })
  }
  return specs
}

let app: FakeApp
let wrapper: VueWrapper | null = null

async function settle() {
  await flushPromises()
  await nextTick()
  await flushPromises()
}

async function addTransaction(name: string) {
  const path = `Transactions/${name}.md`
  const frontmatter = {
    type: 'transaction',
    date: dayjs().format('YYYY-MM-DD'),
    from: '[[Card]]',
    to: '[[Food]]',
    amount: 5,
    currency: 'EUR',
  }
  const file = await (
    app.vault as unknown as { create(p: string, c: string): Promise<TFile> }
  ).create(path, '')
  // The fake vault defaults every ctime to zero. A new note must be newer than the
  // fixture notes even when their transaction dates tie on the first of the month;
  // otherwise it falls behind the first page's 20 rows rather than appearing on top.
  file.stat.ctime = Date.now()
  app.setFrontmatter(path, frontmatter)
  app.emit('metadataCache', 'changed', file)
  app.emit('metadataCache', 'resolved')
  await settle()
}

beforeEach(() => {
  // Reproduce the original failure regardless of the host's date or timezone:
  // October has begun locally while UTC is still in September.
  vi.stubEnv('TZ', 'Europe/Moscow')
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date('2026-10-01T00:15:00+03:00'))
  installFakeIntersectionObserver()
  app = useVault(fixture())
  AbeleConfig.getInstance().pinnedCurrencies = 'EUR'
  GlobalStore.getInstance().initFinance()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  const store = GlobalStore.getInstance()
  store.balanceIndex.value?.cleanup()
  store.balanceIndex.value = null
  store.transactionsList.value?.cleanup()
  store.transactionsList.value = null
  store.accountsList.value?.cleanup()
  store.accountsList.value = null
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

function work() {
  return {
    links: app.stats.getFirstLinkpathDest,
    files: app.stats.getAbstractFileByPath,
  }
}

const SETTLE = 250

/**
 * The same work as with no sidebar. The balance index looks every transaction up twice, and
 * each test adds one after taking the baseline, hence the two.
 */
function expectNoMoreThan(actual: ReturnType<typeof work>, none: ReturnType<typeof work>) {
  expect(actual.links).toBe(none.links)
  expect(actual.files - none.files).toBeLessThanOrEqual(2)
}

function shownTitles(w: VueWrapper): string[] {
  return w
    .findAllComponents({ name: 'TransactionItem' })
    .map((c) => (c.props('transaction') as { transactionPath: string }).transactionPath)
}

async function mountSidebar(active = true) {
  wrapper = mount(FinanceSidebar, { shallow: true, props: { active } })
  await settle()
  return wrapper
}

describe('finance sidebar — work per new transaction', () => {
  it('puts new same-day notes on the first page at a non-UTC month boundary', async () => {
    expect(dayjs().format('YYYY-MM-DD HH:mm Z')).toBe('2026-10-01 00:15 +03:00')
    expect(new Date().toISOString()).toBe('2026-09-30T21:15:00.000Z')

    const w = await mountSidebar()
    const initialPage = shownTitles(w)
    expect(initialPage).toHaveLength(20)
    // More than a page already shares today's date, so date ordering alone cannot
    // make a newly created note visible. Its creation time must break the tie.
    const sameDay = [...GlobalStore.getInstance().transactionsList.value!.transactions.values()]
      .filter((tx) => tx.date?.format('YYYY-MM-DD') === '2026-10-01')
      .map((tx) => tx.transactionPath)
    expect(sameDay).toHaveLength(23)
    for (const path of initialPage) expect(sameDay).toContain(path)

    await addTransaction('first of month')
    expect(shownTitles(w)).toEqual(initialPage)
    vi.advanceTimersByTime(SETTLE)
    await settle()
    expect(shownTitles(w)).toEqual(['Transactions/first of month.md', ...initialPage.slice(0, 19)])

    await addTransaction('newest of month')
    vi.advanceTimersByTime(SETTLE)
    await settle()
    expect(shownTitles(w)).toEqual([
      'Transactions/newest of month.md',
      'Transactions/first of month.md',
      ...initialPage.slice(0, 18),
    ])
  })

  /**
   * What a new transaction costs with no sidebar at all — the balance index's rebuild and
   * nothing else. Taken on the second transaction: the first also carries the index's
   * one-off rebuild for the vault's initial resolve.
   */
  async function baseline() {
    await addTransaction('warm-up')
    vi.advanceTimersByTime(SETTLE)
    await settle()
    app.resetStats()
    await addTransaction('baseline')
    vi.advanceTimersByTime(SETTLE)
    await settle()
    return work()
  }

  /** Two new transactions and an edit to an old one, all before anything settles. */
  async function burst(tag: string) {
    await addTransaction(`${tag} 1`)
    await addTransaction(`${tag} 2`)
    const { transactionsList } = GlobalStore.getInstance()
    const tx = [...transactionsList.value!.transactions.values()][0]
    tx.amount = (tx.amount ?? 0) + 1
    await settle()
    vi.advanceTimersByTime(SETTLE)
    await settle()
  }

  it('lists a new transaction once changes settle, resolving each account once', async () => {
    const none = await baseline()
    const w = await mountSidebar()

    app.resetStats()
    await addTransaction('while open')
    const beforeSettling = work()
    expect(shownTitles(w)).not.toContain('Transactions/while open.md')

    app.resetStats()
    vi.advanceTimersByTime(SETTLE)
    await settle()
    const settled = work()
    const open = {
      links: beforeSettling.links + settled.links,
      files: beforeSettling.files + settled.files,
    }

    expect(shownTitles(w)).toContain('Transactions/while open.md')
    // Three accounts in the vault, so three resolutions — not two per transaction.
    expect(open.links - none.links).toBeLessThanOrEqual(3)
    // One lookup per transaction for its path and one for its creation time.
    expect(open.files - none.files).toBeLessThanOrEqual(2 * COUNT + 30)
  })

  it('rebuilds once for a burst of changes', async () => {
    await baseline()
    app.resetStats()
    await burst('closed')
    const none = work()

    await mountSidebar()
    app.resetStats()
    await burst('open')
    const open = work()

    // A rebuild looks up every transaction twice; a second one would double that.
    expect(open.files - none.files).toBeLessThanOrEqual(2 * COUNT + 30)
    expect(open.links - none.links).toBeLessThanOrEqual(3)
  })

  it('does nothing while hidden and catches up when shown', async () => {
    const none = await baseline()
    const w = await mountSidebar(false)

    app.resetStats()
    await addTransaction('while hidden')
    vi.advanceTimersByTime(SETTLE)
    await settle()

    expectNoMoreThan(work(), none)

    await w.setProps({ active: true })
    await settle()
    expect(shownTitles(w)).toContain('Transactions/while hidden.md')
  })

  it('costs nothing once closed', async () => {
    const none = await baseline()
    const w = await mountSidebar()
    w.unmount()
    wrapper = null

    app.resetStats()
    await addTransaction('after close')
    vi.advanceTimersByTime(SETTLE)
    await settle()

    expectNoMoreThan(work(), none)
  })
})
