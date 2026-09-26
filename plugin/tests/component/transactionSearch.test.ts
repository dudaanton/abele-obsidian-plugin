/**
 * Search in the transaction lists: the one under a note, which holds that note's transactions,
 * and the finance sidebar's, which holds all of them.
 *
 * Both lists page, and a transaction reads its text only once it is on screen, so the one
 * matching transaction sits far past the first page with nothing loaded into it. The results
 * keep the date headings the list has without a search.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import { nextTick } from 'vue'
import { Transaction } from '@/entities/Transaction'
import TransactionsList from '@/components/TransactionsList.vue'
import FinanceSidebar from '@/components/FinanceSidebar.vue'
import ObsidianIcon from '@/components/obsidian/Icon.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { FakeApp, FakeFileSpec } from '../helpers/fakeVault'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
} from '../helpers/fakeIntersectionObserver'
import { useVault, configureAbele } from '../helpers/testEnv'

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

const COUNT = 300
const PAGE = 20
/** Far past the first page, so only a search over the whole list can find it. */
const NEEDLES = [250, 251, 260]
/** Longer than the list's typing delay. */
const SETTLE_MS = 400

const start = dayjs().startOf('month')
/** Two transactions a day, newest first by index. */
const dayOf = (i: number) => start.subtract(Math.floor(i / 2), 'day').format('YYYY-MM-DD')

function specs(): FakeFileSpec[] {
  const out: FakeFileSpec[] = [
    {
      path: 'Accounts/Card.md',
      frontmatter: { type: 'account', accountType: 'asset', currency: 'EUR' },
    },
    { path: 'Accounts/Food.md', frontmatter: { type: 'account', accountType: 'expense' } },
    { path: 'Accounts/Books.md', frontmatter: { type: 'account', accountType: 'expense' } },
  ]
  for (let i = 0; i < COUNT; i++) {
    const needle = NEEDLES.includes(i)
    out.push({
      path: `Transactions/tx ${i}.md`,
      frontmatter: {
        type: 'transaction',
        date: dayOf(i),
        from: '[[Card]]',
        to: i === 260 ? '[[Books]]' : '[[Food]]',
        amount: 10,
        currency: 'EUR',
      },
      content: needle ? `Birthday present\nA Passport cover` : `Groceries ${i}\nMilk and bread`,
    })
  }
  // After the sidebar's period, which ends with this month.
  out.push({
    path: 'Transactions/future.md',
    frontmatter: {
      type: 'transaction',
      date: start.add(2, 'month').format('YYYY-MM-DD'),
      from: '[[Card]]',
      to: '[[Food]]',
      amount: 1,
      currency: 'EUR',
    },
    content: 'Passport renewal fee',
  })
  return out
}

let app: FakeApp
let wrapper: VueWrapper | null = null

function searchIcon(view: VueWrapper) {
  const icon = view.findAllComponents(ObsidianIcon).find((c) => c.props('icon') === 'search')
  if (!icon) throw new Error('no search icon')
  return icon
}

function input(view: VueWrapper) {
  return view.find<HTMLInputElement>('input[type="search"]')
}

async function type(view: VueWrapper, text: string) {
  await input(view).setValue(text)
  await vi.advanceTimersByTimeAsync(SETTLE_MS)
  await flushPromises()
  await nextTick()
}

function shownPaths(view: VueWrapper): string[] {
  return view
    .findAllComponents({ name: 'TransactionItem' })
    .map((c) => (c.props('transaction') as Transaction).transactionPath)
}

function shownDates(view: VueWrapper): string[] {
  return view.findAllComponents({ name: 'DateDivider' }).map((c) => c.props('date') as string)
}

const needlePaths = (list: number[]) => list.map((i) => `Transactions/tx ${i}.md`)

beforeEach(() => {
  vi.useFakeTimers()
  resetFakeIntersectionObservers()
  installFakeIntersectionObserver()
  configureAbele()
  app = useVault(specs())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
})

