import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick, toRaw } from 'vue'
import dayjs from 'dayjs'
import FinanceSidebar from '@/components/FinanceSidebar.vue'
import TransactionsList from '@/components/TransactionsList.vue'
import PeriodSelector from '@/components/obsidian/PeriodSelector.vue'
import DateDivider from '@/components/obsidian/DateDivider.vue'
import Tabs from '@/components/obsidian/Tabs.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { Transaction } from '@/entities/Transaction'
import Icon from '@/components/obsidian/Icon.vue'
import { createTransaction } from '@/commands/createTransaction'
import Search from '@/components/obsidian/Search.vue'
import { FOOTER_FOLD, resetFooterFolds } from '@/composables/useFooterFold'
import { FOOTER_VIEW_KEY, resetFooterView } from '@/composables/useFooterView'
import { AbeleConfig } from '@/services/AbeleConfig'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { formatAmount } from '@/helpers/moneyFormat'
import { openFile } from '@/helpers/vaultUtils'
import type { FakeFileSpec } from '../helpers/fakeVault'
import { useVault } from '../helpers/testEnv'
import {
  installFakeIntersectionObserver,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

vi.mock('@/commands/createTransaction', () => ({ createTransaction: vi.fn() }))

const charts = vi.hoisted(() => ({
  instances: [] as Array<{
    on: ReturnType<typeof vi.fn>
    setOption: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    clear: ReturnType<typeof vi.fn>
    resize: ReturnType<typeof vi.fn>
    isDisposed: () => boolean
  }>,
}))
vi.mock('@/bases/echarts', () => ({
  echartsInit: () => {
    const chart = {
      on: vi.fn(),
      setOption: vi.fn(),
      dispose: vi.fn(),
      clear: vi.fn(),
      resize: vi.fn(),
      isDisposed: () => false,
    }
    charts.instances.push(chart)
    return chart
  },
  getThemeColors: () => ({ text: '#000', textFaint: '#888', income: '#0f0', expense: '#f00' }),
}))
vi.mock('@/helpers/vaultUtils', async (original) => ({
  ...(await original<typeof import('@/helpers/vaultUtils')>()),
  openFile: vi.fn(),
}))
const account = (name: string, accountType: string, extra = {}): FakeFileSpec => ({
  path: `${name}.md`,
  frontmatter: { type: 'account', accountType, ...extra },
})
const tx = (name: string, from: string, to: string, amount: number, extra = {}): FakeFileSpec => ({
  path: `${name}.md`,
  frontmatter: {
    type: 'transaction',
    date: '2024-03-01',
    from: `[[${from}]]`,
    to: `[[${to}]]`,
    amount,
    currency: 'EUR',
    ...extra,
  },
})
function fixture(): FakeFileSpec[] {
  return [
    account('Cash', 'asset', { currency: 'EUR', startingBalance: 1000 }),
    account('Savings', 'asset', { currency: 'EUR' }),
    account('Dollars', 'asset', { currency: 'USD', startingBalance: 50 }),
    account('Lent', 'liability', { currency: 'EUR', startingBalance: 10 }),
    account('Borrowed', 'liability', { currency: 'EUR', startingBalance: -5 }),
    account('Food', 'expense', { startingBalanceDate: '2024-03-02' }),
    account('Salary', 'revenue'),
    tx('income', 'Salary', 'Cash', 100),
    tx('expense a', 'Cash', 'Food', 0.1),
    tx('expense b', 'Cash', 'Food', 0.2),
    tx('transfer', 'Cash', 'Savings', 20),
    tx('lend', 'Cash', 'Lent', 12),
    tx('return', 'Lent', 'Cash', 4),
    tx('usd', 'Dollars', 'Food', 3, { currency: 'USD' }),
    tx('before', 'Cash', 'Food', 5, { date: '2024-02-29' }),
    tx('after', 'Cash', 'Food', 7, { date: '2024-04-01' }),
  ]
}
const store = GlobalStore.getInstance()
let wrapper: VueWrapper | undefined
let pinned: string
beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Moscow')
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date('2024-03-01T00:15:00+03:00'))
  installFakeIntersectionObserver()
  pinned = AbeleConfig.getInstance().pinnedCurrencies
  AbeleConfig.getInstance().pinnedCurrencies = ' eur, USD, '
  charts.instances.length = 0
  useVault(fixture())
  store.initFinance()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  store.balanceIndex.value?.cleanup()
  store.balanceIndex.value = null
  store.transactionsList.value?.cleanup()
  store.transactionsList.value = null
  store.accountsList.value?.cleanup()
  store.accountsList.value = null
  VaultWatcherWrapper.destroy()
  AbeleConfig.getInstance().pinnedCurrencies = pinned
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
async function settle() {
  await nextTick()
  await flushPromises()
  await nextTick()
}
async function sidebar() {
  wrapper = mount(FinanceSidebar, {
    shallow: true,
    global: { renderStubDefaultSlot: true, stubs: { Chart: false, SidebarPanel: false } },
  })
  await settle()
  return wrapper
}
function summary() {
  return Object.fromEntries(
    wrapper!
      .findAll('.abele-finance-sidebar__summary-row')
      .map((row) => [
        row.find('.abele-finance-sidebar__summary-label').text(),
        row.find('.abele-finance-sidebar__summary-value').text(),
      ])
  )
}
function shown() {
  return wrapper!
    .findAllComponents({ name: 'TransactionItem' })
    .map((c) => c.props('transaction').transactionPath)
}
async function chartTab(tab: string) {
  wrapper!
    .findAllComponents(Tabs)
    .find((c) => c.classes().includes('abele-finance-sidebar__chart-tabs'))!
    .vm.$emit('update:modelValue', tab)
  await settle()
}
function option() {
  return charts.instances.at(-1)!.setOption.mock.calls.at(-1)![0]
}
async function period(start: string, end: string) {
  const picker = wrapper!.findComponent(PeriodSelector)
  picker.vm.$emit('update:start', dayjs(start))
  picker.vm.$emit('update:end', dayjs(end))
  await settle()
}

