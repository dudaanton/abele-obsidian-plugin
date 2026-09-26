/**
 * The calendar view of a base: which day a note lands on, how a week's hours are shared by
 * items at the same time, how the year is tinted, and what a note made on a day is given.
 */
import { describe, it, expect } from 'vitest'
import {
  addDays,
  applyMove,
  dayOrder,
  countByDay,
  heatLevel,
  layoutTimed,
  monthGrid,
  newNoteFrontmatter,
  placeByDay,
  readDate,
  readTime,
  startOfWeek,
  toItem,
  weekDays,
  weekday,
  eventToItem,
  type CalendarItem,
} from '@/bases/calendarLayout'
import type { CalendarEvent } from '@/calendars/events'

const item = (over: Partial<CalendarItem>): CalendarItem => ({
  id: over.title ?? 'x',
  kind: 'note',
  path: `${over.title ?? 'x'}.md`,
  title: 'x',
  start: '2026-09-26',
  end: '2026-09-26',
  startMinute: null,
  endMinute: null,
  color: null,
  completed: false,
  ...over,
})

describe('days', () => {
  it('knows the weekday and walks across a clock change without losing a day', () => {
    expect(weekday('2026-09-26')).toBe(6)
    expect(weekday('2026-09-28')).toBe(1)
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('starts the week on Monday or Sunday, as the settings say', () => {
    expect(startOfWeek('2026-09-26', true)).toBe('2026-09-21')
    expect(startOfWeek('2026-09-26', false)).toBe('2026-09-20')
    expect(startOfWeek('2026-09-21', true)).toBe('2026-09-21')
    expect(weekDays('2026-09-23', true)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ])
  })

  it('draws a month in whole weeks, from the week of the 1st to the week of the last day', () => {
    const sep = monthGrid(2026, 8, true)
    expect(sep[0]).toBe('2026-08-31')
    expect(sep.at(-1)).toBe('2026-10-04')
    expect(sep.length).toBe(35)
    const feb = monthGrid(2027, 1, true)
    expect(feb.length).toBe(28)
    expect(monthGrid(2026, 7, false).length).toBe(42)
  })
})

describe('reading values', () => {
  it('reads a date, a date with a time, and a list that starts with one', () => {
    expect(readDate('2026-09-26')).toEqual({ day: '2026-09-26', minute: null })
    expect(readDate('2026-09-26T09:30')).toEqual({ day: '2026-09-26', minute: 570 })
    expect(readDate('2026-09-26 18:05:00')).toEqual({ day: '2026-09-26', minute: 1085 })
    expect(readDate(['2026-09-26', '2026-10-01'])).toEqual({ day: '2026-09-26', minute: null })
  })

  it('takes nothing that does not start with a date', () => {
    expect(readDate(null)).toBeNull()
    expect(readDate('null')).toBeNull()
    expect(readDate('')).toBeNull()
    expect(readDate('meeting on 2026-09-26')).toBeNull()
  })

  it('reads a time as text, and as the number YAML makes of an unquoted one', () => {
    expect(readTime('09:30')).toBe(570)
    expect(readTime('9:05')).toBe(545)
    expect(readTime(570)).toBe(570)
    expect(readTime('25:00')).toBeNull()
    expect(readTime('9:75')).toBeNull()
    expect(readTime('soon')).toBeNull()
    expect(readTime(undefined)).toBeNull()
  })
})

describe('placing a note, as tasks are placed', () => {
  it('puts it on its date, with the time from the separate property', () => {
    expect(
      toItem({ path: 'a.md', title: 'a', start: '2026-09-26', startTime: '10:00' })
    ).toMatchObject({
      start: '2026-09-26',
      end: '2026-09-26',
      startMinute: 600,
      endMinute: null,
    })
  })

  it('puts a task with only a due date on that date', () => {
    expect(
      toItem({ path: 'a.md', title: 'a', start: null, end: '2026-09-30', endTime: '17:00' })
    ).toMatchObject({ start: '2026-09-30', end: '2026-09-30', startMinute: 1020 })
  })

  it('spans the days from the date to the due date', () => {
    expect(
      toItem({ path: 'a.md', title: 'a', start: '2026-09-26', end: '2026-09-29' })
    ).toMatchObject({ start: '2026-09-26', end: '2026-09-29' })
  })

  it('uses a due time on the same day as the end of a timed item', () => {
    expect(
      toItem({
        path: 'a.md',
        title: 'a',
        start: '2026-09-26',
        startTime: '10:00',
        end: '2026-09-26',
        endTime: '11:30',
      })
    ).toMatchObject({ startMinute: 600, endMinute: 690 })
  })

  it('ignores an end before the start, and a note with no date at all', () => {
    expect(
      toItem({ path: 'a.md', title: 'a', start: '2026-09-26', end: '2026-09-20' })
    ).toMatchObject({ start: '2026-09-26', end: '2026-09-26' })
    expect(toItem({ path: 'a.md', title: 'a', start: null, end: null })).toBeNull()
  })
})

describe('a day lists', () => {
  it('spans first, then things with no time, then by time', () => {
    const items = [
      item({ title: 'lunch', startMinute: 780 }),
      item({ title: 'call', startMinute: 540 }),
      item({ title: 'buy milk' }),
      item({ title: 'trip', start: '2026-09-25', end: '2026-09-28' }),
    ]
    const day = placeByDay(items, '2026-09-26', '2026-09-26').get('2026-09-26')!
    expect(day.map((p) => p.item.title)).toEqual(['trip', 'buy milk', 'call', 'lunch'])
    expect(day[0]).toMatchObject({ fromBefore: true, goesOn: true })
  })

  it("in the base's own sort when it has one, done tasks last if that is how it sorts", () => {
    const items = [
      item({ title: 'a done', completed: true, startMinute: 540, order: 2 }),
      item({ title: 'lunch', startMinute: 780, order: 1 }),
      item({ title: 'trip', start: '2026-09-25', end: '2026-09-28', order: 3 }),
      item({ title: 'buy milk', order: 0 }),
      item({ title: 'event', kind: 'event', startMinute: 600 }),
    ]
    const day = placeByDay(items, '2026-09-26', '2026-09-26').get('2026-09-26')!
    expect(day.map((p) => p.item.title)).toEqual(['buy milk', 'lunch', 'a done', 'trip', 'event'])
  })

  it('with done tasks last, by default, whether the base sorts or not', () => {
    const row = (index: number, completed: boolean, sorted: boolean, doneLast = true) =>
      dayOrder({ index, count: 10, sorted, doneLast, completed })
    const unsorted = [
      item({ title: 'a done', completed: true, order: row(0, true, false) }),
      item({ title: 'b', startMinute: 600, order: row(1, false, false) }),
      item({ title: 'c', order: row(2, false, false) }),
    ]
    const day = (items: CalendarItem[]) =>
      placeByDay(items, '2026-09-26', '2026-09-26')
        .get('2026-09-26')!
        .map((p) => p.item.title)
    // The rest keep the calendar's own order: no time before a time.
    expect(day(unsorted)).toEqual(['c', 'b', 'a done'])
    const sorted = [
      item({ title: 'a done', completed: true, order: row(0, true, true) }),
      item({ title: 'b', order: row(1, false, true) }),
      item({ title: 'c', order: row(2, false, true) }),
    ]
    expect(day(sorted)).toEqual(['b', 'c', 'a done'])
    expect(row(0, true, false, false)).toBeNull()
    expect(row(3, true, true, false)).toBe(3)
  })

  it('clips a long span to the days drawn', () => {
    const long = item({ title: 'year', start: '2020-01-01', end: '2030-01-01' })
    const days = placeByDay([long], '2026-09-01', '2026-09-07')
    expect([...days.keys()].length).toBe(7)
    expect(days.get('2026-09-01')![0].fromBefore).toBe(true)
  })

  it('places hundreds of notes over a month quickly', () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      item({ title: `n${i}`, start: addDays('2026-01-01', i % 365), startMinute: (i * 7) % 1440 })
    )
    const t = performance.now()
    const days = placeByDay(many, '2026-08-31', '2026-10-11')
    expect(performance.now() - t).toBeLessThan(100)
    expect(days.get('2026-09-26')!.length).toBeGreaterThan(0)
  })
})

