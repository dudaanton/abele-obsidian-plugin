/**
 * Reading a calendar file into the events a list shows: the places every calendar plugin gets
 * wrong — a clock change inside a series, one occurrence moved or called off, a day-long
 * event, and Outlook naming its time zones the Windows way.
 *
 * The device is put in Berlin for the whole file, so "which day" has one answer; every instant
 * is asserted in UTC, so the expectations do not depend on it.
 */
process.env.TZ = 'Europe/Berlin'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseIcs } from '@/calendars/ics'
import { eventDays, type CalendarEvent } from '@/calendars/events'

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../fixtures/calendars', name), 'utf8')

const WINDOW = { from: Date.UTC(2026, 2, 1), to: Date.UTC(2027, 0, 1) }

const read = (name: string, window = WINDOW) => parseIcs(fixture(name), 'feed', window)

const iso = (ms: number) => new Date(ms).toISOString().replace('.000', '')

const titled = (events: CalendarEvent[], title: string) => events.filter((e) => e.title === title)

describe('a weekly series in Berlin, from a Google link', () => {
  const events = read('google-berlin.ics')
  const standups = events
    .filter((e) => e.uid === 'standup@example.com')
    .sort((a, b) => a.start - b.start)

  it('keeps nine o’clock on both sides of the spring clock change', () => {
    expect(standups.slice(0, 3).map((e) => iso(e.start))).toEqual([
      '2026-03-16T08:00:00Z',
      '2026-03-23T08:00:00Z',
      '2026-03-30T07:00:00Z',
    ])
    expect(standups.slice(0, 3).map((e) => iso(e.end))).toEqual([
      '2026-03-16T08:30:00Z',
      '2026-03-23T08:30:00Z',
      '2026-03-30T07:30:00Z',
    ])
  })

  it('leaves out the excluded Monday and the called-off one, and shows the moved one where it went', () => {
    expect(standups.map((e) => iso(e.start))).toEqual([
      '2026-03-16T08:00:00Z',
      '2026-03-23T08:00:00Z',
      '2026-03-30T07:00:00Z',
      '2026-04-14T13:00:00Z',
    ])
    expect(standups[3].title).toBe('Standup (moved)')
    expect(standups.every((e) => e.location === 'Room 4')).toBe(true)
  })

  it('keeps nine o’clock across the autumn change too', () => {
    expect(titled(events, 'Across the clock change').map((e) => iso(e.start))).toEqual([
      '2026-10-24T07:00:00Z',
      '2026-10-25T08:00:00Z',
    ])
  })

  it('unrolls an endless series only inside the window', () => {
    const daily = titled(events, 'Every day forever')
    // March through December 2026: 306 days.
    expect(daily).toHaveLength(306)
    expect(iso(daily[0].start)).toBe('2026-03-01T08:00:00Z')
  })

  it('gives each occurrence its own id', () => {
    const ids = new Set(events.map((e) => e.id))
    expect(ids.size).toBe(events.length)
  })

  it('files a timed event under the day it happens on this device', () => {
    expect(eventDays(standups[0])).toEqual(['2026-03-16'])
    expect(standups[0].allDay).toBe(false)
  })
})

describe('events that last whole days', () => {
  const events = read('all-day.ics')

  it('takes a day with no end as that one day', () => {
    const [holiday] = titled(events, 'Holiday')
    expect(holiday.allDay).toBe(true)
    expect(eventDays(holiday)).toEqual(['2026-04-02'])
  })

  it('takes the end date as the day after the last one', () => {
    const [trip] = titled(events, 'Trip')
    expect(eventDays(trip)).toEqual(['2026-04-10', '2026-04-11', '2026-04-12'])
  })

  it('brings a yearly one started long ago into this year, on its date', () => {
    const birthdays = titled(events, "Anna's birthday")
    expect(birthdays.map((e) => eventDays(e))).toEqual([['2026-05-01']])
  })

  it('does not move a day-long event with the time zone of the device', () => {
    process.env.TZ = 'America/Los_Angeles'
    try {
      const [trip] = titled(read('all-day.ics'), 'Trip')
      expect(eventDays(trip)).toEqual(['2026-04-10', '2026-04-11', '2026-04-12'])
    } finally {
      process.env.TZ = 'Europe/Berlin'
    }
  })
})

describe('Outlook, with Windows time zone names', () => {
  it('knows the Windows names when the file does not describe them', () => {
    const events = read('outlook-windows.ics')
    expect(iso(titled(events, 'Review')[0].start)).toBe('2026-07-01T12:00:00Z')
    expect(iso(titled(events, 'Call with the west coast')[0].start)).toBe('2026-07-01T16:00:00Z')
  })

  it('follows the American clock change inside a series named the Windows way', () => {
    const events = read('outlook-windows.ics')
    expect(titled(events, 'Weekly sync').map((e) => iso(e.start))).toEqual([
      '2026-10-26T14:00:00Z',
      '2026-11-02T15:00:00Z',
    ])
  })

  it('knows a zone named the IANA way that the file does not describe', () => {
    const events = read('outlook-windows.ics')
    expect(iso(titled(events, 'Named the IANA way')[0].start)).toBe('2026-07-02T00:00:00Z')
  })

  it('uses the description the file carries when it has one', () => {
    const events = read('outlook-vtimezone.ics')
    expect(iso(titled(events, 'Winter meeting')[0].start)).toBe('2026-03-15T09:00:00Z')
    expect(iso(titled(events, 'Summer meeting')[0].start)).toBe('2026-07-15T08:00:00Z')
  })
})

describe('everything else a file may hold', () => {
  const events = read('misc.ics')

  it('reads a length given as a duration', () => {
    const [lunch] = titled(events, 'Lunch')
    expect(iso(lunch.start)).toBe('2026-05-01T12:00:00Z')
    expect(iso(lunch.end)).toBe('2026-05-01T13:30:00Z')
  })

  it('reads the place, the description, the link and the people', () => {
    const [lunch] = titled(events, 'Lunch')
    expect(lunch.location).toBe('Cafe, Main street')
    expect(lunch.description).toBe('Bring the notes\nand the laptop')
    expect(lunch.url).toBe('https://meet.example.com/abc')
    expect(lunch.attendees).toEqual(['Anna Berg', 'John Smith', 'nobody@example.com'])
  })

  it('takes a time with no zone as the device’s own', () => {
    expect(iso(titled(events, 'Floating')[0].start)).toBe('2026-05-02T08:00:00Z')
  })

  it('does not put an event ending at midnight on the next day', () => {
    expect(eventDays(titled(events, 'Until midnight')[0])).toEqual(['2026-05-03'])
  })

  it('puts an event running past midnight on both days', () => {
    expect(eventDays(titled(events, 'Overnight')[0])).toEqual(['2026-05-04', '2026-05-05'])
  })

  it('leaves out what is outside the window and what was called off', () => {
    expect(titled(events, 'Long ago')).toEqual([])
    expect(titled(events, 'Called off')).toEqual([])
  })

  it('names an event with no title', () => {
    expect(events.find((e) => e.uid === 'no-title@example.com')?.title).toBe('(No title)')
  })
})

describe('what cannot be read', () => {
  it('is an error saying so, not an empty calendar', () => {
    expect(() => parseIcs('<html>Sign in</html>', 'feed', WINDOW)).toThrow(/not a calendar/i)
  })

  it('skips one broken event and keeps the rest', () => {
    const text = fixture('misc.ics').replace('DTSTART:20260506T100000Z', 'DTSTART:garbage')
    const events = parseIcs(text, 'feed', WINDOW)
    expect(titled(events, 'Lunch')).toHaveLength(1)
  })
})