describe('finance sidebar — period money and charts', () => {
  it('counts income, expenses and debt directions from notes, not opening balances or category cutoffs', async () => {
    await sidebar()
    expect(summary()).toEqual({
      Income: formatAmount(100),
      Expenses: formatAmount(0.3),
      Savings: formatAmount(99.7),
      Lent: formatAmount(12),
      Returned: formatAmount(4),
    })
    const cards = wrapper!.findAll('.abele-finance-sidebar__card')
    expect(cards.map((c) => c.find('.abele-finance-sidebar__card-currency').text())).toEqual([
      'EUR',
      'USD',
    ])
    expect(cards[0].find('.abele-finance-sidebar__card-balance').text()).toContain(
      formatAmount(1086.7)
    )
    expect(cards[0].find('.abele-finance-sidebar__card-net').text()).toBe(formatAmount(1099.7))
    expect(
      cards[0].findAll('.abele-finance-sidebar__card-debt-amount').map((c) => c.text())
    ).toEqual([`+${formatAmount(18)}`, `-${formatAmount(5)}`])
    expect(shown()).toContain('before.md') // Recent means through period end, not only this month.
    expect(shown()).not.toContain('after.md')
  })

  it('switches currency without mixing period totals or hiding other-currency transactions', async () => {
    await sidebar()
    const tabs = wrapper!
      .findAllComponents(Tabs)
      .find((c) => c.classes().includes('abele-finance-sidebar__currency-tabs'))!
    expect(tabs.props('tabs')).toEqual([
      { id: 'EUR', label: 'EUR' },
      { id: 'USD', label: 'USD' },
    ])
    tabs.vm.$emit('update:modelValue', 'USD')
    await settle()
    expect(summary()).toEqual({
      Income: formatAmount(0),
      Expenses: formatAmount(3),
      Savings: formatAmount(-3),
    })
    expect(shown()).toContain('income.md')
    expect(shown()).toContain('usd.md')
    expect(option().series[0].data).toEqual([{ name: 'Food', path: 'Food.md', value: 3 }])
  })

  it('hands rounded category totals to the pie, navigates its slices and recreates it on theme changes', async () => {
    await sidebar()
    expect(option().series[0]).toMatchObject({
      type: 'pie',
      data: [{ name: 'Food', path: 'Food.md', value: 0.3 }],
      label: { alignTo: 'edge' },
    })
    const first = charts.instances[0]
    const click = first.on.mock.calls.find(([name]) => name === 'click')![1]
    click({ dataIndex: 0 })
    expect(openFile).toHaveBeenCalledWith('Food.md')
    click({ dataIndex: 99 })
    expect(openFile).toHaveBeenCalledTimes(1)
    store.themeVersion.value++
    await settle()
    expect(first.dispose).toHaveBeenCalled()
    expect(charts.instances.length).toBe(2)
    expect(option().series[0].data[0].value).toBe(0.3)
    await chartTab('income')
    expect(option().series[0].data).toEqual([{ name: 'Salary', path: 'Salary.md', value: 100 }])
    wrapper!.unmount()
    wrapper = undefined
    expect(charts.instances.at(-1)!.dispose).toHaveBeenCalled()
  })

  it('uses inclusive custom ranges, changes cards as of the end and hides the calendar tab', async () => {
    await sidebar()
    await chartTab('calendar')
    await period('2024-02-29', '2024-03-01')
    wrapper!.findComponent(PeriodSelector).vm.$emit('custom-applied')
    await settle()
    expect(summary().Expenses).toBe(formatAmount(5.3))
    const tabs = wrapper!
      .findAllComponents(Tabs)
      .find((c) => c.classes().includes('abele-finance-sidebar__chart-tabs'))!
    expect(tabs.props('tabs').map((t: { id: string }) => t.id)).toEqual([
      'expenses',
      'income',
      'networth',
    ])
    expect(tabs.props('modelValue')).toBe('expenses')
    await period('2024-04-01', '2024-04-01')
    expect(summary()).toEqual({
      Income: formatAmount(0),
      Expenses: formatAmount(7),
      Savings: formatAmount(-7),
    })
    expect(shown()).toContain('after.md')
    expect(wrapper!.find('.abele-finance-sidebar__card-balance').text()).toContain(
      formatAmount(1079.7)
    )
  })

  it('builds a full local-month calendar with empty days and correct income/expense labels', async () => {
    await sidebar()
    await chartTab('calendar')
    const o = option()
    expect(o.calendar.range).toEqual(['2024-03-01', '2024-03-31'])
    expect(o.series[0].data).toHaveLength(31)
    expect(o.series[0].data[0]).toEqual(['2024-03-01', 0.3])
    expect(o.series[0].data[30]).toEqual(['2024-03-31', 0])
    expect(o.tooltip.formatter({ data: ['2024-03-01'] })).toContain(`+${formatAmount(100)}`)
    expect(o.tooltip.formatter({ data: ['2024-03-01'] })).toContain(`-${formatAmount(0.3)}`)
    expect(o.tooltip.formatter({ data: ['2024-03-02'] })).toBe('2024-03-02<br/>No transactions')
    expect(o.series[0].label.formatter({ data: ['2024-03-02'] })).toBe('')
  })

  it('feeds signed net worth by pinned currency to the chart and responds to index rebuilds', async () => {
    await sidebar()
    await chartTab('networth')
    expect(
      option().series.map((s: { name: string; data: number[] }) => [
        s.name,
        s.data[0],
        s.data.at(-1),
      ])
    ).toEqual([
      ['EUR', 1099.7, 1099.7],
      ['USD', 47, 47],
    ])
    const legend = charts.instances
      .at(-1)!
      .on.mock.calls.find(([name]) => name === 'legendselectchanged')![1]
    legend({ selected: { EUR: false, USD: true } })
    store.accountsList.value!.accounts.get('Cash.md')!.startingBalance = 1001
    toRaw(store.balanceIndex.value!).rebuild()
    await settle()
    expect(option().series[0].data[0]).toBe(1100.7)
    expect(option().legend.selected).toEqual({ EUR: false, USD: true })
  })

  it('renders zero/no data for an empty period while keeping older recent transactions', async () => {
    await sidebar()
    await period('2024-05-01', '2024-05-31')
    expect(summary()).toEqual({
      Income: formatAmount(0),
      Expenses: formatAmount(0),
      Savings: formatAmount(0),
    })
    expect(wrapper!.find('.abele-finance-sidebar__pie-empty').text()).toBe('No data')
    expect(shown()).toContain('after.md')
  })
})

