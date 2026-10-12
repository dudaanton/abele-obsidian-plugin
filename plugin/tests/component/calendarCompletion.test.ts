import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import dayjs from 'dayjs'
import { Menu } from 'obsidian'
import CalendarEventView from '@/components/CalendarEvent.vue'
import Timeline from '@/components/Timeline.vue'
import CalendarBase from '@/components/calendarBase/CalendarBase.vue'
import { CalendarService, setCalendars } from '@/calendars/CalendarService'
import { EventCompletionStore, type CompletionMarks } from '@/calendars/completion'
import { parseIcs } from '@/calendars/ics'
import { newFeed } from '@/calendars/settings'
import { Task } from '@/entities/Task'
import { createReadTasksTool } from '@/ai/tools/RelationTools'
import CalendarMonth from '@/components/calendarBase/CalendarMonth.vue'
import CalendarWeek from '@/components/calendarBase/CalendarWeek.vue'
import CalendarYear from '@/components/calendarBase/CalendarYear.vue'
import CalendarLife from '@/components/calendarBase/CalendarLife.vue'
import { useVault, configureAbele } from '../helpers/testEnv'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'

vi.mock('@/composables/useDate', () => ({ useDate: () => ({ now: ref(dayjs('2026-04-10')) }) }))
const feed = { ...newFeed([]), id: 'sample-feed', name: 'Sample calendar' }
let service: CalendarService
let view: VueWrapper | undefined
beforeEach(() => {
  useVault([])
  configureAbele()
  installFakeIntersectionObserver()
  vi.useFakeTimers({ now: new Date('2026-04-10T10:00:00Z'), toFake: ['Date'] })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  let marks: CompletionMarks = {}
  service = new CalendarService({
    storage: null,
    request: async () => {
      throw Error('No network expected')
    },
    settings: () => ({ refreshMinutes: 30, feeds: [feed] }),
    secret: () => '',
    completion: new EventCompletionStore({
      read: () => marks,
      write: async (next) => {
        marks = next
      },
    }),
  })
  service.state.events[feed.id] = parseIcs(
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:sample-series\r\nDTSTART:20260410T090000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Sample meeting\r\nEND:VEVENT\r\nEND:VCALENDAR',
    feed.id,
    { from: Date.UTC(2026, 3, 1), to: Date.UTC(2026, 4, 1) }
  )
  setCalendars(service)
})
afterEach(() => {
  view?.unmount()
  view = undefined
  setCalendars(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('completion where external events are drawn', () => {
  const pastEvents = () => {
    service.state.events[feed.id] = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:sample-past',
        'DTSTART:20260408T090000Z',
        'DTEND:20260408T100000Z',
        'SUMMARY:Sample past meeting',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:sample-trip',
        'DTSTART;VALUE=DATE:20260407',
        'DTEND;VALUE=DATE:20260410',
        'SUMMARY:Sample past trip',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
      feed.id,
      { from: Date.UTC(2026, 3, 1), to: Date.UTC(2026, 4, 1) }
    )
    return service.state.events[feed.id]
  }

  it('keeps unchecked past events neutral in history and each revealed day', async () => {
    const events = pastEvents()
    const event = events.find((event) => event.uid === 'sample-past')!
    view = mount(Timeline, { props: { tasks: [], events: service.byDay() } })
    expect(view.find('.abele-timeline__history').text()).toContain('0 unfinished')
    expect(view.find('.abele-timeline__date-indicator_overdue').exists()).toBe(false)
    await view.find('.abele-timeline__history').trigger('click')
    expect(view.findAllComponents(CalendarEventView)).toHaveLength(4)
    expect(view.find('.abele-timeline__date-indicator_overdue').exists()).toBe(false)
    for (const row of view.findAllComponents(CalendarEventView)) {
      expect(row.attributes('data-task')).toBeUndefined()
      expect(row.classes()).not.toContain('is-checked')
      expect(row.find('input').element.checked).toBe(false)
    }
    const meeting = view
      .findAllComponents(CalendarEventView)
      .find((row) => row.props('event').id === event.id)!
    await meeting.find('input').trigger('click')
    await flushPromises()
    expect(service.isDone(event)).toBe(true)
    expect(view.findAllComponents(CalendarEventView)).toHaveLength(3)
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    expect(view.findAllComponents(CalendarEventView)).toHaveLength(4)
    expect(view.find('.abele-timeline__history').text()).toContain('0 unfinished')
  })

  it('keeps an optional checkbox without marking an unchecked event as a pending task', () => {
    const event = pastEvents()[0]
    view = mount(CalendarEventView, { props: { event, feed, day: '2026-04-07' } })
    expect(view.find('input[type=checkbox]').exists()).toBe(true)
    expect(view.attributes('data-task')).toBeUndefined()
  })

  it('uses a neutral calendar indicator for past event-only days', async () => {
    pastEvents()
    view = mount(Timeline, { props: { tasks: [], events: service.byDay() } })
    await view.find('.abele-timeline__history').trigger('click')
    expect(view.findAll('.abele-timeline__date-block')).toHaveLength(3)
    expect(view.find('.abele-timeline__date-indicator_overdue').exists()).toBe(false)
  })

  it('counts only note tasks as unfinished and keeps their past-day indication', async () => {
    pastEvents()
    useVault([
      {
        path: 'Sample/pending-note.md',
        frontmatter: { type: 'task', date: '2026-04-07', due: '2026-04-08' },
      },
    ])
    const task = new Task({ wikilink: '[[Sample/pending-note]]' })
    task.loaded = true
    task.title = 'Sample pending task'
    task.date = dayjs('2026-04-07')
    task.due = dayjs('2026-04-08')
    view = mount(Timeline, { props: { tasks: [task], events: service.byDay() } })
    expect(view.find('.abele-timeline__history').text()).toContain('1 unfinished')
    await view.find('.abele-timeline__history').trigger('click')
    const blocks = view.findAll('.abele-timeline__date-block')
    expect(
      blocks.map((block) => block.find('.abele-timeline__date-indicator_overdue').exists())
    ).toEqual([true, true, false])
  })

  it('never returns external occurrences from the agent open-task list', async () => {
    pastEvents()
    useVault([
      { path: 'Sample/pending-note.md', frontmatter: { type: 'task', date: '2026-04-08' } },
      { path: 'Sample/completed-note.md', frontmatter: { type: 'task', completed: '2026-04-08' } },
    ])
    const result = await createReadTasksTool().execute('sample-read', { completed: 'no' })
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('1 tasks (0 done)') },
    ])
    expect(JSON.stringify(result)).toContain('pending-note')
    expect(JSON.stringify(result)).not.toContain('completed-note')
    expect(JSON.stringify(result)).not.toContain('Sample past')
  })

  it.each([
    ['month', CalendarMonth],
    ['week', CalendarWeek],
    ['year', CalendarYear],
    ['life', CalendarLife],
  ] as const)(
    'keeps past unchecked events in the %s base, hiding only explicitly completed events',
    async (mode, component) => {
      const events = pastEvents()
      configureAbele().birthDate = '2000-01-01'
      configureAbele().lifeExpectancy = 80
      const instance = {
        id: 'sample-calendar',
        el: document.createElement('div'),
        items: shallowRef([]),
        groups: shallowRef([]),
        undated: ref(0),
        mode: ref(mode),
        showEvents: ref(true),
        canCreate: ref(false),
        lifeYears: ref(null),
        setMode: vi.fn(),
        open: vi.fn(),
        hover: vi.fn(),
        create: vi.fn(),
        move: vi.fn(),
      }
      view = mount(CalendarBase, { props: { instance } })
      expect(view.findComponent(component).props('items')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: events[0].id, kind: 'event', completed: false }),
          expect.objectContaining({ id: events[1].id, kind: 'event', completed: false }),
        ])
      )
      await view.find('.abele-calendar-base__completed-toggle').trigger('click')
      expect(view.findComponent(component).props('items')).toHaveLength(2)
      await service.setDone(events[0], true)
      await flushPromises()
      expect(view.findComponent(component).props('items')).toEqual([
        expect.objectContaining({ id: events[1].id, completed: false }),
      ])
    }
  )

  it('ticks from the timeline, filters like tasks, and can reopen from its checkbox', async () => {
    view = mount(Timeline, { props: { tasks: [], events: service.byDay() } })
    const first = service.state.events[feed.id][0]
    await view.find('input[type=checkbox]').trigger('click')
    await flushPromises()
    expect(service.isDone(first)).toBe(true)
    expect(view.findAllComponents(CalendarEventView)).toHaveLength(2)
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    const done = view
      .findAllComponents(CalendarEventView)
      .find((v) => v.props('event').id === first.id)!
    expect(done.find('input').element.checked).toBe(true)
    expect(done.attributes('data-task')).toBe('x')
    await done.find('input').trigger('click')
    await flushPromises()
    expect(service.isDone(first)).toBe(false)
  })

  it('offers done and undone for this occurrence in the event menu', async () => {
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const event = service.state.events[feed.id][1]
    view = mount(CalendarEventView, { props: { event, feed, day: '2026-04-11' } })
    await view.trigger('click')
    let menu = shown.mock.contexts.at(-1) as unknown as Menu
    const mark = menu.items.find((i) => i.title === 'Mark done')!
    expect(mark).toBeDefined()
    await mark.handler!()
    await flushPromises()
    expect(service.state.events[feed.id].map((e) => service.isDone(e))).toEqual([
      false,
      true,
      false,
    ])
    await view.trigger('click')
    menu = shown.mock.contexts.at(-1) as unknown as Menu
    expect(menu.items.map((i) => i.title)).toContain('Mark undone')
  })

  it('ticks an occurrence from the calendar agenda and filters completed notes and events together', async () => {
    const instance = {
      id: 'sample-calendar',
      el: document.createElement('div'),
      items: shallowRef([]),
      groups: shallowRef([]),
      undated: ref(0),
      mode: ref('month' as const),
      showEvents: ref(true),
      canCreate: ref(false),
      lifeYears: ref(null),
      setMode: vi.fn(),
      open: vi.fn(),
      hover: vi.fn(),
      create: vi.fn(),
      move: vi.fn(),
    }
    view = mount(CalendarBase, { props: { instance } })
    await view.find('.abele-calendar-base__agenda input[type=checkbox]').trigger('click')
    await flushPromises()
    const events = service.state.events[feed.id]
    expect(events.map((e) => service.isDone(e))).toEqual([true, false, false])
    expect(view.find('.abele-calendar-base__agenda .abele-calendar-chip_done').exists()).toBe(true)
    await view.find('.abele-calendar-base__completed-toggle').trigger('click')
    expect(view.find('.abele-calendar-base__agenda input').exists()).toBe(false)
  })
})
