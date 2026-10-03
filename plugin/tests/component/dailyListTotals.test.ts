import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import TransactionsList from '@/components/TransactionsList.vue'
import TimeEntryListView from '@/components/TimeEntryListView.vue'
import DateDivider from '@/components/obsidian/DateDivider.vue'
import { configureAbele, useVault } from '../helpers/testEnv'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'

vi.mock('@/bases/echarts', () => ({
  echartsInit: () => ({
    setOption() {},
    clear() {},
    resize() {},
    dispose() {},
    isDisposed: () => false,
  }),
  getThemeColors: () => ({}),
}))

let view: VueWrapper | undefined
beforeEach(() => {
  configureAbele()
  useVault([])
  installFakeIntersectionObserver()
})
afterEach(() => view?.unmount())

describe('daily totals over the complete filtered list', () => {
  it('buckets transactions once, not once per visible day', () => {
    let dates = 0
    const transactions = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      transactionPath: `Samples/tx-${i}.md`,
      amount: 0.1,
      currency: 'EUR',
      from: null,
      to: null,
      get date() {
        dates++
        return dayjs('2024-05-31').subtract(i, 'day')
      },
    }))
    view = mount(TransactionsList, {
      props: { transactions: transactions as never },
      global: { stubs: { TransactionItem: true } },
    })
    expect(view.findAllComponents(DateDivider)).toHaveLength(20)
    expect(view.findComponent(DateDivider).text()).toContain('-0.10 EUR')
    expect(dates).toBeLessThan(1000)
  })

  it('reuses time buckets for headings, total and chart', () => {
    let starts = 0
    const timeEntries = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      duration: 90,
      entryPath: `Samples/time-${i}.md`,
      get start() {
        starts++
        return dayjs()
          .startOf('month')
          .add(i % 28, 'day')
      },
    }))
    view = mount(TimeEntryListView, {
      props: { timeEntries: timeEntries as never },
      global: { stubs: { TimeEntryItem: true } },
    })
    expect(view.find('.abele-time-entries-list__header-total').text()).toBe('2h 30m')
    expect(view.findAllComponents(DateDivider).length).toBeGreaterThan(1)
    expect(starts).toBeLessThan(1000)
  })
})