describe('searching the transactions under a note', () => {
  /** What a note's footer hands the list: loaded, dated, no text read yet. */
  async function buildTransactions(indices: number[]): Promise<Transaction[]> {
    const txs = indices.map((i) => new Transaction({ wikilink: `[[Transactions/tx ${i}]]` }))
    for (const tx of txs) await tx.load()
    return txs
  }

  async function render(indices: number[]) {
    wrapper = mount(TransactionsList, {
      props: { transactions: await buildTransactions(indices) },
      global: { stubs: { TransactionItem: true } },
    }) as VueWrapper
    await flushPromises()
    return wrapper
  }

  const all = Array.from({ length: COUNT }, (_, i) => i)

  it('has a search icon in the header that says what it does', async () => {
    const view = await render(all)
    expect(searchIcon(view).props('tooltip')).toMatch(/search/i)
    expect(input(view).exists()).toBe(false)
  })

  it('finds transactions far down the list by their text, under their dates', async () => {
    const view = await render(all)
    expect(shownPaths(view)).toHaveLength(PAGE)

    await searchIcon(view).trigger('click')
    await type(view, 'passport')

    expect(shownPaths(view).sort()).toEqual(needlePaths(NEEDLES).sort())
    expect(shownDates(view)).toEqual([dayOf(250), dayOf(260)])
  })

  it('finds by the account a transaction went to', async () => {
    const view = await render(all)
    await searchIcon(view).trigger('click')
    await type(view, 'books')

    expect(shownPaths(view)).toEqual(needlePaths([260]))
  })

  it('searches only the transactions of this list', async () => {
    const view = await render(all.filter((i) => i !== 251))
    await searchIcon(view).trigger('click')
    await type(view, 'passport')

    expect(shownPaths(view).sort()).toEqual(needlePaths([250, 260]).sort())
  })

  it('says so when nothing matches, and comes back whole on Escape', async () => {
    const view = await render(all)
    await searchIcon(view).trigger('click')
    await type(view, 'zeppelin')
    expect(shownPaths(view)).toEqual([])
    expect(view.text()).toMatch(/nothing matches/i)

    await input(view).trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(input(view).exists()).toBe(false)
    expect(shownPaths(view)).toHaveLength(PAGE)
  })
})

describe('searching the finance sidebar', () => {
  beforeEach(() => {
    AbeleConfig.getInstance().pinnedCurrencies = 'EUR'
    GlobalStore.getInstance().initFinance()
  })

  afterEach(() => {
    const store = GlobalStore.getInstance()
    store.balanceIndex.value?.cleanup()
    store.balanceIndex.value = null
    store.transactionsList.value?.cleanup()
    store.transactionsList.value = null
    store.accountsList.value?.cleanup()
    store.accountsList.value = null
  })

  async function render() {
    wrapper = mount(FinanceSidebar, {
      shallow: true,
      props: { active: true },
      global: { stubs: { ObsidianSearch: false, Search: false } },
    }) as VueWrapper
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flushPromises()
    await nextTick()
    return wrapper
  }

  it('finds among every transaction, past the first page and past the period, by date', async () => {
    const view = await render()
    expect(shownPaths(view)).toHaveLength(PAGE)
    expect(shownPaths(view)).not.toContain('Transactions/future.md')

    await searchIcon(view).trigger('click')
    await type(view, 'passport')

    expect(shownPaths(view)[0]).toBe('Transactions/future.md')
    expect(shownPaths(view).slice(1).sort()).toEqual(needlePaths(NEEDLES).sort())
    expect(shownDates(view)).toEqual([
      start.add(2, 'month').format('YYYY-MM-DD'),
      dayOf(250),
      dayOf(260),
    ])
  })

  it('comes back to the period when the search is closed', async () => {
    const view = await render()
    await searchIcon(view).trigger('click')
    await type(view, 'passport')
    await searchIcon(view).trigger('click')
    await flushPromises()

    expect(shownPaths(view)).toHaveLength(PAGE)
    expect(shownPaths(view)).not.toContain('Transactions/future.md')
  })
})
