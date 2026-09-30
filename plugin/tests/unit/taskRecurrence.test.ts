import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { RecurrenceParser } from '@/helpers/RecurrenceParser'

const parser = new RecurrenceParser()
const stamp = (value: ReturnType<typeof parser.getNextDate>) =>
  value?.format('YYYY-MM-DD HH:mm:ss.SSS') ?? null

beforeEach(() => vi.stubEnv('TZ', 'Europe/Berlin'))
afterEach(() => vi.unstubAllEnvs())

describe('task recurrence grammar', () => {
  it.each(['hour', 'day', 'week', 'month', 'year'])(
    'parses singular and counted %s intervals',
    (unit) => {
      expect(parser.parse(`every ${unit}`)).toEqual({
        interval: { value: 1, unit },
        specificDays: null,
        fromCompletion: false,
      })
      expect(parser.parse(`  EVERY 3 ${unit.toUpperCase()}S FROM COMPLETION  `)).toEqual({
        interval: { value: 3, unit },
        specificDays: null,
        fromCompletion: true,
      })
    }
  )

  it.each(['', 'daily', 'every', 'every -2 days', 'on nonsense', 'every first someday'])(
    'rejects %j',
    (pattern) => {
      expect(parser.parse(pattern)).toBeNull()
      expect(parser.getNextDate(dayjs('2028-01-01'), pattern)).toBeNull()
    }
  )

  it('accepts abbreviated/full weekdays, ignoring unknown words and retaining duplicates', () => {
    expect(parser.parse('on Mon, tuesday Wed, Thursday fri saturday Sunday mon unknown')).toEqual({
      interval: { value: 1, unit: 'week' },
      specificDays: { type: 'weekdays', days: [1, 2, 3, 4, 5, 6, 0, 1] },
      fromCompletion: false,
    })
  })

  it('currently accepts embedded patterns and zero intervals', () => {
    expect(parser.parse('please every 0 days afterwards')?.interval).toEqual({
      value: 0,
      unit: 'day',
    })
    expect(stamp(parser.getNextDate(dayjs('2028-01-01'), 'every 0 days'))).toBe(
      '2028-01-01 00:00:00.000'
    )
  })

  // BUG: the weekday regex also matches digits, so the guarded monthdays parser never runs.
  // A recurrence entered as "every month on 1,15" advances a month instead of to the 15th.
  it.fails('recognizes numbered days of the month', () => {
    expect(parser.parse('every month on 1,15')?.specificDays).toEqual({
      type: 'monthdays',
      days: [1, 15],
    })
    expect(stamp(parser.getNextDate(dayjs('2028-01-02'), 'every month on 1,15'))).toBe(
      '2028-01-15 00:00:00.000'
    )
  })
})

describe('next recurring task date', () => {
  it.each([
    ['2028-01-31 23:30', 'every 2 hours', '2028-02-01 01:30:00.000'],
    ['2028-02-28 09:15', 'every day', '2028-02-29 09:15:00.000'],
    ['2027-02-28 09:15', 'every day', '2027-03-01 09:15:00.000'],
    ['2028-01-31 09:15', 'every month', '2028-02-29 09:15:00.000'],
    ['2028-02-29 09:15', 'every year', '2029-02-28 09:15:00.000'],
    ['2028-12-30 09:15', 'every week', '2029-01-06 09:15:00.000'],
    ['2028-01-02 09:15', 'on Monday', '2028-01-03 09:15:00.000'],
    ['2028-01-03 09:15', 'on Monday', '2028-01-10 09:15:00.000'],
    ['2028-01-07 09:15', 'every week on Mon, Wed, Fri', '2028-01-10 09:15:00.000'],
    // Current interpretation: interval bounds the search, not a number of weeks to skip.
    ['2028-01-03 09:15', 'every 2 weeks on Monday', '2028-01-10 09:15:00.000'],
    ['2028-01-01', 'every first Monday', '2028-01-03 00:00:00.000'],
    ['2028-01-03', 'every first Monday', '2028-02-07 00:00:00.000'],
    ['2028-01-04', 'every first Monday', '2028-02-07 00:00:00.000'],
    ['2028-01-01', 'every last Friday', '2028-01-28 23:59:59.999'],
    ['2028-01-28', 'every last Friday', '2028-02-25 23:59:59.999'],
    ['2028-12-31', 'every last Friday', '2029-01-26 23:59:59.999'],
    ['2028-01-01', 'every first day of month', '2028-02-01 00:00:00.000'],
    ['2028-01-31', 'every first day of month', '2028-02-01 00:00:00.000'],
    ['2028-02-01', 'every last day of month', '2028-02-29 00:00:00.000'],
    ['2028-02-29 12:00', 'every last day of month', '2028-03-31 00:00:00.000'],
    ['2028-01-01', 'every first day of year', '2029-01-01 00:00:00.000'],
    ['2028-01-01', 'every last day of year', '2028-12-31 00:00:00.000'],
    ['2028-12-31', 'every last day of year', '2029-12-31 00:00:00.000'],
  ])('%s / %s → %s', (base, pattern, expected) => {
    const date = dayjs(base)
    expect(stamp(parser.getNextDate(date, pattern))).toBe(expected)
    expect(date.format('YYYY-MM-DD HH:mm')).toBe(dayjs(base).format('YYYY-MM-DD HH:mm'))
  })

  it('uses completion only when requested and supplied', () => {
    const base = dayjs('2028-01-01 08:00')
    const completed = dayjs('2028-01-10 19:30')
    expect(stamp(parser.getNextDate(base, 'every 3 days', completed))).toBe(
      '2028-01-04 08:00:00.000'
    )
    expect(stamp(parser.getNextDate(base, 'every 3 days from completion', completed))).toBe(
      '2028-01-13 19:30:00.000'
    )
    expect(stamp(parser.getNextDate(base, 'every 3 days from completion'))).toBe(
      '2028-01-04 08:00:00.000'
    )
  })

  it.each(['every day on Monday', 'every month on Monday', 'every 0 weeks on Monday'])(
    'parses but cannot calculate %s',
    (pattern) => {
      expect(parser.parse(pattern)).not.toBeNull()
      expect(parser.getNextDate(dayjs('2028-01-01'), pattern)).toBeNull()
    }
  )

  it('keeps local clock time across the spring DST boundary', () => {
    const base = dayjs('2028-03-25 09:00')
    const next = parser.getNextDate(base, 'every day')!
    expect(next.format('YYYY-MM-DD HH:mm Z')).toBe('2028-03-26 09:00 +02:00')
    expect(next.diff(base, 'hour')).toBe(23)
  })
})
