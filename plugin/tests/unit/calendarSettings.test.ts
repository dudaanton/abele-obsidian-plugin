/**
 * The calendars' settings: made whole on the way in, carried to another device with the keys
 * they point at, named in the list of keys, and the small pieces of reading a server's answer.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  calendarKeyId,
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
