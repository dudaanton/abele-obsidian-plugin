/**
 * The calendar view of a base, drawn: notes on their days in a month, on their hours in a week,
 * as a tint in a year; the moves between them; what pressing a note, a day or an hour asks the
 * base's view to do; and the narrow month that lists a picked day under the grid.
 */
process.env.TZ = 'Europe/Berlin'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref, shallowRef } from 'vue'
import { Menu } from 'obsidian'
import CalendarBase from '@/components/calendarBase/CalendarBase.vue'
import type { CalendarBaseInstance } from '@/bases/CalendarView'
import type { CalendarItem, CalendarMode } from '@/bases/calendarLayout'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault, configureAbele } from '../helpers/testEnv'

const item = (title: string, over: Partial<CalendarItem> = {}): CalendarItem => ({
  id: `Tasks/${title}.md`,
  kind: 'note',
  path: `Tasks/${title}.md`,
  title,
  start: '2026-09-26',
  end: '2026-09-26',
  startMinute: null,
  endMinute: null,
  color: null,
  completed: false,
  ...over,
})

function makeInstance(items: CalendarItem[], mode: CalendarMode = 'month') {
  const instance = {
    id: 'c1',
    el: document.createElement('div'),
    items: shallowRef(items),
    groups: shallowRef([]),
    undated: ref(0),
    mode: ref<CalendarMode>(mode),
    showEvents: ref(false),
    canCreate: ref(true),
    setMode: vi.fn((m: CalendarMode) => {
      instance.mode.value = m
    }),
    open: vi.fn(),
    hover: vi.fn(),
    create: vi.fn(),
    move: vi.fn(),
  }
  return instance satisfies CalendarBaseInstance
}

