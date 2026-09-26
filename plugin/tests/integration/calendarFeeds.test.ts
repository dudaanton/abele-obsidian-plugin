/**
 * Calendars read over the network from a server started here: a secret link and a CalDAV
 * account. Then the service around them — what it keeps on the device, and what it shows when
 * the server is gone.
 */
process.env.TZ = 'Europe/Berlin'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  CALDAV_PASSWORD,
  CALDAV_USER,
  LINK_TOKEN,
  nodeRequester,
  startFakeCalendarServer,
  type FakeCalendarServer,
} from '../helpers/fakeCalendarServer'
import { readFeed } from '@/calendars/fetch'
import { discoverCalendars } from '@/calendars/caldav'
import { CalendarService, type CalendarStorage } from '@/calendars/CalendarService'
import { newFeed, type CalendarFeed, type CalendarSettings } from '@/calendars/settings'

const ICS = readFileSync(join(__dirname, '../fixtures/calendars/all-day.ics'), 'utf8')
const WINDOW = { from: Date.UTC(2026, 2, 1), to: Date.UTC(2027, 0, 1) }
const NOW = Date.UTC(2026, 3, 1, 10)

let server: FakeCalendarServer

beforeAll(async () => {
  server = await startFakeCalendarServer(ICS)
})

afterAll(async () => {
  await server.stop()
})

const linkFeed = (): CalendarFeed => ({
  ...newFeed([]),
  id: 'link',
  name: 'Holidays',
  keyId: 'k-link',
})
const caldavFeed = (calendarUrl = ''): CalendarFeed => ({
  ...newFeed([]),
  id: 'dav',
  name: 'iCloud',
  source: 'caldav',
  keyId: 'k-dav',
  server: server.origin,
  username: CALDAV_USER,
  calendarUrl,
})

describe('a calendar by its secret link', () => {
  it('reads the events and the version tag', async () => {
    const read = await readFeed(
      linkFeed(),
      `${server.origin}/secret/${LINK_TOKEN}.ics`,
      WINDOW,
      nodeRequester
    )
    expect(read.events.map((e) => e.title).sort()).toEqual(["Anna's birthday", 'Holiday', 'Trip'])
    expect(read.etag).toBe('"v1"')
  })

  it('takes a webcal link as the https one it means', async () => {
    const url = `webcal://example.invalid/secret/${LINK_TOKEN}.ics`
    const seen: string[] = []
    await readFeed(linkFeed(), url, WINDOW, async (r) => {
      seen.push(r.url)
      return { status: 200, text: ICS, headers: {} }
    })
    expect(seen).toEqual([`https://example.invalid/secret/${LINK_TOKEN}.ics`])
  })

  it('says nothing changed when the server says so', async () => {
    const read = await readFeed(
      linkFeed(),
      `${server.origin}/secret/${LINK_TOKEN}.ics`,
      WINDOW,
      nodeRequester,
      '"v1"'
    )
    expect(read.unchanged).toBe(true)
  })

  it('says a web page is not a calendar feed, and where the feed is', async () => {
    const page = '<!DOCTYPE html><html><head><title>Google Calendar</title></head></html>'
    await expect(
      readFeed(linkFeed(), 'https://example.invalid/calendar', WINDOW, async () => ({
        status: 200,
        text: page,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }))
    ).rejects.toThrow(/web page, not a calendar feed.*iCal/i)
  })

  it('reads a Google embed page as the feed of the calendar on it', async () => {
    const seen: string[] = []
    await readFeed(
      linkFeed(),
      'https://calendar.google.com/calendar/embed?src=ru.russian%23holiday%40group.v.calendar.google.com&ctz=Europe%2FMoscow',
      WINDOW,
      async (r) => {
        seen.push(r.url)
        return { status: 200, text: ICS, headers: {} }
      }
    )
    expect(seen).toEqual([
      'https://calendar.google.com/calendar/ical/ru.russian%23holiday%40group.v.calendar.google.com/public/basic.ics',
    ])
  })

  it('explains a link that leads nowhere', async () => {
    await expect(
      readFeed(linkFeed(), `${server.origin}/secret/other.ics`, WINDOW, nodeRequester)
    ).rejects.toThrow(/no calendar at this link/i)
  })
})

describe('a CalDAV account', () => {
  it('lists the calendars that hold events, by the names the account gives them', async () => {
    const found = await discoverCalendars(
      { server: server.origin, username: CALDAV_USER, password: CALDAV_PASSWORD },
      nodeRequester
    )
    expect(found).toEqual([
      { url: `${server.origin}/calendars/${CALDAV_USER}/work/`, name: 'Work' },
    ])
  })

  it('reads the events of the account when no calendar is chosen', async () => {
    const read = await readFeed(caldavFeed(), CALDAV_PASSWORD, WINDOW, nodeRequester)
    expect(read.events.map((e) => e.title).sort()).toEqual(['Dentist', 'Dinner & drinks'])
    expect(new Date(read.events.find((e) => e.title === 'Dentist')!.start).toISOString()).toBe(
      '2026-04-10T08:00:00.000Z'
    )
  })

  it('reads the chosen calendar straight away', async () => {
    const before = server.log.length
    const url = `${server.origin}/calendars/${CALDAV_USER}/work/`
    const read = await readFeed(caldavFeed(url), CALDAV_PASSWORD, WINDOW, nodeRequester)
    expect(read.events).toHaveLength(2)
    expect(server.log.slice(before)).toEqual([`REPORT /calendars/${CALDAV_USER}/work/`])
  })

  it('says when the password is wrong', async () => {
    await expect(readFeed(caldavFeed(), 'wrong-password', WINDOW, nodeRequester)).rejects.toThrow(
      /did not accept the username and password/
    )
  })
})

