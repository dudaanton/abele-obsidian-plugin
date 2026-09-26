/**
 * A life in weeks: a row per year of age, fifty-two weeks to a row, counted from the birthday.
 * Which week a day falls in, what days a week covers, how many items each week holds, and
 * where on the grid each week is drawn.
 */
import { describe, it, expect } from 'vitest'
import {
  WEEKS_PER_ROW,
  birthday,
  isBirthDate,
  lifeCounts,
  lifeGrid,
  lifeRows,
  lifeSummary,
  lifeWeekAt,
  lifeWeekOf,
  lifeYears,
  weekAtPoint,
  weekOrigin,
} from '@/bases/lifeWeeks'
import type { CalendarItem } from '@/bases/calendarLayout'
import { AbeleConfig } from '@/services/AbeleConfig'

const item = (start: string, end = start, title = start): CalendarItem => ({
  id: title,
  kind: 'note',
  path: `${title}.md`,
  title,
  start,
  end,
  startMinute: null,
  endMinute: null,
  color: null,
  completed: false,
})

describe('the birth date', () => {
  it('takes a real day and nothing else', () => {
    expect(isBirthDate('1990-05-17')).toBe(true)
    expect(isBirthDate('2000-02-29')).toBe(true)
    expect(isBirthDate('2001-02-29')).toBe(false)
    expect(isBirthDate('1990-13-01')).toBe(false)
    expect(isBirthDate('17.05.1990')).toBe(false)
    expect(isBirthDate('')).toBe(false)
    expect(isBirthDate(undefined)).toBe(false)
  })

  it('keeps a birthday of 29 February on the 28th in a year without one', () => {
    expect(birthday('2000-02-29', 1)).toBe('2001-02-28')
    expect(birthday('2000-02-29', 4)).toBe('2004-02-29')
    expect(birthday('1990-05-17', 36)).toBe('2026-05-17')
  })
})

describe('the week a day falls in', () => {
  const birth = '1990-05-17'

  it('starts the first week on the day of birth', () => {
    expect(lifeWeekOf(birth, '1990-05-17')).toEqual({ age: 0, week: 0, index: 0 })
    expect(lifeWeekOf(birth, '1990-05-23')).toEqual({ age: 0, week: 0, index: 0 })
    expect(lifeWeekOf(birth, '1990-05-24')).toEqual({ age: 0, week: 1, index: 1 })
  })

  it('has nothing before the day of birth', () => {
    expect(lifeWeekOf(birth, '1990-05-16')).toBeNull()
  })

  it('starts each row again on the birthday, the last week taking the day or two left over', () => {
    // 1991-05-17 is 365 days on: 52 weeks and one day. That day is still in week 52.
    expect(lifeWeekOf(birth, '1991-05-16')).toEqual({ age: 0, week: 51, index: 51 })
    expect(lifeWeekOf(birth, '1991-05-17')).toEqual({ age: 1, week: 0, index: 52 })
    expect(lifeWeekOf(birth, '2026-09-27')).toEqual({
      age: 36,
      week: 19,
      index: 36 * WEEKS_PER_ROW + 19,
    })
  })

  it('lets the last week of a leap year hold two extra days', () => {
    // Born 2003-03-01: the year to 2004-03-01 has 366 days, so week 52 runs nine days.
    expect(lifeWeekOf('2003-03-01', '2004-02-22')?.week).toBe(51)
    expect(lifeWeekOf('2003-03-01', '2004-02-29')?.week).toBe(51)
    expect(lifeWeekOf('2003-03-01', '2004-03-01')).toEqual({ age: 1, week: 0, index: 52 })
  })

  it('counts a 29 February birthday as passed on the 28th in a year without one', () => {
    expect(lifeWeekOf('2000-02-29', '2001-02-27')?.age).toBe(0)
    expect(lifeWeekOf('2000-02-29', '2001-02-28')).toEqual({ age: 1, week: 0, index: 52 })
    expect(lifeWeekOf('2000-02-29', '2004-02-28')?.age).toBe(3)
    expect(lifeWeekOf('2000-02-29', '2004-02-29')?.age).toBe(4)
  })

  it('gives the days a week covers, the last one up to the eve of the birthday', () => {
    expect(lifeWeekAt(birth, 0)).toMatchObject({ start: '1990-05-17', end: '1990-05-23' })
    expect(lifeWeekAt(birth, 51)).toMatchObject({ age: 0, week: 51, end: '1991-05-16' })
    expect(lifeWeekAt(birth, 52)).toMatchObject({ age: 1, week: 0, start: '1991-05-17' })
    expect(lifeWeekAt('2003-03-01', 51)).toMatchObject({ start: '2004-02-21', end: '2004-02-29' })
  })

  it('does not move with the clock of the device', () => {
    const before = process.env.TZ
    const results: unknown[] = []
    for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = tz
      results.push([lifeWeekOf(birth, '2026-03-29'), lifeWeekAt(birth, 1872)])
    }
    process.env.TZ = before
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
  })
})