/** The one ResizeObserver the view makes, so a test can say how wide the view is. */
let resize: ((width: number) => void) | null = null
class FakeResizeObserver {
  constructor(private callback: ResizeObserverCallback) {
    resize = (width) =>
      this.callback(
        [{ contentRect: { width } } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      )
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

let wrapper: VueWrapper | null = null
const render = (instance: CalendarBaseInstance) => {
  wrapper = mount(CalendarBase, { props: { instance }, attachTo: document.body })
  return wrapper
}

const cell = (view: VueWrapper, day: string) =>
  view.find(`.abele-calendar-month__day[data-day="${day}"]`)
const titles = (el: ReturnType<VueWrapper['find']>) =>
  el.findAll('.abele-calendar-chip__title').map((t) => t.text())

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 26, 10, 30), toFake: ['Date'] })
  useVault([])
  configureAbele()
  GlobalStore.getInstance().weekStartsOnMonday.value = true
  resize = null
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a month', () => {
  it('opens on this month and puts each note on its day, with its time', () => {
    const view = render(
      makeInstance([
        item('Dentist', { startMinute: 9 * 60 }),
        item('Pay rent', { start: '2026-09-01', end: '2026-09-01' }),
      ])
    )
    expect(view.find('.abele-calendar-base__title').text()).toBe('September 2026')
    expect(titles(cell(view, '2026-09-26'))).toEqual(['Dentist'])
    expect(cell(view, '2026-09-26').find('.abele-calendar-chip__time').text()).toBe('09:00')
    expect(titles(cell(view, '2026-09-01'))).toEqual(['Pay rent'])
    expect(cell(view, '2026-09-26').classes()).toContain('abele-calendar-month__day_today')
  })

  it('lists a span on every day it covers', () => {
    const view = render(makeInstance([item('Trip', { start: '2026-09-28', end: '2026-09-30' })]))
    for (const day of ['2026-09-28', '2026-09-29', '2026-09-30']) {
      expect(titles(cell(view, day))).toEqual(['Trip'])
    }
    expect(cell(view, '2026-09-29').find('.abele-calendar-chip').classes()).toEqual(
      expect.arrayContaining(['abele-calendar-chip_from-before', 'abele-calendar-chip_goes-on'])
    )
  })

  it('folds a full day into "+N more", which lists the rest in a menu', async () => {
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const instance = makeInstance(
      ['a', 'b', 'c', 'd', 'e'].map((t, i) => item(t, { startMinute: 600 + i }))
    )
    const view = render(instance)
    expect(titles(cell(view, '2026-09-26'))).toEqual(['a', 'b', 'c'])
    await cell(view, '2026-09-26').find('.abele-calendar-month__more').trigger('click')
    const menu = shown.mock.contexts[0] as unknown as Menu
    expect(menu.items.map((i) => (i as unknown as { title: string }).title)).toEqual(['d', 'e'])
  })

  it('shows four in full rather than three and "+1 more"', () => {
    const view = render(makeInstance(['a', 'b', 'c', 'd'].map((t) => item(t))))
    expect(titles(cell(view, '2026-09-26'))).toEqual(['a', 'b', 'c', 'd'])
    expect(cell(view, '2026-09-26').find('.abele-calendar-month__more').exists()).toBe(false)
  })

  it('opens a note when it is pressed, and asks for a new one on a day', async () => {
    const instance = makeInstance([item('Dentist')])
    const view = render(instance)
    await cell(view, '2026-09-26').find('.abele-calendar-chip').trigger('click')
    expect(instance.open).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'Tasks/Dentist.md' }),
      expect.anything()
    )
    await cell(view, '2026-09-15').find('.abele-calendar-month__add').trigger('click')
    expect(instance.create).toHaveBeenCalledWith('2026-09-15', null)
  })

  it('offers no new note when the date is a formula', () => {
    const instance = makeInstance([])
    instance.canCreate.value = false
    const view = render(instance)
    expect(view.find('.abele-calendar-month__add').exists()).toBe(false)
  })

  it('moves a month at a time, and back to today', async () => {
    const view = render(makeInstance([]))
    const [prev, next] = view.findAll('.abele-calendar-base__controls .abele-obsidian-icon')
    await next.trigger('click')
    expect(view.find('.abele-calendar-base__title').text()).toBe('October 2026')
    await prev.trigger('click')
    await prev.trigger('click')
    expect(view.find('.abele-calendar-base__title').text()).toBe('August 2026')
    await view.find('.abele-calendar-base__controls button').trigger('click')
    expect(view.find('.abele-calendar-base__title').text()).toBe('September 2026')
  })

  it('shows a pressed day under the month, and opens its week from there', async () => {
    const instance = makeInstance([
      item('Dentist'),
      item('Pay rent', { start: '2026-09-09', end: '2026-09-09' }),
    ])
    const view = render(instance)
    // Today is picked to begin with.
    expect(titles(view.find('.abele-calendar-base__agenda'))).toEqual(['Dentist'])
    await cell(view, '2026-09-09').trigger('click')
    expect(instance.setMode).not.toHaveBeenCalled()
    expect(cell(view, '2026-09-09').classes()).toContain('abele-calendar-month__day_selected')
    expect(view.find('.abele-calendar-base__agenda').attributes('data-day')).toBe('2026-09-09')
    expect(titles(view.find('.abele-calendar-base__agenda'))).toEqual(['Pay rent'])
    await cell(view, '2026-09-26').find('.abele-calendar-month__day-number').trigger('click')
    expect(titles(view.find('.abele-calendar-base__agenda'))).toEqual(['Dentist'])
    await view.find('.abele-calendar-base__agenda-new').trigger('click')
    expect(instance.create).toHaveBeenCalledWith('2026-09-26', null)

    await view.find('.abele-calendar-base__agenda-week').trigger('click')
    expect(instance.setMode).toHaveBeenCalledWith('week')
    expect(view.find('.abele-calendar-base__title').text()).toBe('September 21 – 27, 2026')
  })

  it('shows the groups the base colours by, and how many notes have no date', () => {
    const instance = makeInstance([item('Dentist', { color: 'green' })])
    instance.groups.value = [{ label: 'Health', color: 'green' }] as never
    instance.undated.value = 2
    const view = render(instance)
    expect(view.find('.abele-calendar-base__legend .abele-badge').text()).toBe('Health')
    expect(view.find('.abele-calendar-base__undated').text()).toBe('2 notes have no date')
    expect(cell(view, '2026-09-26').find('.abele-calendar-chip').classes()).toContain(
      'abele-calendar-chip_color-green'
    )
  })
})

describe('a narrow month', () => {
  it('shows dots, and lists the picked day under the grid', async () => {
    const instance = makeInstance([
      item('Dentist', { startMinute: 540, color: 'red' }),
      item('Lunch', { start: '2026-09-27', end: '2026-09-27' }),
    ])
    const view = render(instance)
    resize!(390)
    await nextTick()
    expect(view.classes()).toContain('abele-calendar-base_narrow')
    expect(cell(view, '2026-09-26').findAll('.abele-calendar-chip')).toHaveLength(0)
    expect(cell(view, '2026-09-26').find('.abele-calendar-month__dot_color-red').exists()).toBe(
      true
    )
    // Today is picked to begin with.
    expect(titles(view.find('.abele-calendar-base__agenda'))).toEqual(['Dentist'])

    await cell(view, '2026-09-27').trigger('click')
    expect(titles(view.find('.abele-calendar-base__agenda'))).toEqual(['Lunch'])
    await view.find('.abele-calendar-base__agenda-new').trigger('click')
    expect(instance.create).toHaveBeenCalledWith('2026-09-27', null)

    await cell(view, '2026-09-10').trigger('click')
    expect(view.find('.abele-calendar-base__agenda .abele-empty-state').exists()).toBe(true)
  })
})

