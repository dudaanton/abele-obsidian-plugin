/**
 * A note's calendar tasks laid out as a month: the mark under each day (an open box while a task
 * of the day is left, a ticked one once all are done, a dot for a day of events alone), the order
 * of a day's rows, and the day the month opens on and moves to.
 */
import { describe, expect, it } from 'vitest'
import { dayInMonth, monthDays, monthMarks, openingDay } from '@/helpers/tasksMonth'

const task = (id: string, dates: string[], done = false, at = 0) => ({
  id,
  title: `Sample task ${id}`,
  dates,
  completedAt: done ? { valueOf: () => 1 } : null,
  getSortTimestamp: () => at,
})
const event = (id: string, allDay = true, start = 0) => ({
  event: { id, title: `Sample event ${id}`, allDay, start },
  feed: { id: 'sample-feed' },
})
const midnight = (day: string) => new Date(`${day}T00:00:00`).getTime()

describe('the marks under the days of the month', () => {
  const days = monthDays(
    [
      task('a', ['2026-03-02']),
      task('b', ['2026-03-02'], true),
      task('c', ['2026-03-04'], true),
      task('d', ['2026-03-04'], true),
      task('e', ['2026-03-09', '2026-03-10']),
    ],
    new Map([
      ['2026-03-04', [event('x')]],
      ['2026-03-06', [event('y')]],
    ]),
    midnight
  )
  const marks = monthMarks(days)

  it('leave the box open while one task of the day is not done', () => {
    expect(marks.get('2026-03-02')).toBe('open')
  })

  it('tick the box once every task of the day is done, events beside them or not', () => {
    expect(marks.get('2026-03-04')).toBe('done')
  })

  it('put a dot under a day that has only events', () => {
    expect(marks.get('2026-03-06')).toBe('entry')
  })

  it('mark every day a task spans, and no day that has nothing', () => {
    expect(marks.get('2026-03-09')).toBe('open')
    expect(marks.get('2026-03-10')).toBe('open')
    expect(marks.has('2026-03-05')).toBe(false)
  })
})

describe('the rows of a day', () => {
  it('stand in the order of the day: day-long events first, then by time', () => {
    const days = monthDays(
      [task('late', ['2026-03-02'], false, 2_000_000_000), task('early', ['2026-03-02'], false, 1)],
      new Map([
        ['2026-03-02', [event('timed', false, midnight('2026-03-02') + 5000), event('all')]],
      ]),
      midnight
    )
    expect(days.get('2026-03-02')!.map((item) => item.key)).toEqual([
      'event:all',
      'task:early',
      'event:timed',
      'task:late',
    ])
  })
})

describe('the day the month opens on', () => {
  it('is today when something is planned today, else the next planned day, else the last', () => {
    expect(openingDay(['2026-03-01', '2026-03-05'], '2026-03-05')).toBe('2026-03-05')
    expect(openingDay(['2026-03-01', '2026-03-09'], '2026-03-05')).toBe('2026-03-09')
    expect(openingDay(['2026-03-01', '2026-02-09'], '2026-03-05')).toBe('2026-03-01')
    expect(openingDay([], '2026-03-05')).toBe('2026-03-05')
  })

  it('moves into a turned month: its first planned day, else today, else the 1st', () => {
    const days = ['2026-04-12', '2026-04-03']
    expect(dayInMonth(days, '2026-03', '2026-03-20', '2026-03-05')).toBe('2026-03-20')
    expect(dayInMonth(days, '2026-04', '2026-03-20', '2026-03-05')).toBe('2026-04-03')
    expect(dayInMonth(days, '2026-05', '2026-04-03', '2026-05-07')).toBe('2026-05-07')
    expect(dayInMonth(days, '2026-06', '2026-04-03', '2026-05-07')).toBe('2026-06-01')
  })
})
