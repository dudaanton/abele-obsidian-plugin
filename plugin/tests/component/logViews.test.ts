import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import dayjs from 'dayjs'
import LogView from '@/components/Log.vue'
import LogsList from '@/components/LogsList.vue'
import Markdown from '@/components/obsidian/Markdown.vue'
import Search from '@/components/obsidian/Search.vue'
import { Log } from '@/entities/Log'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { FOOTER_FOLD } from '@/composables/useFooterFold'
import { FOOTER_VIEW_KEY, resetFooterView } from '@/composables/useFooterView'
import { SEARCH_DELAY_MS } from '@/composables/useListSearch'
import { configureAbele, useVault } from '../helpers/testEnv'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

let wrapper: VueWrapper | undefined
let app: ReturnType<typeof useVault>
let logs: Log[]
beforeEach(() => {
  app = useVault([])
  configureAbele()
  logs = []
  resetFooterView()
  resetFakeIntersectionObservers()
  installFakeIntersectionObserver()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  logs.forEach((log) => log.cleanup())
  VaultWatcherWrapper.destroy()
  resetFooterView()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function renderLog(path: string, content: string, created?: string) {
  app = useVault([{ path, content, frontmatter: { type: 'log', created } }])
  const log = reactive(new Log(path)) as Log
  logs.push(log)
  const load = vi.spyOn(log, 'loadContent')
  wrapper = mount(LogView, { props: { log }, shallow: true })
  await nextTick()
  return { log, load }
}
async function revealLog() {
  expect(scrollIntoView(wrapper!.element)).toBe(1)
  await flushPromises()
}

describe('Log view', () => {
  it('loads metadata at mount but reads the body only on visibility, once', async () => {
    const { log, load } = await renderLog('Logs/Harvest.md', 'A small harvest.', '2024-02-29')
    expect(log.loaded).toBe(true)
    expect(load).not.toHaveBeenCalled()
    expect(wrapper!.find('.abele-log__file-content-wrapper').exists()).toBe(false)
    expect(app.stats.read).toBe(0)
    await revealLog()
    expect(wrapper!.findComponent('.abele-log__file-content').props('text')).toBe(
      'A small harvest.'
    )
    await revealLog()
    expect(load).toHaveBeenCalledTimes(1)
    expect(app.stats.read).toBe(1)
  })

  it.each([0, 1, 10, 11])('offers collapse only for more than ten lines (%s)', async (count) => {
    await renderLog('Logs/Harvest.md', Array.from({ length: count }, () => 'Line').join('\n'))
    await revealLog()
    expect(wrapper!.find('.abele-log__toggle').exists()).toBe(count > 10)
    expect(
      wrapper!
        .find('.abele-log__file-content')
        .classes()
        .includes('abele-log__file-content--collapsed')
    ).toBe(count > 10)
    if (count > 10) {
      await wrapper!.find('.abele-log__toggle').trigger('click')
      expect(wrapper!.find('.abele-log__file-content').classes()).not.toContain(
        'abele-log__file-content--collapsed'
      )
      await wrapper!.find('.abele-log__toggle').trigger('click')
      expect(wrapper!.find('.abele-log__file-content').classes()).toContain(
        'abele-log__file-content--collapsed'
      )
    }
  })

  it.each([
    ['Logs/Harvest.md', '2024-02-29', '[[2024-02-29|29.02.2024]]'],
    ['Logs/2024-02-29 Harvest.md', '2024-03-01', null],
    ['Logs/Harvest.md', undefined, null],
    ['Archive/2024-02-29/Harvest.md', '2024-03-01', null],
  ])('shows the separate date link for %s with created %s', async (path, created, expected) => {
    await renderLog(path, '', created)
    const date = wrapper!.findComponent('.abele-log__file-date')
    expect(date.exists()).toBe(expected !== null)
    if (expected) expect(date.props('text')).toBe(expected)
    expect(wrapper!.findAllComponents(Markdown)[0].props('text')).toBe(
      `[[${path}|${logs[0].name}]]`
    )
  })
})

function makeLogs(count: number) {
  logs = Array.from({ length: count }, (_, i) => {
    const log = new Log(`Logs/Entry ${i}.md`)
    log.createdAt = dayjs('2024-03-01').subtract(i, 'day')
    return log
  })
  app = useVault(logs.map((log) => ({ path: log.filePath, content: 'harvest' })))
  return logs
}
const shown = () =>
  wrapper!.findAllComponents(LogView).map((view) => (view.props('log') as Log).filePath)
async function more() {
  await nextTick()
  expect(scrollIntoView(wrapper!.find('.abele-logs-list__sentinel').element)).toBe(1)
  await nextTick()
}

describe('LogsList ordering and search page restoration', () => {
  it('sorts newest first without mutating input and retains equal-date input order', () => {
    const items = makeLogs(4)
    items[2].createdAt = items[0].createdAt
    const input = [items[3], items[0], items[2], items[1]]
    wrapper = mount(LogsList, { props: { logs: input }, shallow: true })
    expect(shown()).toEqual([items[0], items[2], items[1], items[3]].map((log) => log.filePath))
    expect(input.map((log) => log.filePath)).toEqual(
      [items[3], items[0], items[2], items[1]].map((log) => log.filePath)
    )
  })

  it('shows the empty-state message and no sentinel for no logs', () => {
    wrapper = mount(LogsList, { props: { logs: [] }, shallow: true })
    expect(shown()).toEqual([])
    expect(wrapper.find('.abele-logs-list__no-logs').text()).toBe('Nothing matches the search.')
    expect(wrapper.find('.abele-logs-list__sentinel').exists()).toBe(false)
  })

  it('opening an empty search keeps pages; search pages are not saved; closing restores them', async () => {
    vi.useFakeTimers()
    const items = makeLogs(85)
    const config = configureAbele()
    const previous = config.rememberNotePlaces
    config.rememberNotePlaces = true
    try {
      wrapper = mount(LogsList, {
        props: { logs: items },
        shallow: true,
        global: {
          stubs: { ListSectionHeader: false },
          provide: { [FOOTER_FOLD as symbol]: () => 'Notes/Orchard.md' },
        },
      })
      await more()
      expect(shown()).toHaveLength(40)
      const saved = structuredClone(app.loadLocalStorage(FOOTER_VIEW_KEY))
      await wrapper.find('.abele-logs-list__search-toggle').trigger('click')
      await flushPromises()
      expect(shown()).toHaveLength(40)
      wrapper.findComponent(Search).vm.$emit('update:modelValue', 'harvest')
      await nextTick()
      vi.advanceTimersByTime(SEARCH_DELAY_MS)
      await flushPromises()
      expect(shown()).toHaveLength(20)
      await more()
      await more()
      expect(shown()).toHaveLength(60)
      expect(app.loadLocalStorage(FOOTER_VIEW_KEY)).toEqual(saved)
      await wrapper.find('.abele-logs-list__search-toggle').trigger('click')
      expect(shown()).toHaveLength(40)
      expect(app.loadLocalStorage(FOOTER_VIEW_KEY)).toEqual(saved)
      expect(wrapper.findComponent(Search).exists()).toBe(false)
    } finally {
      config.rememberNotePlaces = previous
    }
  })
})
