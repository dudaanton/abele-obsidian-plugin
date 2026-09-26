/**
 * A calendar file (iCalendar, RFC 5545) turned into the occurrences inside a window of time.
 *
 * ical.js does the reading and the unrolling: RRULE and RDATE, EXDATE, a single occurrence
 * moved or changed (RECURRENCE-ID), and the VTIMEZONE descriptions the file carries. What it
 * cannot know is a zone the file names and does not describe — `zones.ts` answers for those.
 */
import ICAL from 'ical.js'
import type { CalendarEvent } from './events'
import { resolveZone, wallTimeToInstant } from './zones'

export interface TimeWindow {
  /** Milliseconds since the epoch; an event ending at or before it is left out. */
  from: number
  /** An event starting at or after it is left out. */
  to: number
}

/** Occurrences of one series looked at, at most: a daily one from 1990 is still ~13 000. */
const MAX_STEPS = 50_000
/**
 * How far past the window a series is still followed: one occurrence moved from outside it
 * to inside is found by its original date, which may lie a little beyond.
 */
const SLACK_MS = 62 * 24 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

type IcalTime = InstanceType<typeof ICAL.Time>
type IcalEvent = InstanceType<typeof ICAL.Event>
type IcalComponent = InstanceType<typeof ICAL.Component>

const pad = (n: number) => String(n).padStart(2, '0')

/** The instant a date-time means, with the TZID it was written with. */
function instantOf(time: IcalTime, tzid: string | null): number {
  const zone = time.zone
  if (zone && zone.tzid !== 'floating') {
    // UTC, or a zone the file described — ical.js knows its offsets.
    return time.toUnixTime() * 1000
  }
  const wall = {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
  }
  const iana = tzid ? resolveZone(tzid) : null
  if (iana) return wallTimeToInstant(wall, iana)
  // Floating: the same clock time wherever the device is, which is what the file asked for.
  return new Date(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second
  ).getTime()
}

const dayOf = (time: IcalTime) => `${time.year}-${pad(time.month)}-${pad(time.day)}`
const dayMs = (time: IcalTime) => Date.UTC(time.year, time.month - 1, time.day)

function tzidOf(component: IcalComponent, name: string): string | null {
  const prop = component.getFirstProperty(name)
  const tzid = prop?.getParameter('tzid')
  return typeof tzid === 'string' ? tzid : null
}

function text(component: IcalComponent, name: string): string {
  const value = component.getFirstPropertyValue(name)
  return typeof value === 'string' ? value.trim() : ''
}

function attendeesOf(component: IcalComponent): string[] {
  return component
    .getAllProperties('attendee')
    .map((prop) => {
      const cn = prop.getParameter('cn')
      if (typeof cn === 'string' && cn.trim()) return cn.trim().replace(/^"|"$/g, '')
      const value = prop.getFirstValue()
      return typeof value === 'string' ? value.replace(/^mailto:/i, '') : ''
    })
    .filter(Boolean)
}

/**
 * An event with none of the file's changed occurrences attached. Left to itself ical.js attaches
 * every one in the file to every event, whatever series it belongs to; they are related here,
 * each to its own, by UID.
 */
const newEvent = (component: IcalComponent): IcalEvent =>
  new ICAL.Event(component, { strictExceptions: true, exceptions: [] })

const cancelled = (component: IcalComponent) =>
  text(component, 'status').toUpperCase() === 'CANCELLED'

interface Occurrence {
  item: IcalEvent
  start: IcalTime
  end: IcalTime
  /** Which occurrence of the series, for the id; the start itself for a single event. */
  key: string
}

