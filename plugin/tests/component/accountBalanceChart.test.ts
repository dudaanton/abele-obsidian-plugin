import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick, toRaw } from 'vue'
import dayjs from 'dayjs'
import AccountBalanceChart from '@/components/AccountBalanceChart.vue'
import PeriodSelector from '@/components/obsidian/PeriodSelector.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { formatAmount } from '@/helpers/moneyFormat'
import { useVault } from '../helpers/testEnv'
import type { FakeFileSpec } from '../helpers/fakeVault'

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  clear: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  isDisposed: () => false,
}))
const init = vi.hoisted(() => vi.fn())
vi.mock('@/bases/echarts', () => ({
  echartsInit: (...args: unknown[]) => {
    init(...args)
    return chart
  },
}))
const store = GlobalStore.getInstance()
let wrapper: VueWrapper | undefined
const account = (name: string, fm = {}): FakeFileSpec => ({
  path: `${name}.md`,
  frontmatter: { type: 'account', accountType: 'asset', currency: 'EUR', ...fm },
})
const tx = (name: string, fm = {}): FakeFileSpec => ({
  path: `${name}.md`,
  frontmatter: {
    type: 'transaction',
    date: '2024-03-01',
    from: '[[Cash]]',
    to: '[[Food]]',
    amount: 0.1,
    currency: 'EUR',
    ...fm,
  },
})
beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Moscow')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2024-03-01T00:15:00+03:00'))
  useVault([
    account('Cash', { startingBalance: 10.1 }),
    account('Debt', { accountType: 'liability', startingBalance: -2.1 }),
    account('Food', { accountType: 'expense', currency: null }),
    account('Salary', { accountType: 'revenue', currency: null }),
    account('Combined', {
      accountType: 'computed',
      accounts: ['[[Cash]]', '[[Debt]]', '[[Missing]]'],
    }),
    account('Broken', { accountType: 'computed', accounts: ['[[Missing]]'] }),
    tx('first'),
    tx('second', { amount: 0.2 }),
    tx('dollars', { amount: 2, currency: 'USD' }),
    tx('salary', { from: '[[Salary]]', to: '[[Cash]]', amount: 5 }),
    tx('before', { date: '2024-02-29', amount: 1 }),
    tx('after', { date: '2024-04-01', amount: 50 }),
    tx('undated', { date: null }),
    tx('no amount', { amount: null }),
    tx('no currency', { currency: null, amount: 0 }),
  ])
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
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
async function settle() {
  await nextTick()
  await flushPromises()
  await nextTick()
}
async function show(accountPath: string) {
  wrapper = mount(AccountBalanceChart, { shallow: true, props: { accountPath } })
  await settle()
}
function option() {
  return chart.setOption.mock.calls.at(-1)![0]
}
async function period(start: string, end: string) {
  const p = wrapper!.findComponent(PeriodSelector)
  p.vm.$emit('update:start', dayjs(start))
  p.vm.$emit('update:end', dayjs(end))
  await settle()
}

