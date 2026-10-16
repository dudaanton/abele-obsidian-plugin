/**
 * The small calendars' year: the title switches between the month and its year, a month's name
 * opens that month, days are squares tinted by what is on them, and a box still to tick is an
 * outline.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CalendarYear from '@/components/calendarBase/CalendarYear.vue'
import { levelsOfCounts, levelsOfMarks } from '@/components/calendarYearLevels'

describe('year levels', () => {
  it('tints a ticked day in full, words by half, and outlines a box left open', () => {
    const levels = levelsOfMarks(
      new Map([
        ['2026-10-01', 'done'],
        ['2026-10-02', 'entry'],
        ['2026-10-03', 'open'],
      ] as const)
    )
    expect([...levels.values()]).toEqual([4, 2, 'open'])
  })

  it('counts against the busiest day of the year and leaves empty days out', () => {
    const levels = levelsOfCounts(
      new Map([
        ['2026-01-01', 1],
        ['2026-01-02', 4],
        ['2026-01-03', 0],
      ])
    )
    expect(levels.get('2026-01-02')).toBe(4)
    expect(levels.get('2026-01-01')).toBe(1)
    expect(levels.has('2026-01-03')).toBe(false)
  })
})

describe('CalendarYear, compact', () => {
  const view = () =>
    mount(CalendarYear, {
      props: {
        year: 2026,
        mondayFirst: true,
        items: [],
        today: '2026-10-16',
        selected: '2026-10-14',
        compact: true,
        levels: new Map([
          ['2026-10-14', 4],
          ['2026-10-15', 'open'],
        ] as const),
      },
    })

  it('draws days as squares without numbers, the date read out instead', () => {
    const day = view().get('[data-day="2026-10-14"]')
    expect(day.text()).toBe('')
    expect(day.attributes('aria-label')).toContain('14 October')
    expect(day.classes()).toContain('abele-calendar-year__day_heat-4')
  })

  it('outlines a day still to do and opens a month from its name', async () => {
    const v = view()
    expect(v.get('[data-day="2026-10-15"]').classes()).toContain(
      'abele-calendar-year__day_heat-open'
    )
    await v.findAll('.abele-calendar-year__month-name')[9].trigger('click')
    expect(v.emitted('month')).toEqual([[9]])
  })
})
