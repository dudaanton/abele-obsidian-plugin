/**
 * The calendars' settings: made whole on the way in, carried to another device with the keys
 * they point at, named in the list of keys, and the small pieces of reading a server's answer.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  calendarKeyId,
  calendarLinks,
  calendarSettingsFrom,
  newFeed,
  normalizeCalendarUrl,
  type CalendarFeed,
} from '@/calendars/settings'
import { applyEntries, collectEntries } from '@/transfer/entries'
import { secretCatalog } from '@/secrets/catalog'
import { findAll, parseXml } from '@/calendars/xml'
import { isHidden } from '@/ai/tools/settingsPaths'

const feed = (over: Partial<CalendarFeed> = {}): CalendarFeed => ({
  ...newFeed([]),
  id: 'f1',
  name: 'Work',
  keyId: calendarKeyId('f1'),
  ...over,
})

describe('calendar settings as they arrive', () => {
  it('are empty with a half-hour refresh when there are none', () => {
    expect(calendarSettingsFrom(undefined)).toEqual({ refreshMinutes: 30, feeds: [] })
  })

  it('keep the refresh at five minutes at least', () => {
    expect(calendarSettingsFrom({ refreshMinutes: 1 }).refreshMinutes).toBe(5)
    expect(calendarSettingsFrom({ refreshMinutes: 'soon' }).refreshMinutes).toBe(30)
  })

  it('fill in what a hand-edited calendar leaves out and drop what is not one', () => {
    const settings = calendarSettingsFrom({
      feeds: [
        { id: 'a', color: 'magenta', source: 'carrier-pigeon' },
        null,
        { name: 'no id' },
        { id: 'a' },
      ],
    })
    expect(settings.feeds).toEqual([
      {
        id: 'a',
        name: '',
        color: 'blue',
        enabled: true,
        source: 'ics',
        keyId: '',
        server: '',
        username: '',
        calendarUrl: '',
      },
    ])
  })

  it('give each new calendar a colour the others do not have yet', () => {
    const first = newFeed([])
    const second = newFeed([first])
    expect(second.color).not.toBe(first.color)
  })

  it('survive a save and a load', () => {
    const config = AbeleConfig.getInstance()
    config.applySettings(undefined)
    config.calendars = { refreshMinutes: 15, feeds: [feed({ source: 'caldav', username: 'anna' })] }
    const saved = JSON.parse(JSON.stringify(config.exportSettings()))
    config.applySettings(undefined)
    expect(config.calendars.feeds).toEqual([])
    config.applySettings(saved)
    expect(config.calendars.refreshMinutes).toBe(15)
    expect(config.calendars.feeds[0].username).toBe('anna')
  })
})

describe('a pasted link', () => {
  it('turns webcal into https', () => {
    expect(normalizeCalendarUrl(' webcal://p42-caldav.icloud.com/published/2/abc ')).toBe(
      'https://p42-caldav.icloud.com/published/2/abc'
    )
    expect(normalizeCalendarUrl('https://calendar.google.com/x/basic.ics')).toBe(
      'https://calendar.google.com/x/basic.ics'
    )
  })
})

describe('the links people paste', () => {
  const HOLIDAYS = 'ru.russian#holiday@group.v.calendar.google.com'
  const HOLIDAYS_ICS =
    'https://calendar.google.com/calendar/ical/ru.russian%23holiday%40group.v.calendar.google.com/public/basic.ics'

  it('takes a Google secret address as it is, escapes and all', () => {
    for (const url of [
      'https://calendar.google.com/calendar/ical/abc123%40group.calendar.google.com/private-0f1e2d3c4b5a69788796a5b4c3d2e1f0/basic.ics',
      'https://calendar.google.com/calendar/ical/anna.fake%40gmail.com/private-0123456789abcdef/basic.ics',
      HOLIDAYS_ICS,
    ]) {
      expect(calendarLinks(url)).toEqual({ urls: [url] })
    }
  })

  it('takes an iCloud public link, however long, as https', () => {
    const token = 'fakeToken0123456789'.repeat(12)
    expect(calendarLinks(`webcal://p123-caldav.icloud.com/published/2/${token}`)).toEqual({
      urls: [`https://p123-caldav.icloud.com/published/2/${token}`],
    })
    expect(calendarLinks('webcals://example.com/cal')).toEqual({
      urls: ['https://example.com/cal'],
    })
  })

  it('drops the spaces and line breaks a paste brings along', () => {
    expect(calendarLinks(`  \n${HOLIDAYS_ICS}\n  `)).toEqual({ urls: [HOLIDAYS_ICS] })
  })

  it('turns a Google embed page into the public feed of each calendar on it', () => {
    expect(
      calendarLinks(
        'https://calendar.google.com/calendar/embed?src=ru.russian%23holiday%40group.v.calendar.google.com&ctz=Europe%2FMoscow'
      )
    ).toEqual({ urls: [HOLIDAYS_ICS] })
    expect(
      calendarLinks(
        'https://calendar.google.com/calendar/embed?src=a%40group.calendar.google.com&src=b%40gmail.com&ctz=UTC'
      )
    ).toEqual({
      urls: [
        'https://calendar.google.com/calendar/ical/a%40group.calendar.google.com/public/basic.ics',
        'https://calendar.google.com/calendar/ical/b%40gmail.com/public/basic.ics',
      ],
    })
  })

  it('turns a Google share link, its id in base64 or plain, into the public feed', () => {
    const b64 = btoa(HOLIDAYS).replace(/=+$/, '')
    expect(calendarLinks(`https://calendar.google.com/calendar/u/0?cid=${b64}`)).toEqual({
      urls: [HOLIDAYS_ICS],
    })
    expect(
      calendarLinks(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(HOLIDAYS)}`)
    ).toEqual({ urls: [HOLIDAYS_ICS] })
    expect(
      calendarLinks(
        `https://calendar.google.com/calendar/render?cid=${encodeURIComponent('webcal://example.com/team.ics')}`
      )
    ).toEqual({ urls: ['https://example.com/team.ics'] })
  })

  it('says what is wrong with a link it cannot use', () => {
    expect(calendarLinks('   ').problem).toMatch(/paste/i)
    expect(calendarLinks('calendar.google.com/calendar/ical/x/basic.ics').problem).toMatch(
      /https:\/\/ or webcal:\/\//
    )
    expect(calendarLinks('https://calendar.google.com/calendar/u/0/r').problem).toMatch(
      /iCal/
    )
  })

  it('keeps each calendar in a keychain slot Obsidian takes, whatever its id', () => {
    for (const id of ['f1', 'xH7JnS8u', 'a_b-C', newFeed([]).id]) {
      expect(calendarKeyId(id)).toMatch(/^[a-z0-9-]+$/)
    }
    expect(calendarKeyId('f1')).toBe('abele-calendar-f1')
    expect(calendarKeyId('aB')).not.toBe(calendarKeyId('ab'))
    // Obsidian's limit; a nanoid of capitals, dashes and underscores still fits under it.
    expect(calendarKeyId('A-_B-_C_').length).toBeLessThanOrEqual(64)
  })
})

describe('taking the calendars to another device', () => {
  let settings: ReturnType<AbeleConfig['exportSettings']>

  beforeEach(() => {
    const config = AbeleConfig.getInstance()
    config.applySettings(undefined)
    config.calendars = {
      refreshMinutes: 20,
      feeds: [
        feed(),
        feed({ id: 'f2', name: 'iCloud', source: 'caldav', keyId: calendarKeyId('f2') }),
        feed({ id: 'f3', name: 'Not set up yet', keyId: '' }),
      ],
    }
    settings = config.exportSettings()
  })

  it('carries every calendar and the key of each', () => {
    const entry = collectEntries(settings).find((e) => e.section === 'calendars')
    expect(entry?.secretIds).toEqual([calendarKeyId('f1'), calendarKeyId('f2')])
    const landed = applyEntries([entry!], { refreshDelay: 300 })
    expect(landed.calendars).toEqual(settings.calendars)
  })

  it('names each key after its calendar in the list of keys', () => {
    const rows = secretCatalog(settings, { status: 'off', contents: null, has: () => true })
    const row = rows.find((r) => r.id === calendarKeyId('f2'))
    expect(row?.name).toBe('iCloud')
    expect(row?.uses).toEqual(['Calendar · iCloud'])
  })

  it('keeps each key out of an agent’s reach', () => {
    expect(isHidden('calendars.feeds.0.keyId')).toBe(true)
    expect(isHidden('calendars.feeds.0.name')).toBe(false)
  })
})

describe('reading a server’s XML', () => {
  it('goes by namespace, whatever prefix the server chose', () => {
    const root = parseXml(
      `<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>/a/</href></response>` +
        `<x:response xmlns:x="DAV:"><x:href>/b/</x:href></x:response></multistatus>`
    )
    expect(findAll(root, 'DAV:', 'href').map((e) => e.text)).toEqual(['/a/', '/b/'])
  })

  it('decodes entities and CDATA, and keeps attributes', () => {
    const root = parseXml(
      `<d:a xmlns:d="DAV:" xmlns:c="urn:c"><c:data>A&amp;B&#13;&#x41;<![CDATA[<raw>]]></c:data><c:comp name="VEVENT"/></d:a>`
    )
    expect(findAll(root, 'urn:c', 'data')[0].text).toBe('A&B\rA<raw>')
    expect(findAll(root, 'urn:c', 'comp')[0].attrs.name).toBe('VEVENT')
  })

  it('refuses what is not XML', () => {
    expect(() => parseXml('Service unavailable')).toThrow()
    expect(() => parseXml('<a><b></a>')).toThrow()
  })
})
