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