describe('the week hours', () => {
  it('gives items at the same time a column each, and the rest the whole width', () => {
    const blocks = layoutTimed([
      item({ title: 'a', startMinute: 540, endMinute: 600 }),
      item({ title: 'b', startMinute: 570, endMinute: 630 }),
      item({ title: 'c', startMinute: 720 }),
      item({ title: 'untimed' }),
    ])
    const by = Object.fromEntries(blocks.map((b) => [b.item.title, b]))
    expect(Object.keys(by).sort()).toEqual(['a', 'b', 'c'])
    expect(by.a).toMatchObject({ column: 0, columns: 2 })
    expect(by.b).toMatchObject({ column: 1, columns: 2 })
    expect(by.c).toMatchObject({ column: 0, columns: 1, top: 720, bottom: 780 })
  })

  it('reuses a column freed earlier in the cluster', () => {
    const blocks = layoutTimed([
      item({ title: 'long', startMinute: 540, endMinute: 720 }),
      item({ title: 'first', startMinute: 540, endMinute: 600 }),
      item({ title: 'second', startMinute: 600, endMinute: 660 }),
    ])
    const by = Object.fromEntries(blocks.map((b) => [b.item.title, b]))
    expect(by.long.column).toBe(0)
    expect(by.first.column).toBe(1)
    expect(by.second.column).toBe(1)
    expect(by.second.columns).toBe(2)
  })

  it('draws a short item tall enough to read and nothing past midnight', () => {
    const [short] = layoutTimed([item({ startMinute: 600, endMinute: 605 })])
    expect(short.bottom - short.top).toBe(30)
    const [late] = layoutTimed([item({ startMinute: 1420 })])
    expect(late.bottom).toBe(1440)
  })
})

