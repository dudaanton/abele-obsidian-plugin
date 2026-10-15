import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config as mountConfig, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import dayjs from 'dayjs'
import TimeTrackingSidebar from '@/components/TimeTrackingSidebar.vue'
import PeriodSelector from '@/components/obsidian/PeriodSelector.vue'
import Tabs from '@/components/obsidian/Tabs.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { configureAbele, useVault } from '../helpers/testEnv'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'

vi.mock('@/bases/echarts', () => ({
  echartsInit: () => ({
    on() {},
    setOption() {},
    clear() {},
    resize() {},
    dispose() {},
    isDisposed: () => false,
  }),
  getThemeColors: () => ({}),
}))

const store = GlobalStore.getInstance()
const originalStubs = mountConfig.global.stubs
let view: VueWrapper | undefined

beforeEach(() => {
  mountConfig.global.stubs = { ...originalStubs, Section: false, EmptyState: false }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2024-03-10T12:00:00'))
  configureAbele()
  useVault([])
  installFakeIntersectionObserver()
  // Two entries in March, none in any other month.
  const entries = new Map(
    [1, 2].map((i) => [
      `Samples/time-${i}.md`,
      {
        id: String(i),
        duration: 1800,
        entryPath: `Samples/time-${i}.md`,
        groups: [],
        entryNotFound: false,
        start: dayjs('2024-03-05T09:00:00').add(i, 'day'),
      },
    ])
  )
  store.timeEntryList.value = { entries, activeEntries: [] } as never
})
afterEach(() => {
  view?.unmount()
  view = undefined
  store.timeEntryList.value = null
  mountConfig.global.stubs = originalStubs
  vi.useRealTimers()
})

async function settle() {
  await nextTick()
  await flushPromises()
  await nextTick()
}
async function period(start: string, end: string) {
  const picker = view!.findComponent(PeriodSelector)
  picker.vm.$emit('update:start', dayjs(start))
  picker.vm.$emit('update:end', dayjs(end))
  await settle()
}
const sectionTitles = () => view!.findAll('.abele-section__heading').map((t) => t.text())

describe('time tracking — a period with nothing tracked', () => {
  it('says so once, instead of a zero total, the chart tabs, "No data" and an empty Entries list', async () => {
    view = mount(TimeTrackingSidebar, { global: { stubs: { TimeEntryItem: true } } })
    await settle()
    expect(view.find('.abele-time-tracking-sidebar__summary').exists()).toBe(true)
    expect(view.findAllComponents(Tabs)).toHaveLength(1)

    await period('2024-05-01', '2024-05-31')
    expect(view.find('.abele-time-tracking-sidebar__summary').exists()).toBe(false)
    expect(view.findAllComponents(Tabs)).toHaveLength(0)
    expect(view.text()).not.toContain('No data')
    expect(view.text()).not.toContain('No entries found')
    expect(sectionTitles()).not.toContain('Entries')
    expect(view.find('.abele-time-tracking-sidebar__period-empty').text()).toBe(
      'Nothing tracked in May 2024'
    )

    // Back in a month with entries, all of it returns.
    await period('2024-03-01', '2024-03-31')
    expect(view.find('.abele-time-tracking-sidebar__period-empty').exists()).toBe(false)
    expect(view.find('.abele-time-tracking-sidebar__summary-value').text()).toBe('1h 0m')
  })
})