describe('a week', () => {
  it('puts timed notes on the hours and the rest in the row at the top', () => {
    const view = render(
      makeInstance(
        [
          item('Standup', {
            start: '2026-09-22',
            end: '2026-09-22',
            startMinute: 540,
            endMinute: 570,
          }),
          item('Buy milk', { start: '2026-09-23', end: '2026-09-23' }),
          item('Trip', { start: '2026-09-25', end: '2026-09-28', startMinute: 600 }),
        ],
        'week'
      )
    )
    expect(view.find('.abele-calendar-base__title').text()).toBe('September 21 – 27, 2026')
    const column = view.find('.abele-calendar-week__column[data-day="2026-09-22"]')
    const block = column.find('.abele-calendar-week__block')
    expect(block.text()).toContain('Standup')
    expect(block.attributes('style')).toContain(`--abele-block-top: ${540 / 1440}`)
    const allDay = (day: string) =>
      titles(view.find(`.abele-calendar-week__all-day-cell[data-day="${day}"]`))
    expect(allDay('2026-09-23')).toEqual(['Buy milk'])
    // A span with a time still lasts days: it is in the top row, on each of its days here.
    expect(allDay('2026-09-25')).toEqual(['Trip'])
    expect(allDay('2026-09-27')).toEqual(['Trip'])
    expect(
      view
        .find('.abele-calendar-week__column[data-day="2026-09-26"] .abele-calendar-week__now')
        .exists()
    ).toBe(true)
  })

  it('makes a note at the half hour that was pressed', async () => {
    const instance = makeInstance([], 'week')
    const view = render(instance)
    const column = view.find('.abele-calendar-week__column[data-day="2026-09-24"]')
    vi.spyOn(column.element, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      height: 1440,
    } as DOMRect)
    await column.trigger('click', { clientY: 14 * 60 + 40 })
    expect(instance.create).toHaveBeenCalledWith('2026-09-24', 14 * 60 + 30)
  })

  it('steps a week at a time', async () => {
    const view = render(makeInstance([], 'week'))
    await view.findAll('.abele-calendar-base__controls .abele-obsidian-icon')[1].trigger('click')
    expect(view.find('.abele-calendar-base__title').text()).toBe('Sep 28 – Oct 4, 2026')
  })
})

describe('a year', () => {
  it('tints each day by how much is on it, lists a picked day, and opens a month', async () => {
    const instance = makeInstance(
      [item('a'), item('b'), item('c', { start: '2026-03-02', end: '2026-03-02' })],
      'year'
    )
    const view = render(instance)
    expect(view.find('.abele-calendar-base__title').text()).toBe('2026')
    expect(view.findAll('.abele-calendar-year__month')).toHaveLength(12)
    const day = (d: string) => view.find(`.abele-calendar-year__day[data-day="${d}"]`)
    expect(day('2026-09-26').classes()).toContain('abele-calendar-year__day_heat-4')
    expect(day('2026-03-02').classes()).toContain('abele-calendar-year__day_heat-1')
    expect(day('2026-03-03').classes()).toContain('abele-calendar-year__day_heat-0')

    await day('2026-03-02').trigger('click')
    expect(instance.setMode).not.toHaveBeenCalled()
    expect(day('2026-03-02').classes()).toContain('abele-calendar-year__day_selected')
    expect(titles(view.find('.abele-calendar-base__agenda'))).toEqual(['c'])

    await view.findAll('.abele-calendar-year__month-name')[4].trigger('click')
    expect(instance.setMode).toHaveBeenLastCalledWith('month')
    expect(view.find('.abele-calendar-base__title').text()).toBe('May 2026')
  })
})