describe('the year', () => {
  it('counts each day an item covers and tints relative to the busiest day', () => {
    const counts = countByDay(
      [item({}), item({ start: '2026-09-25', end: '2026-09-27' })],
      '2026-01-01',
      '2026-12-31'
    )
    expect(counts.get('2026-09-26')).toBe(2)
    expect(counts.get('2026-09-27')).toBe(1)
    expect(heatLevel(0, 5)).toBe(0)
    expect(heatLevel(1, 1)).toBe(4)
    expect(heatLevel(1, 7)).toBe(1)
    expect(heatLevel(7, 7)).toBe(4)
    expect(heatLevel(4, 7)).toBe(2)
  })
})

describe('a note made on the calendar', () => {
  it('is given the day, and the hour in the time property', () => {
    expect(
      newNoteFrontmatter({ dateKey: 'date', timeKey: 'dateTime' }, '2026-09-26', null)
    ).toEqual({
      date: '2026-09-26',
    })
    expect(newNoteFrontmatter({ dateKey: 'date', timeKey: 'dateTime' }, '2026-09-26', 540)).toEqual(
      {
        date: '2026-09-26',
        dateTime: '09:00',
      }
    )
  })

  it('writes the hour into the date when there is no time property', () => {
    expect(newNoteFrontmatter({ dateKey: 'when', timeKey: null }, '2026-09-26', 810)).toEqual({
      when: '2026-09-26T13:30',
    })
  })

  it('cannot be made when the date is a formula', () => {
    expect(newNoteFrontmatter({ dateKey: null, timeKey: null }, '2026-09-26', null)).toBe(false)
  })
})

