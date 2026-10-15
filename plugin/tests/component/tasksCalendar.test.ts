/**
 * A note's calendar tasks read as a month under the note: the switch beside the completed switch,
 * the choice kept for the note, the month showing what the list shows, and no switch anywhere
 * else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config as mountConfig, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import dayjs from 'dayjs'
import Timeline from '@/components/Timeline.vue'
import TasksCalendar from '@/components/TasksCalendar.vue'
import TaskView from '@/components/Task.vue'
import CalendarEventView from '@/components/CalendarEvent.vue'
import { Task } from '@/entities/Task'
import { provideFooterFold } from '@/composables/useFooterFold'
import { FOOTER_VIEW_KEY, resetFooterView } from '@/composables/useFooterView'
import { configureAbele, useVault } from '../helpers/testEnv'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'

vi.mock('@/composables/useDate', () => ({ useDate: () => ({ now: ref(dayjs('2030-06-15')) }) }))

const NOTE = 'Projects/Sample balcony.md'
let view: VueWrapper
let app: ReturnType<typeof useVault>

const task = (name: string, date: string, done = false) => {
  const t = new Task({ wikilink: `[[Sample/${name}]]` })
  t.loaded = true
  t.title = name
  t.date = dayjs(date)
  if (done) t.completedAt = dayjs(date)
  return t
}

/** The timeline under a note, as the footer draws it. */
const footer = (tasks: Task[]) => {
  const Host = defineComponent({
    setup() {
      provideFooterFold(() => NOTE)
      return () => h(Timeline, { tasks, title: 'Calendar tasks' })
    },
  })
  view = mount(Host, { shallow: true, attachTo: document.body })
  return view
}

const toggle = () => view.find('.abele-timeline__view')
const marks = () =>
  Object.fromEntries(
    view
      .findAll('.abele-calendar__day:not(.abele-calendar__day_other-month)')
      .filter((d) => d.find('.abele-calendar__day-log').exists())
      .map((d) => [
        d.find('.abele-calendar__day-number').text(),
        d.find('.abele-calendar__day-log_done').exists()
          ? 'done'
          : d.find('.abele-calendar__day-log_open').exists()
            ? 'open'
            : 'entry',
      ])
  )

const originalStubs = mountConfig.global.stubs
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2030, 5, 15, 12))
  mountConfig.global.stubs = {
    ...originalStubs,
    Timeline: false,
    ListSectionHeader: false,
    TasksCalendar: false,
    Calendar: false,
  }
  configureAbele()
  app = useVault([])
  app.saveLocalStorage(FOOTER_VIEW_KEY, {})
  resetFooterView()
  installFakeIntersectionObserver()
})
afterEach(() => {
  view?.unmount()
  mountConfig.global.stubs = originalStubs
  vi.useRealTimers()
})

describe('calendar tasks under a note as a month', () => {
  it('switches from the list to the month from the heading, and keeps it for the note', async () => {
    footer([task('sample-open', '2030-06-17')])
    expect(view.find('.abele-tasks-calendar').exists()).toBe(false)
    expect(toggle().attributes('aria-label') ?? toggle().text()).toBeDefined()

    await toggle().trigger('click')
    await flushPromises()
    expect(view.find('.abele-tasks-calendar').exists()).toBe(true)
    expect(view.find('.abele-timeline__blocks').exists()).toBe(false)
    expect(
      (app.loadLocalStorage(FOOTER_VIEW_KEY) as Record<string, { tasksCalendar?: true }>)[NOTE]
    ).toEqual({ tasksCalendar: true })
    view.unmount()

    resetFooterView()
    footer([task('sample-open', '2030-06-17')])
    await flushPromises()
    expect(view.find('.abele-tasks-calendar').exists()).toBe(true)

    await toggle().trigger('click')
    await flushPromises()
    expect(view.find('.abele-tasks-calendar').exists()).toBe(false)
    expect(app.loadLocalStorage(FOOTER_VIEW_KEY)).toEqual({})
  })

  it('marks the days with what the list shows, done tasks only while the switch shows them', async () => {
    app.saveLocalStorage(FOOTER_VIEW_KEY, { [NOTE]: { tasksCalendar: true } })
    resetFooterView()
    footer([
      task('sample-open', '2030-06-17'),
      task('sample-done', '2030-06-17', true),
      task('sample-all-done', '2030-06-20', true),
      task('sample-past-done', '2030-06-03', true),
    ])
    await flushPromises()
    // Done tasks hidden, as the list hides them: one open day and nothing else.
    expect(marks()).toEqual({ '17': 'open' })

    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(marks()).toEqual({ '3': 'done', '17': 'open', '20': 'done' })
  })

  it('opens on the next planned day and shows its tasks beside the month', async () => {
    app.saveLocalStorage(FOOTER_VIEW_KEY, { [NOTE]: { tasksCalendar: true } })
    resetFooterView()
    footer([task('sample-later', '2030-06-24'), task('sample-next', '2030-06-17')])
    await flushPromises()
    expect(view.find('.abele-tasks-calendar__day-title').text()).toContain('17 June 2030')
    expect(view.find('.abele-tasks-calendar__items').exists()).toBe(true)
  })

  it('has no search of its own: the month is not a list to search', async () => {
    footer([task('sample-open', '2030-06-17')])
    const searchesBefore = view.findAll('.abele-timeline__search-toggle')
    await toggle().trigger('click')
    await flushPromises()
    expect(view.findAll('.abele-timeline__search-toggle').length).toBe(0)
    expect(searchesBefore.length).toBeGreaterThan(0)
  })
})