describe('the service around them', () => {
  const memory = (): CalendarStorage & { text: string | null } => {
    const store = {
      text: null as string | null,
      read: async () => store.text,
      write: async (text: string) => {
        store.text = text
      },
    }
    return store
  }

  const secrets: Record<string, string> = {}
  const settings: CalendarSettings = { refreshMinutes: 30, feeds: [] }

  const service = (storage: CalendarStorage, request = nodeRequester) =>
    new CalendarService({
      storage,
      request,
      settings: () => settings,
      secret: (id) => secrets[id] ?? '',
      now: () => NOW,
    })

  beforeAll(() => {
    settings.feeds = [linkFeed(), caldavFeed()]
    secrets['k-link'] = `${server.origin}/secret/${LINK_TOKEN}.ics`
    secrets['k-dav'] = CALDAV_PASSWORD
  })

  it('files every calendar’s events under their days', async () => {
    const s = service(memory())
    await s.refresh()
    const days = s.byDay()
    expect(days.get('2026-04-10')?.map((e) => `${e.feed.name}: ${e.event.title}`)).toEqual([
      'Holidays: Trip',
      'iCloud: Dentist',
    ])
    expect(s.state.status.link.error).toBeNull()
    expect(s.state.status.dav.at).toBe(NOW)
  })

  it('shows what was kept, with no network, and says why it could not read', async () => {
    const storage = memory()
    await service(storage).refresh()

    const offline = service(storage, () =>
      Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'))
    )
    await offline.load()
    expect(
      offline
        .byDay()
        .get('2026-04-11')
        ?.map((e) => e.event.title)
    ).toEqual(['Trip', 'Dinner & drinks'])
    await offline.refresh()
    expect(offline.byDay().get('2026-04-11')).toHaveLength(2)
    expect(offline.state.status.link.error).toMatch(/could not be reached/)
    expect(offline.state.status.link.at).toBe(NOW)
  })

  it('does not show a calendar’s old events once its link is changed', async () => {
    const storage = memory()
    await service(storage).refresh()
    secrets['k-link'] = `${server.origin}/secret/elsewhere.ics`
    try {
      const s = service(storage)
      await s.load()
      expect(s.byDay().get('2026-04-02')).toBeUndefined()
      await s.refresh()
      expect(s.state.status.link.error).toMatch(/no calendar at this link/i)
      expect(s.byDay().get('2026-04-02')).toBeUndefined()
    } finally {
      secrets['k-link'] = `${server.origin}/secret/${LINK_TOKEN}.ics`
    }
  })

  it('keeps the events when the link has not changed since', async () => {
    const storage = memory()
    const s = service(storage)
    await s.refresh()
    const before = server.log.length
    await s.refresh(['link'])
    expect(server.log.slice(before)).toEqual([`GET /secret/${LINK_TOKEN}.ics`])
    expect(
      s
        .byDay()
        .get('2026-04-02')
        ?.map((e) => e.event.title)
    ).toEqual(['Holiday'])
  })

  it('forgets a calendar taken out of the settings, on the device too', async () => {
    const storage = memory()
    const s = service(storage)
    await s.refresh()
    const all = settings.feeds
    settings.feeds = all.filter((f) => f.id !== 'dav')
    try {
      await s.refreshChanged()
      expect(
        s
          .byDay()
          .get('2026-04-10')
          ?.map((e) => e.event.title)
      ).toEqual(['Trip'])
      expect(JSON.parse(storage.text!).feeds.dav).toBeUndefined()
    } finally {
      settings.feeds = all
    }
  })

  it('shows nothing of a calendar that is switched off, and does not read it', async () => {
    const s = service(memory())
    settings.feeds[1].enabled = false
    try {
      const before = server.log.length
      await s.refresh()
      expect(server.log.slice(before).some((l) => l.startsWith('REPORT'))).toBe(false)
      expect(
        s
          .byDay()
          .get('2026-04-10')
          ?.map((e) => e.event.title)
      ).toEqual(['Trip'])
    } finally {
      settings.feeds[1].enabled = true
    }
  })

  it('is due again once the interval has passed', async () => {
    let now = NOW
    const s = new CalendarService({
      storage: memory(),
      request: nodeRequester,
      settings: () => settings,
      secret: (id) => secrets[id] ?? '',
      now: () => now,
    })
    await s.refresh()
    expect(s.due()).toBe(false)
    now += 29 * 60 * 1000
    expect(s.due()).toBe(false)
    now += 60 * 1000
    expect(s.due()).toBe(true)
  })
})