describe('a note moved on the calendar', () => {
  const TASK = { dateKey: 'date', timeKey: 'dateTime', endKey: 'due', endTimeKey: 'dueTime' }

  it('moves its day, and a span as a whole', () => {
    const fm: Record<string, unknown> = { date: '2026-09-26', due: '2026-09-28', tags: ['x'] }
    const trip = item({ start: '2026-09-26', end: '2026-09-28' })
    expect(applyMove(fm, TASK, trip, 3, null)).toBe(true)
    expect(fm).toEqual({ date: '2026-09-29', due: '2026-10-01', tags: ['x'] })
  })

  it('keeps its time when dropped on a day, and moves it when dropped on an hour', () => {
    const fm: Record<string, unknown> = { date: '2026-09-26', dateTime: '09:00' }
    const call = item({ startMinute: 540 })
    applyMove(fm, TASK, call, 1, null)
    expect(fm).toEqual({ date: '2026-09-27', dateTime: '09:00' })
    applyMove(fm, TASK, call, 0, 14 * 60 + 15)
    expect(fm).toEqual({ date: '2026-09-27', dateTime: '14:15' })
  })

  it('keeps how long it lasts', () => {
    const fm: Record<string, unknown> = {
      date: '2026-09-26',
      dateTime: '15:00',
      due: '2026-09-26',
      dueTime: '16:30',
    }
    const dentist = item({ startMinute: 900, endMinute: 990 })
    applyMove(fm, TASK, dentist, -1, 600)
    expect(fm).toEqual({
      date: '2026-09-25',
      dateTime: '10:00',
      due: '2026-09-25',
      dueTime: '11:30',
    })
  })

  it('writes the time where the note keeps it', () => {
    const fm: Record<string, unknown> = { when: '2026-09-26T09:00' }
    const keys = { dateKey: 'when', timeKey: null, endKey: null, endTimeKey: null }
    applyMove(fm, keys, item({ startMinute: 540 }), 2, 780)
    expect(fm).toEqual({ when: '2026-09-28T13:00' })
    const bare: Record<string, unknown> = { when: '2026-09-26' }
    applyMove(bare, keys, item({}), 0, 600)
    expect(bare).toEqual({ when: '2026-09-26T10:00' })
  })

  it('moves a task with only a deadline by its deadline', () => {
    const fm: Record<string, unknown> = { due: '2026-09-26' }
    applyMove(fm, TASK, item({}), 1, 480)
    expect(fm).toEqual({ due: '2026-09-27', dueTime: '08:00' })
  })

  it('writes nothing when the date is not a note property', () => {
    const fm: Record<string, unknown> = { date: '2026-09-26' }
    const keys = { dateKey: null, timeKey: null, endKey: null, endTimeKey: null }
    expect(applyMove(fm, keys, item({}), 1, null)).toBe(false)
    expect(fm).toEqual({ date: '2026-09-26' })
  })
})

describe('an event from an external calendar', () => {
  const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
    id: 'f:e:1',
    feedId: 'f',
    uid: 'e',
    title: 'Standup',
    allDay: false,
    start: new Date(2026, 8, 26, 9, 0).getTime(),
    end: new Date(2026, 8, 26, 9, 30).getTime(),
    location: '',
    description: '',
    url: '',
    attendees: [],
    ...over,
  })

  it('is placed at its time on this device’s clock, in its calendar’s colour', () => {
    expect(eventToItem(event({}), 'green')).toMatchObject({
      kind: 'event',
      start: '2026-09-26',
      end: '2026-09-26',
      startMinute: 540,
      endMinute: 570,
      color: 'green',
    })
  })

  it('ends a meeting that runs until midnight on its own day', () => {
    const late = event({
      start: new Date(2026, 8, 26, 22).getTime(),
      end: new Date(2026, 8, 27).getTime(),
    })
    expect(eventToItem(late, 'blue')).toMatchObject({ end: '2026-09-26', endMinute: 1440 })
  })

  it('covers the days of a day-long one, with no time', () => {
    const trip = event({ allDay: true, startDay: '2026-09-26', endDay: '2026-09-29' })
    expect(eventToItem(trip, 'red')).toMatchObject({
      start: '2026-09-26',
      end: '2026-09-28',
      startMinute: null,
      endMinute: null,
    })
  })
})
