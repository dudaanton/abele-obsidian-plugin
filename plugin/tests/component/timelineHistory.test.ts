import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import dayjs from 'dayjs'
import { useFakeClock } from '../helpers/fakeClock'
import { Menu, type MenuItem } from 'obsidian'
import Timeline from '@/components/Timeline.vue'
import Search from '@/components/obsidian/Search.vue'
import { Task } from '@/entities/Task'
import { configureAbele, useVault } from '../helpers/testEnv'
import { FOOTER_FOLD, FOOTER_FOLDS_KEY, resetFooterFolds } from '@/composables/useFooterFold'
import FoldHeading from '@/components/obsidian/FoldHeading.vue'
import { FOOTER_VIEW_KEY, resetFooterView } from '@/composables/useFooterView'
import {
  installFakeIntersectionObserver,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

vi.mock('@/composables/useDate', () => ({ useDate: () => ({ now: ref(dayjs('2030-06-15')) }) }))

const advance = useFakeClock()
let view: VueWrapper
const task = (name: string, date: string, done = false, due?: string) => {
  const t = new Task({ wikilink: `[[Sample/${name}]]` })
  t.loaded = true
  t.title = name
  t.date = dayjs(date)
  if (due) t.due = dayjs(due)
  if (done) t.completedAt = dayjs(date)
  return t
}
const days = () =>
  view.findAll('.abele-timeline__date-block').map((d) => d.attributes('data-abele-anchor'))
const render = (tasks: Task[]) => {
  view = mount(Timeline, { props: { tasks }, shallow: true, attachTo: document.body })
  return view
}
beforeEach(() => {
  useVault([])
  configureAbele()
  installFakeIntersectionObserver()
})
afterEach(() => view?.unmount())

describe('folded timeline history', () => {
  it('restores the same future page without rounding revealed history into extra future pages', async () => {
    useVault([])
    const config = configureAbele()
    const remembered = config.rememberNotePlaces
    config.rememberNotePlaces = true
    resetFooterView()
    resetFooterFolds()
    const tasks = [
      task('sample-yesterday', '2030-06-14'),
      ...Array.from({ length: 60 }, (_, i) =>
        task(`sample-future-${i}`, dayjs('2030-06-15').add(i, 'day').format('YYYY-MM-DD'))
      ),
    ]
    const open = () => {
      view = mount(Timeline, {
        props: { tasks },
        shallow: true,
        attachTo: document.body,
        global: { provide: { [FOOTER_FOLD as symbol]: () => 'Sample/group.md' } },
      })
    }
    try {
      open()
      await flushPromises()
      await view.find('.abele-timeline__history').trigger('click')
      await flushPromises()
      expect(days()).toHaveLength(21)
      const before = days()
      view.unmount()
      resetFooterView()
      open()
      await flushPromises()
      expect(days()).toEqual(before)
      await view.find('.abele-timeline__history').trigger('click')
      await flushPromises()
      expect(days()).toEqual(before.filter((date) => date !== 'date:2030-06-14'))
      view.unmount()
      resetFooterView()
      open()
      await flushPromises()
      expect(days()).toEqual(before.filter((date) => date !== 'date:2030-06-14'))
      expect(view.find('.abele-timeline__history').text()).toContain('Show all')
    } finally {
      config.rememberNotePlaces = remembered
      resetFooterView()
      resetFooterFolds()
    }
  })

  it('recreates revealed history after a footer unmounts, only when remembering places is enabled', async () => {
    const app = useVault([])
    const config = configureAbele()
    const remembered = config.rememberNotePlaces
    config.rememberNotePlaces = true
    resetFooterView()
    resetFooterFolds()
    const tasks = [task('sample-yesterday', '2030-06-14'), task('sample-today', '2030-06-15')]
    const open = () => {
      view = mount(Timeline, {
        props: { tasks },
        shallow: true,
        attachTo: document.body,
        global: { provide: { [FOOTER_FOLD as symbol]: () => 'Sample/group.md' } },
      })
    }
    try {
      open()
      await flushPromises()
      await view.find('.abele-timeline__history').trigger('click')
      await flushPromises()
      expect(days()).toEqual(['date:2030-06-14', 'date:2030-06-15'])
      expect(app.loadLocalStorage(FOOTER_VIEW_KEY)).toBeTruthy()
      view.unmount()
      resetFooterView()
      open()
      await flushPromises()
      expect(days()).toEqual(['date:2030-06-14', 'date:2030-06-15'])
      view.unmount()
      config.rememberNotePlaces = false
      open()
      await flushPromises()
      expect(days()).toEqual(['date:2030-06-15'])
    } finally {
      config.rememberNotePlaces = remembered
      resetFooterView()
      resetFooterFolds()
    }
  })

  it('does not build date ranges while a footer section is folded, even across loading batches', async () => {
    const app = useVault([])
    app.saveLocalStorage(FOOTER_FOLDS_KEY, { 'Sample/group.md': ['calendar'] })
    resetFooterFolds()
    const sample = task('sample-span', '2030-06-10', false, '2030-06-20')
    const dateRanges = vi.spyOn(sample, 'dates', 'get')
    view = mount(Timeline, {
      props: { tasks: [sample] },
      shallow: true,
      attachTo: document.body,
      global: { provide: { [FOOTER_FOLD as symbol]: () => 'Sample/group.md' } },
    })
    await flushPromises()
    expect(dateRanges).not.toHaveBeenCalled()
    for (let i = 0; i < 3; i++) {
      await view.setProps({ tasks: [sample, task(`sample-${i}`, '2030-06-15')] })
      await flushPromises()
      expect(dateRanges).not.toHaveBeenCalled()
    }
    view.findComponent(FoldHeading).vm.$emit('toggle')
    await flushPromises()
    expect(dateRanges).toHaveBeenCalled()
    expect(days()).toContain('date:2030-06-15')
    dateRanges.mockRestore()
    resetFooterFolds()
  })

  it('starts today and counts unfinished tasks once, even across several folded days', () => {
    render([
      task('sample-span', '2030-06-10', false, '2030-06-12'),
      task('sample-old', '2030-06-14'),
      task('sample-done', '2030-06-13', true),
      task('sample-today', '2030-06-15'),
    ])
    expect(days()).toEqual(['date:2030-06-15'])
    expect(view.find('.abele-timeline__history').text()).toContain('2 unfinished')
  })

  it('reveals every past day on one banner click, never on upward or downward scrolling', async () => {
    render([
      task('sample-a', '2030-06-13'),
      task('sample-b', '2030-06-14'),
      task('sample-c', '2030-06-15'),
    ])
    await flushPromises()
    const strip = view.find('.abele-timeline__history')
    expect(strip.text()).toContain('2 unfinished')
    await view.trigger('wheel', { deltaY: 80 })
    await view.trigger('wheel', { deltaY: -80 })
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-15'])
    await strip.trigger('click')
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-13', 'date:2030-06-14', 'date:2030-06-15'])
    expect(strip.text()).toContain('2 unfinished · Hide all')
    await strip.trigger('click')
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-15'])
    expect(strip.text()).toContain('2 unfinished · Show all')
  })

  it('does not reset future pages or unfold old completed-only days on a completed toggle', async () => {
    render([
      task('sample-old-done', '2020-01-01', true),
      ...Array.from({ length: 60 }, (_, i) =>
        task(`sample-${i}`, dayjs('2030-06-15').add(i, 'day').format('YYYY-MM-DD'))
      ),
    ])
    await flushPromises()
    expect(scrollIntoView(view.find('.abele-timeline__sentinel').element)).toBe(1)
    await flushPromises()
    expect(days()).toHaveLength(40)
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(days()).toHaveLength(40)
    expect(days()[0]).toBe('date:2030-06-15')
    expect(view.find('.abele-timeline__history').text()).toContain('0 unfinished')
  })

  it('keeps revealed history when completed-only days appear between it and today', async () => {
    render([
      task('sample-old', '2030-06-12'),
      task('sample-done', '2030-06-13', true),
      task('sample-today', '2030-06-15'),
    ])
    await flushPromises()
    await view.find('.abele-timeline__history').trigger('click')
    await flushPromises()
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-12', 'date:2030-06-13', 'date:2030-06-15'])
  })

  it('keeps history folded on upward input inside a short pane with a calendar above it', async () => {
    render([task('sample-old', '2030-06-14'), task('sample-today', '2030-06-15')])
    await flushPromises()
    // Input geometry, not happy-dom layout: a short pane has its timeline halfway down,
    // but no scroll range with which to bring that first date to the viewport's top.
    const owner = view.element as HTMLElement
    Object.defineProperty(owner, 'clientHeight', { value: 1000 })
    Object.defineProperty(owner, 'scrollHeight', { value: 1000 })
    vi.spyOn(owner, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 1000))
    vi.spyOn(
      view.find('.abele-timeline__history').element,
      'getBoundingClientRect'
    ).mockReturnValue(new DOMRect(0, 400, 300, 50))
    vi.spyOn(
      view.find('.abele-timeline__date-block').element,
      'getBoundingClientRect'
    ).mockReturnValue(new DOMRect(0, 450, 300, 100))
    await view.trigger('wheel', { deltaY: -80 })
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-15'])
    expect(view.find('.abele-timeline__history').text()).toContain('1 unfinished')
  })

  it('keeps a past-only list folded on touch and reveals it all on a click', async () => {
    render([task('sample-a', '2030-06-12'), task('sample-b', '2030-06-14')])
    await flushPromises()
    expect(days()).toEqual([])
    await view.trigger('touchstart', { touches: [{ clientY: 100 }] })
    await view.trigger('touchmove', { touches: [{ clientY: 150 }] })
    await flushPromises()
    expect(days()).toEqual([])
    expect(view.find('.abele-timeline__history').text()).toContain('2 unfinished')
    await view.find('.abele-timeline__history').trigger('click')
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-12', 'date:2030-06-14'])
    expect(view.find('.abele-timeline__history').text()).toContain('2 unfinished · Hide all')
    await view.find('.abele-timeline__history').trigger('click')
    await flushPromises()
    expect(days()).toEqual([])
    expect(view.find('.abele-timeline__history').text()).toContain('2 unfinished · Show all')
  })

  it.each([false, true])(
    'includes older completed-only days and late arrivals when completed is enabled before reveal: %s',
    async (completedFirst) => {
      const tasks = [
        task('sample-old-done', '2020-01-01', true),
        task('sample-old', '2030-06-12'),
        task('sample-today', '2030-06-15'),
      ]
      render(tasks)
      await flushPromises()
      if (completedFirst) {
        await view.find('.abele-timeline__completed-toggle').trigger('click')
        await flushPromises()
        expect(days()).toEqual(['date:2030-06-15'])
      }
      await view.find('.abele-timeline__history').trigger('click')
      await flushPromises()
      if (!completedFirst) {
        await view.find('.abele-timeline__completed-toggle').trigger('click')
        await flushPromises()
      }
      expect(days()).toEqual(['date:2020-01-01', 'date:2030-06-12', 'date:2030-06-15'])
      await view.setProps({ tasks: [task('sample-arrival', '2019-01-01'), ...tasks] })
      await flushPromises()
      expect(days()[0]).toBe('date:2019-01-01')
      expect(view.find('.abele-timeline__history').text()).toContain('2 unfinished · Hide all')
      await view.find('.abele-timeline__history').trigger('click')
      await flushPromises()
      expect(days()).toEqual(['date:2030-06-15'])
    }
  )

  it.each(['Enter', ' '])('reveals all history with the banner keyboard action %s', async (key) => {
    render([task('sample-old', '2030-06-14'), task('sample-today', '2030-06-15')])
    await flushPromises()
    const banner = view.find('.abele-timeline__history')
    expect(banner.attributes('role')).toBe('button')
    expect(banner.attributes('tabindex')).toBe('0')
    await banner.trigger('keydown', { key })
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-14', 'date:2030-06-15'])
    expect(banner.attributes('aria-expanded')).toBe('true')
    expect(banner.attributes('aria-label')).toBe('Hide all past days')
    await banner.trigger('keydown', { key })
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-15'])
    expect(banner.attributes('aria-expanded')).toBe('false')
    expect(banner.attributes('aria-label')).toBe('Show all past days')
  })

  it('keeps a late future day mounted when new completed-only dates appear before it', async () => {
    render(
      Array.from({ length: 80 }, (_, i) =>
        task(`sample-${i}`, dayjs('2030-06-15').add(i, 'day').format('YYYY-MM-DD'), i % 2 === 1)
      )
    )
    await flushPromises()
    expect(scrollIntoView(view.find('.abele-timeline__sentinel').element)).toBe(1)
    await flushPromises()
    const last = days().at(-1)
    expect(days()).toHaveLength(40)
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(days().at(-1)).toBe(last)
    expect(days()).toHaveLength(79)
  })

  it('shows a first past search result that arrives after the query settled', async () => {
    render([])
    await view.find('.abele-timeline__search-toggle').trigger('click')
    view.findComponent(Search).vm.$emit('update:modelValue', 'sample-old')
    await advance(250)
    await flushPromises()
    expect(days()).toEqual([])
    await view.setProps({ tasks: [task('sample-old', '2030-06-12')] })
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-12'])
  })

  it('keeps a matching past day visible when a label is selected during a search', async () => {
    const old = task('sample-old', '2030-06-12')
    old.oldProps = { labels: ['sample-label'] }
    render([old, task('sample-today', '2030-06-15')])
    await view.find('.abele-timeline__search-toggle').trigger('click')
    view.findComponent(Search).vm.$emit('update:modelValue', 'sample-old')
    await advance(250)
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-12'])
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    await view.find('.abele-task-label-filter').trigger('click')
    const menu = shown.mock.contexts[0] as unknown as { items: MenuItem[] }
    const label = menu.items.find((item) => item.title === 'sample-label (1)')
    expect(label).toBeDefined()
    label!.handler?.()
    shown.mockRestore()
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-12'])
  })

  it('lets a title search find a folded task', async () => {
    render([task('sample-old', '2030-06-12'), task('sample-today', '2030-06-15')])
    await view.find('.abele-timeline__search-toggle').trigger('click')
    view.findComponent(Search).vm.$emit('update:modelValue', 'sample-old')
    await advance(250)
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-12'])
  })
})
