/**
 * One occurrence of an event from an external calendar, as the lists show it.
 *
 * A series is unrolled into one of these per occurrence, so everything downstream — the day it
 * is filed under, the order in a day, the cache — deals with plain events only.
 */
export interface CalendarEvent {
  /** Unique across every calendar: the feed, the event and which occurrence of it. */
  id: string
  feedId: string
  uid: string
  title: string
  /** A day-long event: `startDay` and `endDay` say which days, `start` and `end` only order it. */
  allDay: boolean
  /** Milliseconds since the epoch. For a day-long event, midnight UTC of its first day. */
  start: number
  end: number
  /** Day-long events only: the first day and the day after the last, as `YYYY-MM-DD`. */
  startDay?: string
  endDay?: string
  location: string
  description: string
  url: string
  /** Who else is invited, by name where the file gives one, by address where it does not. */
  attendees: string[]
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` of the day this instant falls on, on this device's clock. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `YYYY-MM-DD` read as a calendar date, one day on. */
function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

/** A guard against a malformed event claiming years: no event is filed under more days. */
const MAX_DAYS = 400

/**
 * Every day the event is on, as `YYYY-MM-DD`: a day-long one on its dates whatever the
 * device's zone, a timed one on the days of this device's clock it touches. Its end is not a
 * day of its own — a meeting until midnight is not on the next day.
 */
export function eventDays(event: CalendarEvent): string[] {
  const days: string[] = []
  if (event.allDay && event.startDay) {
    const last =
      event.endDay && event.endDay > event.startDay ? event.endDay : nextDay(event.startDay)
    for (let day = event.startDay; day < last && days.length < MAX_DAYS; day = nextDay(day)) {
      days.push(day)
    }
    return days
  }
  const first = localDay(event.start)
  const last = localDay(Math.max(event.start, event.end - 1))
  for (let day = first; day <= last && days.length < MAX_DAYS; day = nextDay(day)) days.push(day)
  return days
}

/** Day-long events first, then by start, then by title: the order within one day. */
export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  return a.start - b.start || a.title.localeCompare(b.title)
}