describe('dragging a note', () => {
  /** A pointer event as jsdom can make one: it has no PointerEvent of its own. */
  const pointer = (type: string, x: number, y: number, pointerType = 'mouse') => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    Object.defineProperty(event, 'pointerType', { value: pointerType })
    return event
  }
  let under: Element | null = null

  beforeEach(() => {
    under = null
    document.elementFromPoint = () => under
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  // The guard against the click that follows a drop lasts one turn; let it go before the next.
  afterEach(() => {
    vi.useRealTimers()
    return new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('moves a note to the day it is let go on, and does not open it', async () => {
    const instance = makeInstance([item('Dentist')])
    const view = render(instance)
    const chip = cell(view, '2026-09-26').find('.abele-calendar-chip').element
    chip.dispatchEvent(pointer('pointerdown', 10, 10))
    under = cell(view, '2026-09-29').element
    window.dispatchEvent(pointer('pointermove', 60, 90))
    expect(document.querySelector('.abele-calendar-drag-ghost')?.textContent).toBe('Dentist')
    expect(cell(view, '2026-09-29').classes()).toContain('abele-calendar-drop-target')
    window.dispatchEvent(pointer('pointerup', 60, 90))
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(instance.move).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Dentist' }),
      '2026-09-26',
      '2026-09-29',
      null
    )
    expect(instance.open).not.toHaveBeenCalled()
    expect(document.querySelector('.abele-calendar-drag-ghost')).toBeNull()
  })

  it('a small wobble of the mouse is still a press', async () => {
    const instance = makeInstance([item('Dentist')])
    const view = render(instance)
    const chip = cell(view, '2026-09-26').find('.abele-calendar-chip')
    chip.element.dispatchEvent(pointer('pointerdown', 10, 10))
    window.dispatchEvent(pointer('pointermove', 12, 11))
    window.dispatchEvent(pointer('pointerup', 12, 11))
    await chip.trigger('click')
    expect(instance.move).not.toHaveBeenCalled()
    expect(instance.open).toHaveBeenCalled()
  })

  it('takes a finger only once it has rested on the note, and lets a swipe scroll', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ now: new Date(2026, 8, 26, 10, 30) })
    const instance = makeInstance([item('Dentist')])
    const view = render(instance)
    const chip = cell(view, '2026-09-26').find('.abele-calendar-chip').element
    // A swipe: moved before the hold, nothing is picked up.
    chip.dispatchEvent(pointer('pointerdown', 10, 10, 'touch'))
    window.dispatchEvent(pointer('pointermove', 10, 60, 'touch'))
    vi.advanceTimersByTime(600)
    expect(document.querySelector('.abele-calendar-drag-ghost')).toBeNull()
    window.dispatchEvent(pointer('pointerup', 10, 60, 'touch'))
    // A hold, then a move.
    chip.dispatchEvent(pointer('pointerdown', 10, 10, 'touch'))
    vi.advanceTimersByTime(600)
    under = cell(view, '2026-09-24').element
    window.dispatchEvent(pointer('pointermove', 10, 60, 'touch'))
    window.dispatchEvent(pointer('pointerup', 10, 60, 'touch'))
    expect(instance.move).toHaveBeenCalledWith(expect.anything(), '2026-09-26', '2026-09-24', null)
    vi.runOnlyPendingTimers()
  })

  it('puts a note on the hour of the week it is let go at, to the quarter', async () => {
    const instance = makeInstance([item('Dentist', { startMinute: 540, endMinute: 600 })], 'week')
    const view = render(instance)
    const column = view.find('.abele-calendar-week__column[data-day="2026-09-24"]')
    vi.spyOn(column.element, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      width: 100,
      height: 1440,
    } as DOMRect)
    const chip = view.find(
      '.abele-calendar-week__column[data-day="2026-09-26"] .abele-calendar-chip'
    )
    // Taken at its top edge, so where it is let go is where it starts.
    vi.spyOn(chip.element, 'getBoundingClientRect').mockReturnValue({ top: 540 } as DOMRect)
    chip.element.dispatchEvent(pointer('pointerdown', 10, 540))
    under = column.element
    window.dispatchEvent(pointer('pointermove', 50, 14 * 60 + 20))
    expect(document.querySelector('.abele-calendar-drop-marker')?.textContent).toBe('14:15')
    window.dispatchEvent(pointer('pointerup', 50, 14 * 60 + 20))
    expect(instance.move).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Dentist' }),
      '2026-09-26',
      '2026-09-24',
      14 * 60 + 15
    )
    expect(instance.create).not.toHaveBeenCalled()
  })

  it('leaves events and a formula date where they are', () => {
    const instance = makeInstance([item('Dentist')])
    instance.canCreate.value = false
    const view = render(instance)
    const chip = cell(view, '2026-09-26').find('.abele-calendar-chip').element
    chip.dispatchEvent(pointer('pointerdown', 10, 10))
    under = cell(view, '2026-09-29').element
    window.dispatchEvent(pointer('pointermove', 60, 90))
    window.dispatchEvent(pointer('pointerup', 60, 90))
    expect(instance.move).not.toHaveBeenCalled()
  })
})

describe('the layouts', () => {
  it('are switched by the tabs, which the view stores in the base', async () => {
    const instance = makeInstance([])
    const view = render(instance)
    const tabs = view.findAll('.abele-calendar-base__modes .abele-tabs__tab')
    expect(tabs.map((t) => t.text())).toEqual(['Month', 'Week', 'Year'])
    await tabs[2].trigger('click')
    expect(instance.setMode).toHaveBeenCalledWith('year')
    expect(view.find('.abele-calendar-year').exists()).toBe(true)
  })
})