describe('AccountBalanceChart — data handed to ECharts', () => {
  it('draws an inclusive local-month balance line and emits its initial period', async () => {
    await show('Cash.md')
    expect(wrapper!.find('.abele-account-balance-chart__header-text').text()).toBe('Balance')
    const o = option()
    expect(o.series).toHaveLength(1)
    expect(o.series[0]).toMatchObject({ name: 'EUR', type: 'line' })
    expect(o.series[0].data).toEqual(Array(31).fill(11.8))
    expect(o.legend).toBeUndefined()
    expect(o.xAxis.data).toHaveLength(31)
    expect(o.xAxis.axisLabel).toMatchObject({ hideOverlap: true, rotate: 45 })
    expect(o.tooltip.valueFormatter(-0.001)).toBe(formatAmount(0))
    const emitted = wrapper!.emitted('periodChange')![0] as dayjs.Dayjs[]
    expect(emitted.map((d) => d.format('YYYY-MM-DD'))).toEqual(['2024-03-01', '2024-03-31'])
    await period('2024-02-29', '2024-03-01')
    expect(option().series[0].data).toEqual([9.1, 11.8])
    expect(option().xAxis.axisLabel.rotate).toBeUndefined()
  })

  it('renders per-currency daily spending bars, zero-fills dates and sums only the chosen period', async () => {
    await show('Food.md')
    expect(wrapper!.find('.abele-account-balance-chart__header-text').text()).toBe('Spending')
    expect(
      option().series.map((s: { name: string; type: string; data: number[]; stack: string }) => ({
        name: s.name,
        type: s.type,
        data: s.data.slice(0, 2),
        stack: s.stack,
      }))
    ).toEqual([
      { name: 'EUR', type: 'bar', data: [0.3, 0], stack: 'total' },
      { name: 'USD', type: 'bar', data: [2, 0], stack: 'total' },
    ])
    expect(option().legend.data).toEqual(['EUR', 'USD'])
    expect(wrapper!.find('.abele-account-balance-chart__totals').text()).toContain(
      `${formatAmount(0.3)} EUR`
    )
    expect(wrapper!.find('.abele-account-balance-chart__totals').text()).toContain(
      `${formatAmount(2)} USD`
    )
    await period('2024-02-29', '2024-02-29')
    expect(option().series).toMatchObject([{ name: 'EUR', data: [1] }])
    expect(option().legend).toBeUndefined()
  })

  it('counts revenue as positive daily activity rather than its negative ledger balance', async () => {
    await show('Salary.md')
    expect(option().series[0]).toMatchObject({
      name: 'EUR',
      type: 'bar',
      data: [5, ...Array(30).fill(0)],
    })
    expect(wrapper!.find('.abele-account-balance-chart__totals').text()).toContain(formatAmount(5))
  })

  it('sums computed source balances, including negative debt, while skipping unresolved sources', async () => {
    await show('Combined.md')
    expect(option().series[0]).toMatchObject({
      type: 'line',
      name: 'EUR',
      data: Array(31).fill(9.7),
    })
    expect(wrapper!.find('.abele-account-balance-chart__totals').exists()).toBe(false)
    await wrapper!.setProps({ accountPath: 'Broken.md' })
    await settle()
    expect(chart.clear).toHaveBeenCalled()
  })

  it('pins duplicate computed sources being counted twice and non-recursive computed sources', async () => {
    const combined = store.accountsList.value!.accounts.get('Combined.md')!
    combined.sourceAccounts = ['[[Cash]]', '[[Cash]]', '[[Broken]]']
    await show('Combined.md')
    expect(option().series[0].data[0]).toBe(23.6)
  })

  it('clears absent-account, empty-period and missing-index charts rather than drawing stale data', async () => {
    await show('Missing.md')
    expect(chart.setOption).not.toHaveBeenCalled()
    expect(chart.clear).toHaveBeenCalled()
    await wrapper!.setProps({ accountPath: 'Cash.md' })
    await settle()
    expect(chart.setOption).toHaveBeenCalled()
    await period('2024-03-02', '2024-03-01')
    const calls = chart.clear.mock.calls.length
    expect(calls).toBeGreaterThan(1)
    store.balanceIndex.value!.cleanup()
    store.balanceIndex.value = null
    await settle()
    expect(chart.clear.mock.calls.length).toBeGreaterThan(calls)
  })

  it('updates after balance version changes and disposes/recreates the chart on a theme change', async () => {
    await show('Cash.md')
    store.transactionsList.value!.transactions.get('first.md')!.amount = 0.2
    toRaw(store.balanceIndex.value!).rebuild()
    await settle()
    expect(option().series[0].data[0]).toBe(11.7)
    store.themeVersion.value++
    await settle()
    expect(chart.dispose).toHaveBeenCalledTimes(1)
    expect(init).toHaveBeenCalledTimes(2)
    wrapper!.unmount()
    wrapper = undefined
    expect(chart.dispose).toHaveBeenCalledTimes(2)
  })
})
