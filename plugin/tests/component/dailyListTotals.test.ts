import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import TransactionsList from '@/components/TransactionsList.vue'
import TimeEntryListView from '@/components/TimeEntryListView.vue'
import TimeTrackingSidebar from '@/components/TimeTrackingSidebar.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import DateDivider from '@/components/obsidian/DateDivider.vue'
import Chart from '@/components/obsidian/Chart.vue'
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

  it('also buckets sidebar time headings once without changing the hour display', () => {
    let starts = 0
    const entries = new Map(
      Array.from({ length: 100 }, (_, i) => [
        `Samples/time-${i}.md`,
        {
          id: String(i),
          duration: 90,
          entryPath: `Samples/time-${i}.md`,
          groups: [],
          entryNotFound: false,
          get start() {
            starts++
            return dayjs()
              .startOf('month')
              .add(i % 28, 'day')
          },
        },
      ])
    )
    GlobalStore.getInstance().timeEntryList.value = { entries, activeEntries: [] } as never
    view = mount(TimeTrackingSidebar, { global: { stubs: { TimeEntryItem: true } } })
    expect(view.find('.abele-time-tracking-sidebar__summary-value').text()).toBe('2h 30m')
    expect(starts).toBeLessThan(1000)
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

describe('the time spent in a period', () => {
  const entry = (id: string, day: number, duration: number) => ({
    id,
    duration,
    entryPath: `Samples/time-${id}.md`,
    start: dayjs().startOf('month').add(day, 'day').hour(9),
  })

  it('charts every day of the period, the empty ones as zero', () => {
    view = mount(TimeEntryListView, {
      props: { timeEntries: [entry('a', 2, 3600), entry('b', 2, 1800)] as never },
      global: { stubs: { TimeEntryItem: true } },
    })
    const source = view.findComponent(Chart).props('source') as { date: string; hours: number }[]
    expect(source).toHaveLength(dayjs().daysInMonth())
    expect(source.filter((d) => d.hours > 0)).toEqual([
      { date: dayjs().startOf('month').add(2, 'day').format('YYYY-MM-DD'), hours: 1.5 },
    ])
  })

  it('draws no chart when nothing was spent in the period', () => {
    view = mount(TimeEntryListView, {
      props: { timeEntries: [entry('a', 2, 0)] as never },
      global: { stubs: { TimeEntryItem: true } },
    })
    expect(view.findComponent(Chart).exists()).toBe(false)
  })

  it("gives a day's total in its heading only when it has more than one entry", () => {
    view = mount(TimeEntryListView, {
      props: {
        timeEntries: [entry('a', 2, 3600), entry('b', 2, 1800), entry('c', 4, 600)] as never,
      },
      global: { stubs: { TimeEntryItem: true } },
    })
    const headings = view.findAllComponents(DateDivider)
    expect(headings).toHaveLength(2)
    const total = (h: (typeof headings)[number]) =>
      h.find('.abele-date-divider__summary').exists()
        ? h.find('.abele-date-divider__summary').text()
        : ''
    // Newest first: the day with one entry says nothing more, the day with two their sum.
    expect(headings.map(total)).toEqual(['', '1h 30m'])
  })
})
