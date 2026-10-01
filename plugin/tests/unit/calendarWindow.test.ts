import { expect, it, vi } from 'vitest'
import { CalendarService } from '@/calendars/CalendarService'
import { DEFAULT_CALENDAR_SETTINGS, newFeed } from '@/calendars/settings'

const calendar = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:sample-recurring',
  'DTSTART;VALUE=DATE:20260115',
  'DTEND;VALUE=DATE:20260116',
  'RRULE:FREQ=YEARLY',
  'SUMMARY:Sample anniversary',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

it('expands unchanged recurring feeds into the current date window', async () => {
  let now = Date.UTC(2026, 0, 1, 12)
  const feed = { ...newFeed([]), id: 'sample-feed', keyId: 'sample-link', enabled: true }
  const request = vi.fn(async () => ({
    status: 200,
    text: calendar,
    headers: { etag: 'sample-version' },
  }))
  let saved = ''
  const storage = {
    read: async () => saved || null,
    write: async (text: string) => {
      saved = text
    },
  }
  const deps = {
    storage,
    request,
    now: () => now,
    secret: () => 'https://sample.invalid/feed.ics',
    settings: () => ({ ...DEFAULT_CALENDAR_SETTINGS, feeds: [feed] }),
  }
  const service = new CalendarService(deps)
  await service.refresh()
  now = Date.UTC(2027, 0, 1, 12)
  request.mockResolvedValueOnce({ status: 304, text: '', headers: {} })
  await service.refresh()
  expect(
    service.state.events[feed.id].some((event) => new Date(event.start).getUTCFullYear() === 2027)
  ).toBe(true)
  const reopened = new CalendarService(deps)
  await reopened.load()
  expect(
    reopened.state.events[feed.id].some((event) => new Date(event.start).getUTCFullYear() === 2027)
  ).toBe(true)
})
