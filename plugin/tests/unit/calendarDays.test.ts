import { afterEach, describe, expect, it } from 'vitest'
import { addDays, dayNumber, dayString, localDay } from '@/helpers/calendarDays'
import { addDays as analyticsAddDays } from '@/analytics/resample'
import { addDays as calendarAddDays } from '@/bases/calendarLayout'
import { parseDate } from '@/analytics/table'
import { localDay as eventDay } from '@/calendars/events'

const oldTZ = process.env.TZ
afterEach(() => {
  if (oldTZ === undefined) delete process.env.TZ
  else process.env.TZ = oldTZ
})

describe('calendar days, separate from instants', () => {
  it.each(['Europe/Berlin', 'America/New_York', 'Pacific/Auckland'])(
    'keeps local days and DST arithmetic in %s',
    (zone) => {
      process.env.TZ = zone
      const instant = new Date(2024, 2, 31, 0, 30)
      expect(localDay(instant.getTime())).toBe('2024-03-31')
      expect(parseDate(instant)).toBe(eventDay(instant.getTime()))
      for (const day of ['2024-02-29', '2024-03-31', '2024-11-03', '2024-12-31']) {
        expect(dayString(dayNumber(day))).toBe(day)
        expect(addDays(addDays(day, 1), -1)).toBe(day)
        expect(analyticsAddDays(day, 1)).toBe(calendarAddDays(day, 1))
      }
      expect(addDays('2024-02-29', 1)).toBe('2024-03-01')
      expect(addDays('2024-03-31', 1)).toBe('2024-04-01')
    }
  )
})