describe('the timeline outside a note', () => {
  it('has no switch to a month and stays a list', async () => {
    view = mount(Timeline, {
      props: { tasks: [task('sample-open', '2030-06-17')] },
      shallow: true,
      attachTo: document.body,
    })
    await flushPromises()
    expect(toggle().exists()).toBe(false)
    expect(view.find('.abele-tasks-calendar').exists()).toBe(false)
  })
})

const plain = (id: string, dates: string[], done = false) => ({
  id,
  title: `Sample task ${id}`,
  dates,
  completedAt: done ? { valueOf: () => 1 } : null,
  getSortTimestamp: () => 0,
})
const event = (id: string) => ({
  event: { id, title: `Sample event ${id}`, allDay: true, start: 0 },
  feed: { id: 'sample-feed' },
})

/** The month as the component is drawn, its children reduced to what they are handed. */
const CalendarStub = defineComponent({
  props: ['selectedDate', 'marks'],
  emits: ['date-selected', 'month-changed'],
  setup(props) {
    return () =>
      h(
        'div',
        { class: 'calendar-stub', 'data-selected': props.selectedDate?.format('YYYY-MM-DD') },
        [...(props.marks as Map<string, string>)].map(([day, mark]) =>
          h('i', { 'data-day': day, 'data-mark': mark })
        )
      )
  },
})
const stubs = { Calendar: CalendarStub }
const rows = (component: unknown) =>
  view
    .findAllComponents(component as never)
    .map((row) => row.props() as { task?: { title: string }; event?: { title: string } })

describe('the month on its own', () => {
  beforeEach(() => vi.setSystemTime(new Date(2026, 2, 5, 10)))

  const draw = (tasks: unknown[], events?: Map<string, unknown[]>) =>
    (view = mount(TasksCalendar, {
      props: { tasks, events } as never,
      shallow: true,
      global: { stubs },
    }))

  it('draws a mark for each planned day and opens on the next one with its rows beside', () => {
    draw(
      [
        plain('a', ['2026-03-02'], true),
        plain('b', ['2026-03-09']),
        plain('c', ['2026-03-09'], true),
      ],
      new Map([['2026-03-12', [event('x')]]])
    )
    const marks = Object.fromEntries(
      view.findAll('[data-day]').map((m) => [m.attributes('data-day'), m.attributes('data-mark')])
    )
    expect(marks).toEqual({ '2026-03-02': 'done', '2026-03-09': 'open', '2026-03-12': 'entry' })
    expect(view.find('.calendar-stub').attributes('data-selected')).toBe('2026-03-09')
    expect(rows(TaskView).map((r) => r.task!.title)).toEqual(['Sample task b', 'Sample task c'])
  })

  it('shows a chosen day and says so when the day or the whole month has nothing', async () => {
    draw([plain('a', ['2026-03-09'])], new Map([['2026-03-12', [event('x')]]]))
    const calendar = view.findComponent(CalendarStub)
    calendar.vm.$emit('date-selected', dayjs('2026-03-12'))
    await nextTick()
    expect(rows(CalendarEventView).map((r) => r.event!.title)).toEqual(['Sample event x'])
    expect(view.find('.abele-tasks-calendar__day-title').text()).toContain('12 March 2026')

    calendar.vm.$emit('date-selected', dayjs('2026-03-10'))
    await nextTick()
    expect(view.find('.abele-tasks-calendar__none').text()).toBe('Nothing planned this day.')

    calendar.vm.$emit('month-changed', dayjs('2026-04-01'))
    await nextTick()
    expect(view.find('.abele-tasks-calendar__none').text()).toBe('Nothing planned in April.')
    expect(view.find('.calendar-stub').attributes('data-selected')).toBe('2026-04-01')
  })

  it('follows the tasks as they arrive and change, until a day is chosen', async () => {
    draw([])
    expect(view.find('.calendar-stub').attributes('data-selected')).toBe('2026-03-05')
    await view.setProps({ tasks: [plain('a', ['2026-03-20'])] } as never)
    expect(view.find('.calendar-stub').attributes('data-selected')).toBe('2026-03-20')
    await view.setProps({ tasks: [plain('a', ['2026-03-20'], true)] } as never)
    expect(view.find('[data-day="2026-03-20"]').attributes('data-mark')).toBe('done')

    view.findComponent(CalendarStub).vm.$emit('date-selected', dayjs('2026-03-07'))
    await view.setProps({ tasks: [plain('a', ['2026-03-25'])] } as never)
    expect(view.find('.calendar-stub').attributes('data-selected')).toBe('2026-03-07')
  })
})