describe('footer transaction creation context', () => {
  it('restores drawn pages after search and never remembers search-only pagination (7e5b76e2)', async () => {
    resetFooterView()
    resetFooterFolds()
    const transactions: Transaction[] = []
    for (let i = 0; i < 45; i++) {
      await store.app.vault.create(`Search ${i}.md`, 'Shared phrase')
      const tx = new Transaction({
        wikilink: `[[Search ${i}]]`,
        date: dayjs('2024-03-01'),
        amount: 1,
      })
      tx.loaded = true
      transactions.push(tx)
    }
    wrapper = mount(TransactionsList, {
      shallow: true,
      props: { transactions },
      global: { provide: { [FOOTER_FOLD as symbol]: () => 'Scope.md' } },
    })
    await settle()
    const more = async () => {
      expect(scrollIntoView(wrapper!.find('.abele-transactions-list__sentinel').element)).toBe(1)
      await settle()
    }
    const toggle = async () => {
      wrapper!
        .findAllComponents(Icon)
        .find((c) => c.props('icon') === 'search')!
        .vm.$emit('click')
      await settle()
    }
    expect(shown()).toHaveLength(20)
    await more()
    expect(shown()).toHaveLength(40)
    const saved = store.app.loadLocalStorage(FOOTER_VIEW_KEY)
    expect(saved).toBeTruthy()
    await toggle()
    expect(shown()).toHaveLength(40) // An empty open field does not reset pagination.
    wrapper.findComponent(Search).vm.$emit('update:modelValue', 'Shared')
    await settle()
    vi.advanceTimersByTime(200)
    await settle()
    expect(shown()).toHaveLength(20)
    await more()
    await more()
    expect(shown()).toHaveLength(45)
    expect(store.app.loadLocalStorage(FOOTER_VIEW_KEY)).toEqual(saved)
    await toggle()
    expect(shown()).toHaveLength(40)
    expect(store.app.loadLocalStorage(FOOTER_VIEW_KEY)).toEqual(saved)
    resetFooterView()
    resetFooterFolds()
  })

  it.each([
    { accountPath: 'Salary.md', from: '[[Salary|Salary]]', to: undefined },
    { accountPath: 'Cash.md', from: undefined, to: '[[Cash|Cash]]' },
    { accountPath: 'Lent.md', from: undefined, to: '[[Lent|Lent]]' },
    { accountPath: 'Food.md', from: undefined, to: '[[Food|Food]]' },
    { accountPath: 'Missing.md', from: undefined, to: undefined },
    { accountPath: null, from: undefined, to: undefined },
  ])('prefills the date and correct side for $accountPath', async ({ accountPath, from, to }) => {
    const date = dayjs('2024-02-29')
    wrapper = mount(TransactionsList, {
      shallow: true,
      props: { transactions: [], accountPath, date },
    })
    await settle()
    expect(wrapper.find('.abele-transactions-list__empty').text()).toBe('No transactions.')
    wrapper
      .findAllComponents(Icon)
      .find((c) => c.props('icon') === 'banknote-arrow-down')!
      .vm.$emit('click')
    expect(createTransaction).toHaveBeenCalledWith({ date, from, to })
  })
})

