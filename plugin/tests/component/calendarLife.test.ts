/**
 * The calendar's life in weeks, drawn: the prompt for a birth date when there is none, the
 * weeks lived and left, the week that is picked — this one until another is pressed — listed
 * under the grid with what is in it, and the arrows walking the weeks.
 */
process.env.TZ = 'Europe/Berlin'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref, shallowRef } from 'vue'
import CalendarBase from '@/components/calendarBase/CalendarBase.vue'
import type { CalendarBaseInstance } from '@/bases/CalendarView'
import type { CalendarItem, CalendarMode } from '@/bases/calendarLayout'
import { lifeGrid, weekOrigin } from '@/bases/lifeWeeks'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault, configureAbele } from '../helpers/testEnv'

const item = (title: string, start: string, end = start): CalendarItem => ({
  id: `Tasks/${title}.md`,
  kind: 'note',
  path: `Tasks/${title}.md`,
  title,
  start,
  end,
  startMinute: null,
  endMinute: null,
  color: null,
  completed: false,
})

function makeInstance(items: CalendarItem[], lifeYears: number | null = null) {
  const instance = {
    id: 'c1',
    el: document.createElement('div'),
    items: shallowRef(items),
    groups: shallowRef([]),
    undated: ref(0),
    mode: ref<CalendarMode>('life'),
    showEvents: ref(false),
    canCreate: ref(true),
    lifeYears: ref<number | null>(lifeYears),
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

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let wrapper: VueWrapper | null = null
const render = (instance: CalendarBaseInstance) => {
  wrapper = mount(CalendarBase, { props: { instance }, attachTo: document.body })
  return wrapper
}

const BIRTH = '1990-05-17'
/** 2026-09-26 is in the nineteenth week of age 36. */
const THIS_WEEK = 36 * 52 + 18

let config: AbeleConfig

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 26, 10, 30), toFake: ['Date'] })
  useVault([])
  config = configureAbele()
  config.birthDate = BIRTH
  config.lifeExpectancy = 80
  GlobalStore.getInstance().weekStartsOnMonday.value = true
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  config.birthDate = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a life in weeks', () => {
  it('asks for the birth date when there is none, and saves the one given', async () => {
    config.birthDate = ''
    const save = vi.spyOn(config, 'saveSettings').mockImplementation(async () => {
      config.version.value++
    })
    const view = render(makeInstance([]))
    expect(view.find('.abele-calendar-life').exists()).toBe(false)
    const button = view.find('.abele-calendar-base__birth button')
    expect(button.attributes('disabled')).toBeDefined()

    await view.find('.abele-calendar-base__birth input').setValue(BIRTH)
    expect(view.find('.abele-calendar-base__birth input').attributes('type')).toBe('date')
    await view.find('.abele-calendar-base__birth button').trigger('click')
    await nextTick()
    expect(save).toHaveBeenCalled()
    expect(config.birthDate).toBe(BIRTH)
    expect(view.find('.abele-calendar-life').exists()).toBe(true)
  })

  it('says how many weeks are lived and left', () => {
    const view = render(makeInstance([]))
    expect(view.find('.abele-calendar-base__title').text()).toBe('Life in weeks')
    expect(view.find('.abele-calendar-life__lived').text()).toBe(
      `${THIS_WEEK.toLocaleString()} weeks lived`
    )
    expect(view.find('.abele-calendar-life__left').text()).toBe(
      `${(80 * 52 - THIS_WEEK).toLocaleString()} left`
    )
    expect(view.find('.abele-calendar-life__percent').text()).toBe('45.4% of 80 years')
  })

  it("takes the view's own expected age over the setting", () => {
    const view = render(makeInstance([], 90))
    expect(view.find('.abele-calendar-life__percent').text()).toBe('40.4% of 90 years')
  })

  it('lists this week under the grid, with the days its notes are on', () => {
    const view = render(
      makeInstance([
        item('Dentist', '2026-09-24'),
        item('Trip', '2026-09-20', '2026-09-22'),
        item('Later', '2026-10-05'),
      ])
    )
    const panel = view.find('.abele-calendar-base__life-week')
    expect(panel.attributes('data-week')).toBe(String(THIS_WEEK))
    expect(panel.find('.abele-calendar-base__agenda-date').text()).toContain('Age 36, week 19')
    expect(panel.find('.abele-calendar-base__agenda-range').text()).toBe('20 Sep – 26 Sep 2026')
    expect(panel.findAll('.abele-calendar-chip__title').map((t) => t.text())).toEqual([
      'Trip',
      'Dentist',
    ])
    expect(panel.findAll('.abele-calendar-base__life-day').map((t) => t.text())).toEqual([
      'Sun 20',
      'Thu 24',
    ])
  })

  it('picks a pressed week, and opens its days by the hour from the list', async () => {
    const instance = makeInstance([item('First steps', '1991-06-01')])
    const view = render(instance)
    const grid = lifeGrid(320, 80)
    const [x, y] = weekOrigin(grid, 54)
    await view.find('canvas').trigger('click', { clientX: x + 1, clientY: y + 1 })
    const panel = view.find('.abele-calendar-base__life-week')
    expect(panel.attributes('data-week')).toBe('54')
    expect(panel.findAll('.abele-calendar-chip__title').map((t) => t.text())).toEqual([
      'First steps',
    ])
    await panel.find('.abele-calendar-base__agenda-week').trigger('click')
    expect(instance.setMode).toHaveBeenCalledWith('week')
    expect(view.find('.abele-calendar-base__title').text()).toMatch(/May 27 – Jun 2, 1991/)
  })

  it('walks the weeks with the arrows, and comes back to this one with Today', async () => {
    const view = render(makeInstance([]))
    const week = () => view.find('.abele-calendar-base__life-week').attributes('data-week')
    const icons = view.findAll('.abele-calendar-base__controls .abele-obsidian-icon')
    await icons[icons.length - 1].trigger('click')
    expect(week()).toBe(String(THIS_WEEK + 1))
    await view.find('canvas').trigger('keydown', { key: 'ArrowUp' })
    expect(week()).toBe(String(THIS_WEEK + 1 - 52))
    await view.find('.abele-calendar-base__controls button').trigger('click')
    expect(week()).toBe(String(THIS_WEEK))
  })
})