describe('what a life holds', () => {
  const birth = '1990-05-17'

  it('counts each item once in every week it touches', () => {
    const counts = lifeCounts(
      [
        item('1990-05-17'),
        item('1990-05-20', '1990-05-20', 'second'),
        item('1990-05-22', '1990-06-01', 'span'),
      ],
      birth,
      80
    )
    expect(counts.length).toBe(80 * WEEKS_PER_ROW)
    expect(counts[0]).toBe(3)
    expect(counts[1]).toBe(1)
    expect(counts[2]).toBe(1)
    expect(counts[3]).toBe(0)
  })

  it('leaves out what is before the birth or past the last row, clipping a span to the life', () => {
    const counts = lifeCounts(
      [item('1980-01-01'), item('1990-01-01', '1990-05-18', 'across'), item('2090-01-01')],
      birth,
      80
    )
    expect(counts[0]).toBe(1)
    expect([...counts].reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('sums up the weeks behind and ahead', () => {
    expect(lifeSummary(birth, 80, '2026-09-27')).toEqual({
      total: 4160,
      lived: 36 * 52 + 19,
      left: 4160 - (36 * 52 + 19),
      current: 36 * 52 + 19,
      percent: 45.5,
    })
    expect(lifeSummary(birth, 30, '2026-09-27')).toMatchObject({
      lived: 1560,
      left: 0,
      current: -1,
    })
    expect(lifeSummary(birth, 80, '1980-01-01')).toMatchObject({ lived: 0, current: -1 })
  })

  it('keeps drawing rows past the expected age for someone already older', () => {
    expect(lifeRows(birth, 80, '2026-09-27')).toBe(80)
    expect(lifeRows(birth, 30, '2026-09-27')).toBe(37)
  })

  it('reads the expected age from a view option, falling back on the setting', () => {
    expect(lifeYears('90', 80)).toBe(90)
    expect(lifeYears(' 72 ', 80)).toBe(72)
    expect(lifeYears('', 80)).toBe(80)
    expect(lifeYears(null, 80)).toBe(80)
    expect(lifeYears('abc', 80)).toBe(80)
    expect(lifeYears('0', 80)).toBe(80)
    expect(lifeYears('500', 80)).toBe(80)
  })
})

describe('the grid', () => {
  it('fits fifty-two weeks across a phone', () => {
    const grid = lifeGrid(358, 80)
    expect(grid.width).toBeLessThanOrEqual(358)
    expect(grid.cell).toBeGreaterThanOrEqual(4)
    expect(grid.numbers).toBe(false)
  })

  it('grows the cells on a wide view up to a size that holds a number, and no further', () => {
    const grid = lifeGrid(1400, 80)
    expect(grid.numbers).toBe(true)
    expect(grid.cell).toBeLessThanOrEqual(20)
    expect(grid.width).toBeLessThanOrEqual(1400)
  })

  it('finds the week under a point, and nothing in a gap or outside the rows', () => {
    const grid = lifeGrid(900, 80)
    for (const index of [0, 25, 26, 51, 52, 519, 520, 4159]) {
      const [x, y] = weekOrigin(grid, index)
      expect(weekAtPoint(grid, x + 1, y + 1)).toBe(index)
      expect(weekAtPoint(grid, x + grid.cell - 1, y + grid.cell - 1)).toBe(index)
    }
    const [x, y] = weekOrigin(grid, 0)
    expect(weekAtPoint(grid, x - 2, y + 1)).toBeNull()
    expect(weekAtPoint(grid, x + 1, grid.height + 5)).toBeNull()
  })

  it('opens a gap every ten years and at the half of a year', () => {
    const grid = lifeGrid(900, 80)
    const rowStep = weekOrigin(grid, 52)[1] - weekOrigin(grid, 0)[1]
    expect(weekOrigin(grid, 520)[1] - weekOrigin(grid, 468)[1]).toBeGreaterThan(rowStep)
    const colStep = weekOrigin(grid, 1)[0] - weekOrigin(grid, 0)[0]
    expect(weekOrigin(grid, 26)[0] - weekOrigin(grid, 25)[0]).toBeGreaterThan(colStep)
  })
})

describe('the settings', () => {
  it('start with no birth date and eighty years, and survive a save and a load', () => {
    const config = AbeleConfig.getInstance()
    config.applySettings(undefined)
    expect(config.birthDate).toBe('')
    expect(config.lifeExpectancy).toBe(80)
    config.birthDate = '1990-05-17'
    config.lifeExpectancy = 85
    const saved = JSON.parse(JSON.stringify(config.exportSettings()))
    config.applySettings(undefined)
    config.applySettings(saved)
    expect(config.birthDate).toBe('1990-05-17')
    expect(config.lifeExpectancy).toBe(85)
  })

  it('drop a birth date that is not a day and an age that is not a life', () => {
    const config = AbeleConfig.getInstance()
    config.applySettings({ refreshDelay: 300, birthDate: '17.05.1990', lifeExpectancy: 0 })
    expect(config.birthDate).toBe('')
    expect(config.lifeExpectancy).toBe(80)
  })
})