describe.each(['sidebar', 'footer'] as const)(
  '%s day headings and transaction classification',
  (view) => {
    it('excludes asset transfers, keeps currencies separate and counts liabilities with current negative day signs', async () => {
      if (view === 'sidebar') await sidebar()
      else {
        wrapper = mount(TransactionsList, {
          shallow: true,
          props: { transactions: [...store.transactionsList.value!.transactions.values()] },
          global: { renderStubDefaultSlot: true },
        })
        await settle()
      }
      const types = Object.fromEntries(
        wrapper!
          .findAllComponents({ name: 'TransactionItem' })
          .map((c) => [c.props('transaction').transactionPath, c.props('txType')])
      )
      expect(types).toMatchObject({
        'income.md': 'income',
        'expense a.md': 'expense',
        'transfer.md': 'transfer',
        'lend.md': 'transfer',
        'return.md': 'transfer',
      })
      const heading = wrapper!
        .findAllComponents(DateDivider)
        .find((c) => c.props('date') === '2024-03-01')!
      expect(heading.text()).toContain(`+${formatAmount(83.7)} EUR`)
      expect(heading.text()).toContain(`${formatAmount(-3)} USD`)
      expect(
        wrapper!.findAllComponents(DateDivider).filter((c) => c.props('date') === '2024-03-01')
      ).toHaveLength(1)
    })

    it('sums the entire day even when only its first twenty transactions are drawn', async () => {
      const tl = store.transactionsList.value!
      const prototype = tl.transactions.get('expense a.md')!
      const dto = prototype.toCreateDTO()
      for (const old of tl.transactions.values()) old.cleanup()
      tl.transactions.clear()
      for (let i = 0; i < 25; i++) {
        await store.app.vault.create(`small ${i}.md`, '')
        const transaction = new Transaction({
          ...dto,
          wikilink: `[[small ${i}]]`,
          id: `small-${i}`,
          amount: 0.01,
        })
        transaction.loaded = true
        tl.transactions.set(`small ${i}.md`, transaction)
      }
      if (view === 'sidebar') await sidebar()
      else {
        wrapper = mount(TransactionsList, {
          shallow: true,
          props: { transactions: [...tl.transactions.values()] },
          global: { renderStubDefaultSlot: true },
        })
        await settle()
      }
      expect(wrapper!.findAllComponents({ name: 'TransactionItem' })).toHaveLength(20)
      expect(wrapper!.findComponent(DateDivider).text()).toContain(`${formatAmount(-0.25)} EUR`)
    })
  }
)
