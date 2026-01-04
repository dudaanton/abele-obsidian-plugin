import dayjs, { Dayjs } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import weekday from 'dayjs/plugin/weekday'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(customParseFormat)
dayjs.extend(weekday)
dayjs.extend(isoWeek)

interface RecurrenceRule {
  interval: {
    value: number
    unit: 'hour' | 'day' | 'week' | 'month' | 'year'
  } | null
  specificDays: {
    type: 'weekdays' | 'monthdays'
    days: number[] // 0-6 for weekdays, 1-31 for monthdays
  } | null
  position?: 'first' | 'last' // for first/last weekday of month
  fromCompletion: boolean
}

export class RecurrenceParser {
  private weekdayMap: Record<string, number> = {
    mon: 1,
    monday: 1,
    tue: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
    sun: 0,
    sunday: 0,
  }

  parse(pattern: string): RecurrenceRule | null {
    const normalized = pattern.toLowerCase().trim()

    const rule: RecurrenceRule = {
      interval: null,
      specificDays: null,
      fromCompletion: normalized.includes('from completion'),
    }

    // Pattern: every (first|last) weekday
    const positionMatch = normalized.match(/every\s+(first|last)\s+(\w+day)/)
    if (positionMatch) {
      const [, position, weekday] = positionMatch
      const dayNum = this.weekdayMap[weekday]
      if (dayNum !== undefined) {
        rule.position = position as 'first' | 'last'
        rule.specificDays = {
          type: 'weekdays',
          days: [dayNum],
        }
        rule.interval = { value: 1, unit: 'month' }
        return rule
      }
    }

    // Pattern: every N units
    const intervalMatch = normalized.match(/every\s+(\d+)?\s*(hour|day|week|month|year)s?/)
    if (intervalMatch) {
      const [, count, unit] = intervalMatch
      rule.interval = {
        value: count ? parseInt(count) : 1,
        unit: unit as any,
      }
    }

    // Pattern: on Mon,Tue,Wed or on Monday, Tuesday
    const weekdaysMatch = normalized.match(/on\s+([\w,\s]+?)(?:\s+from|$)/)
    if (weekdaysMatch) {
      const daysStr = weekdaysMatch[1]
      const days = daysStr
        .split(/[,\s]+/)
        .map((d) => this.weekdayMap[d.trim()])
        .filter((d) => d !== undefined)

      if (days.length > 0) {
        rule.specificDays = {
          type: 'weekdays',
          days,
        }
        // If no interval specified, default to every week
        if (!rule.interval) {
          rule.interval = { value: 1, unit: 'week' }
        }
      }
    }

    // Pattern: on 1,15,30 (days of month)
    const monthdaysMatch = normalized.match(/on\s+([\d,\s]+)(?:\s+from|$)/)
    if (monthdaysMatch && !weekdaysMatch) {
      const daysStr = monthdaysMatch[1]
      const days = daysStr
        .split(/[,\s]+/)
        .map((d) => parseInt(d.trim()))
        .filter((d) => !isNaN(d) && d >= 1 && d <= 31)

      if (days.length > 0) {
        rule.specificDays = {
          type: 'monthdays',
          days,
        }
        // If no interval specified, default to every month
        if (!rule.interval) {
          rule.interval = { value: 1, unit: 'month' }
        }
      }
    }

    return rule.interval || rule.specificDays ? rule : null
  }

  getNextDate(baseDate: Dayjs, pattern: string, completionDate?: Dayjs): Dayjs | null {
    const rule = this.parse(pattern)
    if (!rule) return null

    const startDate = rule.fromCompletion && completionDate ? completionDate : baseDate
    let nextDate = startDate

    // Handle first/last weekday of month
    if (rule.position && rule.specificDays?.type === 'weekdays') {
      const targetDay = rule.specificDays.days[0]
      nextDate = this.getPositionalWeekday(startDate, targetDay, rule.position)

      // If the date has already passed, take the next month
      if (!nextDate.isAfter(startDate, 'day')) {
        nextDate = this.getPositionalWeekday(
          startDate.add(1, 'month').startOf('month'),
          targetDay,
          rule.position
        )
      }
      return nextDate
    }

    // Simple interval without specific days
    if (rule.interval && !rule.specificDays) {
      return startDate.add(rule.interval.value, rule.interval.unit)
    }

    // Interval with specific weekdays
    if (rule.interval && rule.specificDays?.type === 'weekdays') {
      const days = rule.specificDays.days

      if (rule.interval.unit === 'week') {
        // Find the nearest matching day this week or next week
        for (let i = 1; i <= 7 * rule.interval.value; i++) {
          nextDate = startDate.add(i, 'day')
          if (days.includes(nextDate.day())) {
            return nextDate
          }
        }
      }
    }

    // Interval with specific days of month
    if (rule.interval && rule.specificDays?.type === 'monthdays') {
      const days = rule.specificDays.days.sort((a, b) => a - b)

      // Find the nearest matching day in the current or next month
      for (let monthOffset = 0; monthOffset <= rule.interval.value; monthOffset++) {
        const targetMonth = startDate.add(monthOffset, 'month')

        for (const day of days) {
          const candidate = targetMonth.date(day)
          // Check that the day exists in the month and it's in the future
          if (candidate.month() === targetMonth.month() && candidate.isAfter(startDate, 'day')) {
            return candidate
          }
        }
      }
    }

    return null
  }

  private getPositionalWeekday(date: Dayjs, weekday: number, position: 'first' | 'last'): Dayjs {
    const startOfMonth = date.startOf('month')
    const endOfMonth = date.endOf('month')

    if (position === 'first') {
      let current = startOfMonth
      while (current.month() === date.month()) {
        if (current.day() === weekday) {
          return current
        }
        current = current.add(1, 'day')
      }
    } else {
      let current = endOfMonth
      while (current.month() === date.month()) {
        if (current.day() === weekday) {
          return current
        }
        current = current.subtract(1, 'day')
      }
    }

    return date
  }
}

// Usage:
// const parser = new RecurrenceParser()
// const today = dayjs()

// Examples:
// parser.getNextDate(today, 'every day')
// parser.getNextDate(today, 'every 3 days from completion', completionDate)
// parser.getNextDate(today, 'every week on Mon, Wed, Fri')
// parser.getNextDate(today, 'every month on 1, 15')
// parser.getNextDate(today, 'every last Friday')
// parser.getNextDate(today, 'every 2 weeks on Monday from completion', completionDate)
