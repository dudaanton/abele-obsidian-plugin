import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config as mountConfig, mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import dayjs from 'dayjs'
import { useFakeClock } from '../helpers/fakeClock'
import { Menu, type MenuItem } from 'obsidian'
import Timeline from '@/components/Timeline.vue'
import TaskView from '@/components/Task.vue'
import Markdown from '@/components/obsidian/Markdown.vue'
import Search from '@/components/obsidian/Search.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import Button from '@/components/obsidian/Button.vue'
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
const overdueRow = () => view.find('.abele-timeline__overdue')
const headerCount = () => String(view.findComponent(FoldHeading).props('count'))
const render = (tasks: Task[]) => {
  view = mount(Timeline, { props: { tasks }, shallow: true, attachTo: document.body })
  return view
}
const originalStubs = mountConfig.global.stubs
beforeEach(() => {
  mountConfig.global.stubs = { ...originalStubs, ListSectionHeader: false, EmptyState: false }
  useVault([])
  configureAbele()
  installFakeIntersectionObserver()
})
afterEach(() => {
  view?.unmount()
  mountConfig.global.stubs = originalStubs
})

// The past used to have a "Past days" fold of its own beside Overdue. It is gone: what was done
// in the past is in the list exactly while the completed switch shows done tasks, in date order
// above the Overdue row, and Overdue is the only fold left above today.
describe('folded timeline history', () => {
  // Completed tasks used to stay in the past days whatever the switch said, so the past could
  // not be cleared of them; now the switch hides them everywhere, past days included.
  it('hides completed tasks in every day while the switch is off, past days included', async () => {
    render([
      task('sample-completed-span', '2030-06-14', true, '2030-06-16'),
      task('sample-completed-today', '2030-06-15', true),
      task('sample-completed-future', '2030-06-16', true),
      task('sample-open-today', '2030-06-15'),
    ])
    await flushPromises()
    expect(view.find('.abele-timeline__history').exists()).toBe(false)
    expect(days()).toEqual(['date:2030-06-15'])
    expect(view.findAllComponents(TaskView).map((row) => row.props('task').title)).toEqual([
      'sample-open-today',
    ])
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    // Shown, the done past day is in the list at once, with no fold to open.
    expect(days()).toEqual(['date:2030-06-14', 'date:2030-06-15'])
    expect(view.find('.abele-timeline__history').exists()).toBe(false)
    // The switch preserves the date boundary already read; page forward to the new future day.
    expect(scrollIntoView(view.find('.abele-timeline__sentinel').element)).toBe(1)
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-14', 'date:2030-06-15', 'date:2030-06-16'])
  })

  it('names near days first and includes the year only outside the current year', () => {
    render([task('sample-tomorrow', '2030-06-16'), task('sample-next-year', '2031-06-16')])
    const labels = view.findAllComponents(Markdown).map((row) => row.props('text'))
    expect(labels).toContain('[[2030-06-16|Tomorrow · Sun 16.06]]')
    expect(labels).toContain('[[2031-06-16|Mon 16.06.2031]]')
  })

  it('restores the same future page without rounding shown past days into extra future pages', async () => {
    useVault([])
    const config = configureAbele()
    const remembered = config.rememberNotePlaces
    config.rememberNotePlaces = true
    resetFooterView()
    resetFooterFolds()
    // A done task: in the list while done tasks are shown; what was not done is Overdue's.
    const tasks = [
      task('sample-yesterday', '2030-06-14', true),
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
    const showCompleted = async () => {
      await view.find('.abele-timeline__completed-toggle').trigger('click')
      await flushPromises()
    }
    try {
      open()
      await flushPromises()
      await showCompleted()
      expect(days()).toHaveLength(21)
      const before = days()
      view.unmount()
      resetFooterView()
      open()
      await flushPromises()
      await showCompleted()
      expect(days()).toEqual(before)
      // Hidden again, the done past day goes and the future page stays as it was.
      await showCompleted()
      expect(days()).toEqual(before.filter((date) => date !== 'date:2030-06-14'))
      view.unmount()
      resetFooterView()
      open()
      await flushPromises()
      expect(days()).toEqual(before.filter((date) => date !== 'date:2030-06-14'))
    } finally {
      config.rememberNotePlaces = remembered
      resetFooterView()
      resetFooterFolds()
    }
  })

  // The past is no fold to remember any more; the switch it follows starts hiding done tasks.
  it('starts a remounted footer with done past days hidden, whether places are remembered or not', async () => {
    const app = useVault([])
    const config = configureAbele()
    const remembered = config.rememberNotePlaces
    config.rememberNotePlaces = true
    resetFooterView()
    resetFooterFolds()
    // Done, so it is in the list only while done tasks are shown; Overdue's fold is remembered
    // on its own (below).
    const tasks = [task('sample-yesterday', '2030-06-14', true), task('sample-today', '2030-06-15')]
    const open = async () => {
      view = mount(Timeline, {
        props: { tasks },
        shallow: true,
        attachTo: document.body,
        global: { provide: { [FOOTER_FOLD as symbol]: () => 'Sample/group.md' } },
      })
      await flushPromises()
    }
    try {
      await open()
      await view.find('.abele-timeline__completed-toggle').trigger('click')
      await flushPromises()
      expect(days()).toEqual(['date:2030-06-14', 'date:2030-06-15'])
      // Showing done tasks is not a place in the note: nothing about it is stored.
      expect(app.loadLocalStorage(FOOTER_VIEW_KEY)).toBeFalsy()
      view.unmount()
      resetFooterView()
      await open()
      expect(days()).toEqual(['date:2030-06-15'])
      view.unmount()
      config.rememberNotePlaces = false
      await open()
      expect(days()).toEqual(['date:2030-06-15'])
    } finally {
      config.rememberNotePlaces = remembered
      resetFooterView()
      resetFooterFolds()
    }
  })

  // A place saved on an overdue row is only there to return to if its fold opens again.
  it('recreates an open overdue fold after a footer unmounts, apart from past days', async () => {
    useVault([])
    const config = configureAbele()
    const remembered = config.rememberNotePlaces
    config.rememberNotePlaces = true
    resetFooterView()
    resetFooterFolds()
    const tasks = [
      task('sample-left', '2030-06-13'),
      task('sample-yesterday', '2030-06-14', true),
      task('sample-today', '2030-06-15'),
    ]
    const open = async () => {
      view = mount(Timeline, {
        props: { tasks },
        shallow: true,
        attachTo: document.body,
        global: { provide: { [FOOTER_FOLD as symbol]: () => 'Sample/group.md' } },
      })
      await flushPromises()
    }
    try {
      await open()
      await overdueRow().trigger('click')
      await flushPromises()
      expect(days()).toEqual(['date:2030-06-13', 'date:2030-06-15'])
      view.unmount()
      resetFooterView()
      await open()
      expect(overdueRow().attributes('aria-expanded')).toBe('true')
      expect(days()).toEqual(['date:2030-06-13', 'date:2030-06-15'])
      await view.find('.abele-timeline__completed-toggle').trigger('click')
      await flushPromises()
      // The done day comes in above the Overdue row; the fold keeps only what was left undone.
      expect(days()).toEqual(['date:2030-06-14', 'date:2030-06-13', 'date:2030-06-15'])
      await overdueRow().trigger('click')
      await flushPromises()
      view.unmount()
      resetFooterView()
      await open()
      expect(overdueRow().attributes('aria-expanded')).toBe('false')
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
    // Overdue is the only row above today, with its own count; no row for the past days.
    expect(overdueRow().text()).toBe('Overdue2')
    expect(overdueRow().find('.abele-timeline__overdue-count').attributes('aria-label')).toBe(
      '2 unfinished'
    )
    expect(view.find('.abele-timeline__history').exists()).toBe(false)
  })

  it('counts in the heading only what is shown: today on, Overdue while open, done past while shown', async () => {
    render([
      task('sample-span', '2030-06-10', false, '2030-06-12'),
      task('sample-old', '2030-06-14'),
      task('sample-done', '2030-06-13', true),
      task('sample-today', '2030-06-15'),
      task('sample-later', '2030-06-20', false, '2030-06-22'),
    ])
    await flushPromises()
    expect(headerCount()).toBe('2')
    await overdueRow().trigger('click')
    await flushPromises()
    expect(headerCount()).toBe('4')
    // Shown, the done day is in the list, so it is counted.
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(headerCount()).toBe('5')
    await overdueRow().trigger('click')
    await flushPromises()
    expect(headerCount()).toBe('3')
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(headerCount()).toBe('2')
  })

  // What was left undone opens from its own row now, not with the rest of the past.
  it('reveals every overdue day on one row click, never on upward or downward scrolling', async () => {
    render([
      task('sample-a', '2030-06-13'),
      task('sample-b', '2030-06-14'),
      task('sample-c', '2030-06-15'),
    ])
    await flushPromises()
    const strip = overdueRow()
    expect(strip.text()).toBe('Overdue2')
    expect(strip.find('.abele-timeline__overdue-count').attributes('aria-label')).toBe(
      '2 unfinished'
    )
    await view.trigger('wheel', { deltaY: 80 })
    await view.trigger('wheel', { deltaY: -80 })
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-15'])
    await strip.trigger('click')
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-13', 'date:2030-06-14', 'date:2030-06-15'])
    expect(strip.text()).toBe('Overdue2')
    expect(strip.find('.abele-timeline__overdue-count').attributes('aria-label')).toBe(
      '2 unfinished'
    )
    expect(strip.attributes('aria-expanded')).toBe('true')
    await strip.trigger('click')
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-15'])
    expect(strip.text()).toBe('Overdue2')
    expect(strip.find('.abele-timeline__overdue-count').attributes('aria-label')).toBe(
      '2 unfinished'
    )
    expect(strip.attributes('aria-expanded')).toBe('false')
  })

  it('does not reset future pages when a completed toggle brings old completed-only days in', async () => {
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
    const last = days().at(-1)
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(days()).toHaveLength(41)
    expect(days().slice(0, 2)).toEqual(['date:2020-01-01', 'date:2030-06-15'])
    expect(days().at(-1)).toBe(last)
    expect(view.find('.abele-timeline__history').exists()).toBe(false)
  })

  // Completed-only days come in with the switch, above the Overdue row, while the fold keeps its
  // own rows under it: the done day, then the overdue one, then today.
  it('keeps Overdue open when completed-only days appear', async () => {
    render([
      task('sample-old', '2030-06-12'),
      task('sample-done', '2030-06-13', true),
      task('sample-today', '2030-06-15'),
    ])
    await flushPromises()
    await overdueRow().trigger('click')
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-12', 'date:2030-06-15'])
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(overdueRow().attributes('aria-expanded')).toBe('true')
    expect(days()).toEqual(['date:2030-06-13', 'date:2030-06-12', 'date:2030-06-15'])
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
    vi.spyOn(overdueRow().element, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 400, 300, 50)
    )
    vi.spyOn(
      view.find('.abele-timeline__date-block').element,
      'getBoundingClientRect'
    ).mockReturnValue(new DOMRect(0, 450, 300, 100))
    await view.trigger('wheel', { deltaY: -80 })
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-15'])
    expect(overdueRow().text()).toBe('Overdue1')
    expect(overdueRow().find('.abele-timeline__overdue-count').attributes('aria-label')).toBe(
      '1 unfinished'
    )
  })

  it('keeps a past-only list folded on touch and reveals it all on a click', async () => {
    render([task('sample-a', '2030-06-12'), task('sample-b', '2030-06-14')])
    await flushPromises()
    expect(days()).toEqual([])
    await view.trigger('touchstart', { touches: [{ clientY: 100 }] })
    await view.trigger('touchmove', { touches: [{ clientY: 150 }] })
    await flushPromises()
    expect(days()).toEqual([])
    expect(overdueRow().text()).toBe('Overdue2')
    expect(overdueRow().find('.abele-timeline__overdue-count').attributes('aria-label')).toBe(
      '2 unfinished'
    )
    await overdueRow().trigger('click')
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-12', 'date:2030-06-14'])
    expect(overdueRow().text()).toBe('Overdue2')
    expect(overdueRow().find('.abele-timeline__overdue-count').attributes('aria-label')).toBe(
      '2 unfinished'
    )
    expect(overdueRow().attributes('aria-expanded')).toBe('true')
    await overdueRow().trigger('click')
    await flushPromises()
    expect(days()).toEqual([])
    expect(overdueRow().text()).toBe('Overdue2')
    expect(overdueRow().find('.abele-timeline__overdue-count').attributes('aria-label')).toBe(
      '2 unfinished'
    )
    expect(overdueRow().attributes('aria-expanded')).toBe('false')
  })

  // What was done in the past is there only while completed tasks are shown; a late arrival that
  // is done joins it, and Overdue keeps counting only what is undone.
  it('includes older completed-only days and late done arrivals while done tasks are shown', async () => {
    const tasks = [
      task('sample-old-done', '2020-01-01', true),
      task('sample-old', '2030-06-12'),
      task('sample-today', '2030-06-15'),
    ]
    render(tasks)
    await flushPromises()
    expect(view.find('.abele-timeline__history').exists()).toBe(false)
    expect(days()).toEqual(['date:2030-06-15'])
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(days()).toEqual(['date:2020-01-01', 'date:2030-06-15'])
    await view.setProps({ tasks: [task('sample-arrival', '2019-01-01', true), ...tasks] })
    await flushPromises()
    expect(days()[0]).toBe('date:2019-01-01')
    expect(overdueRow().text()).toBe('Overdue1')
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-15'])
  })

  // Everything in the past and done tasks hidden used to leave an empty space under Overdue.
  it('says nothing is ahead and offers the switch when every task is in the past', async () => {
    render([
      task('sample-old', '2030-06-12'),
      task('sample-older', '2030-06-14'),
      task('sample-done', '2030-06-13', true),
    ])
    await flushPromises()
    const empty = () => view.findComponent(EmptyState)
    expect(days()).toEqual([])
    expect(empty().props('text')).toBe('Nothing ahead. Past tasks are hidden')
    expect(empty().findComponent(Button).props('text')).toBe('Show completed tasks')
    // Overdue still opens its own days; the list ahead is still empty.
    await overdueRow().trigger('click')
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-12', 'date:2030-06-14'])
    expect(empty().props('text')).toBe('Nothing ahead. Past tasks are hidden')
    empty().findComponent(Button).vm.$emit('click')
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-13', 'date:2030-06-12', 'date:2030-06-14'])
    expect(empty().props('text')).toBe('Nothing ahead')
    expect(empty().findComponent(Button).exists()).toBe(false)
  })

  it('says nothing is ahead when every task is done and in the past', async () => {
    render([task('sample-done', '2030-06-13', true)])
    await flushPromises()
    expect(overdueRow().exists()).toBe(false)
    expect(view.findComponent(EmptyState).props('text')).toBe(
      'Nothing ahead. Past tasks are hidden'
    )
  })

  it('keeps the plain empty line without tasks, and no line with a day ahead', async () => {
    render([])
    await flushPromises()
    expect(view.findComponent(EmptyState).props('text')).toBe('No tasks to show.')
    view.unmount()
    render([task('sample-old', '2030-06-12'), task('sample-today', '2030-06-15')])
    await flushPromises()
    expect(view.findComponent(EmptyState).exists()).toBe(false)
  })

  it.each(['Enter', ' '])('opens Overdue with the row keyboard action %s', async (key) => {
    render([task('sample-old', '2030-06-14'), task('sample-today', '2030-06-15')])
    await flushPromises()
    const banner = overdueRow()
    expect(banner.attributes('role')).toBe('button')
    expect(banner.attributes('tabindex')).toBe('0')
    await banner.trigger('keydown', { key })
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-14', 'date:2030-06-15'])
    expect(banner.attributes('aria-expanded')).toBe('true')
    expect(banner.attributes('aria-label')).toBe('Hide overdue tasks')
    await banner.trigger('keydown', { key })
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-15'])
    expect(banner.attributes('aria-expanded')).toBe('false')
    expect(banner.attributes('aria-label')).toBe('Show overdue tasks')
  })

  // A browser reports a watched element only when it comes into or leaves sight. Kept in sight
  // through a page (a pane anchored at its end), the same sentinel would never report again and
  // the list would stop growing; each page watches a new one, which reports where it stands.
  it('watches a new sentinel for every page, so one left in sight still brings the next', async () => {
    render(
      Array.from({ length: 70 }, (_, i) =>
        task(`sample-${i}`, dayjs('2030-06-15').add(i, 'day').format('YYYY-MM-DD'))
      )
    )
    await flushPromises()
    const first = view.find('.abele-timeline__sentinel').element
    expect(scrollIntoView(first)).toBe(1)
    await flushPromises()
    expect(days()).toHaveLength(40)
    const second = view.find('.abele-timeline__sentinel').element
    expect(second).not.toBe(first)
    expect(scrollIntoView(second)).toBe(1)
    await flushPromises()
    expect(days()).toHaveLength(60)
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