function toEvent(feedId: string, occurrence: Occurrence): CalendarEvent {
  const { item, start, end } = occurrence
  const component = item.component
  const base = {
    id: `${feedId}:${item.uid}:${occurrence.key}`,
    feedId,
    uid: item.uid ?? '',
    title: text(component, 'summary') || '(No title)',
    location: text(component, 'location'),
    description: text(component, 'description'),
    url: text(component, 'url'),
    attendees: attendeesOf(component),
  }
  if (start.isDate) {
    const endDay = end && end.isDate && dayMs(end) > dayMs(start) ? end : null
    return {
      ...base,
      allDay: true,
      start: dayMs(start),
      end: endDay ? dayMs(endDay) : dayMs(start) + DAY_MS,
      startDay: dayOf(start),
      endDay: endDay ? dayOf(endDay) : undefined,
    }
  }
  const startMs = instantOf(start, tzidOf(component, 'dtstart'))
  const endMs = end
    ? instantOf(end, tzidOf(component, 'dtend') ?? tzidOf(component, 'dtstart'))
    : startMs
  return { ...base, allDay: false, start: startMs, end: Math.max(startMs, endMs) }
}

function overlaps(event: CalendarEvent, window: TimeWindow): boolean {
  const end = event.end > event.start ? event.end : event.start + 1
  return end > window.from && event.start < window.to
}

function occurrencesOf(master: IcalEvent, window: TimeWindow): Occurrence[] {
  if (!master.isRecurring()) {
    return [{ item: master, start: master.startDate, end: master.endDate, key: 'once' }]
  }
  const tzid = tzidOf(master.component, 'dtstart')
  const out: Occurrence[] = []
  // An RDATE may repeat a date the rule already gives; it is one occurrence.
  const seen = new Set<string>()
  const iterator = master.iterator()
  for (let step = 0; step < MAX_STEPS; step++) {
    const next = iterator.next()
    if (!next) break
    const original = next.isDate ? dayMs(next) : instantOf(next, tzid)
    if (original >= window.to + SLACK_MS) break
    if (original < window.from - SLACK_MS) continue
    const key = next.toString()
    if (seen.has(key)) continue
    seen.add(key)
    const details = master.getOccurrenceDetails(next)
    out.push({
      item: details.item,
      start: details.startDate,
      end: details.endDate,
      key,
    })
  }
  return out
}

/**
 * Every occurrence in the window, of every event in the file, cancelled ones left out.
 *
 * @throws when the text is not a calendar at all — a login page where the link used to be
 */
export function parseIcs(ics: string, feedId: string, window: TimeWindow): CalendarEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(ics)) throw new Error('What came back is not a calendar.')
  let root: IcalComponent
  try {
    root = new ICAL.Component(ICAL.parse(ics))
  } catch (e) {
    throw new Error(`The calendar could not be read: ${(e as Error).message}`)
  }

  const components = root.getAllSubcomponents('vevent')
  const masters = new Map<string, IcalEvent>()
  const overrides: IcalComponent[] = []
  const events: CalendarEvent[] = []

  for (const component of components) {
    if (component.hasProperty('recurrence-id')) {
      overrides.push(component)
      continue
    }
    try {
      const event = newEvent(component)
      const uid = event.uid ?? `no-uid-${masters.size}`
      if (!masters.has(uid)) masters.set(uid, event)
    } catch (e) {
      console.debug('[Abele] calendars: skipped an event that could not be read', e)
    }
  }

  // Each override belongs to its series; one without a series is an event of its own.
  const orphans: IcalComponent[] = []
  for (const component of overrides) {
    const uid = text(component, 'uid')
    const master = masters.get(uid)
    try {
      if (master?.isRecurring()) master.relateException(component)
      else orphans.push(component)
    } catch (e) {
      console.debug('[Abele] calendars: skipped a changed occurrence', e)
    }
  }

  const collect = (event: IcalEvent) => {
    try {
      if (cancelled(event.component)) return
      for (const occurrence of occurrencesOf(event, window)) {
        if (cancelled(occurrence.item.component)) continue
        const read = toEvent(feedId, occurrence)
        if (overlaps(read, window)) events.push(read)
      }
    } catch (e) {
      console.debug('[Abele] calendars: skipped an event that could not be unrolled', e)
    }
  }

  for (const event of masters.values()) collect(event)
  for (const component of orphans) {
    try {
      collect(newEvent(component))
    } catch (e) {
      console.debug('[Abele] calendars: skipped a changed occurrence', e)
    }
  }

  return events
}
