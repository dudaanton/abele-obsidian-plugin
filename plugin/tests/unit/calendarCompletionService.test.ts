import { describe, expect, it, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { applyEntries, collectEntries } from '@/transfer/entries'
import { CalendarService } from '@/calendars/CalendarService'
import {
  completionKey,
  completionMarksFrom,
  EventCompletionStore,
  type CompletionMarks,
} from '@/calendars/completion'
import { newFeed } from '@/calendars/settings'

const calendar = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:sample-series',
  'DTSTART;VALUE=DATE:20260410',
  'DTEND;VALUE=DATE:20260411',
  'RRULE:FREQ=DAILY;COUNT=3',
  'SUMMARY:Sample meeting',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

function setup() {
  let now = Date.UTC(2026, 3, 10)
  let marks: CompletionMarks = {}
  let cache = ''
  const settings = {
    refreshMinutes: 30,
    feeds: [{ ...newFeed([]), id: 'sample-feed', keyId: 'sample-key' }],
  }
  const request = vi.fn(async () => ({
    status: 200,
    text: calendar,
    headers: { etag: 'sample-version' },
  }))
  const completion = new EventCompletionStore({
    read: () => marks,
    write: async (next) => {
      marks = next
    },
  })
  const deps = {
    request,
    completion,
    settings: () => settings,
    secret: () => 'https://sample.invalid/calendar.ics',
    now: () => now,
    markedFeeds: () => Object.values(marks).map((m) => m.feedId),
    storage: {
      read: async () => cache || null,
      write: async (text: string) => {
        cache = text
      },
    },
  }
  return {
    service: new CalendarService(deps),
    deps,
    settings,
    request,
    advance: () => {
      now += 181 * 86400000
    },
    marks: () => marks,
  }
}

describe('completion around feed reads and shared settings', () => {
  it('does not contact the server when ticked and survives an unchanged refresh and cache reopen', async () => {
    const { service, deps, request } = setup()
    await service.refresh()
    const events = service.state.events['sample-feed']
    const calls = request.mock.calls.length
    await service.setDone(events[1], true)
    expect(request.mock.calls).toHaveLength(calls)
    request.mockResolvedValueOnce({ status: 304, text: '', headers: { etag: 'sample-version' } })
    await service.refresh()
    expect(service.state.events['sample-feed'].map((e) => service.isDone(e))).toEqual([
      false,
      true,
      false,
    ])
    const reopened = new CalendarService(deps)
    await reopened.load()
    expect(reopened.state.events['sample-feed'].map((e) => reopened.isDone(e))).toEqual([
      false,
      true,
      false,
    ])
    expect(request.mock.calls).toHaveLength(calls + 1)
  })

  it('refreshes a legacy event-only cache before identifying which occurrence to tick', async () => {
    const { service, request } = setup()
    await service.refresh()
    const legacy = { ...service.state.events['sample-feed'][1] }
    delete legacy.recurrenceId
    service.state.events['sample-feed'] = service.state.events['sample-feed'].map((e) => {
      const copy = { ...e }
      delete copy.recurrenceId
      return copy
    })
    await service.setDone(legacy, true)
    expect(request.mock.calls).toHaveLength(2)
    expect(service.state.events['sample-feed'].map((e) => service.isDone(e))).toEqual([
      false,
      true,
      false,
    ])
  })

  it('does not prune unavailable or disabled feeds, but prunes a removed feed even at startup', async () => {
    const { service, deps, settings, request, advance, marks } = setup()
    await service.refresh()
    const event = service.state.events['sample-feed'][0]
    await service.setDone(event, true)
    advance()
    request.mockRejectedValueOnce(Error('Sample network failure'))
    await service.refresh()
    expect(service.isDone(event)).toBe(true)
    settings.feeds[0].enabled = false
    await service.refreshChanged()
    expect(service.isDone(event)).toBe(true)
    settings.feeds = []
    await new CalendarService(deps).load()
    expect(marks()).toEqual({})
  })

  it('round-trips marks with settings and calendar transfer without retaining shared references', async () => {
    const { service, marks, settings } = setup()
    await service.refresh()
    const event = service.state.events['sample-feed'][1]
    await service.setDone(event, true)
    const config = AbeleConfig.getInstance()
    config.applySettings({ refreshDelay: 300, calendars: settings, calendarCompletion: marks() })
    const saved = JSON.parse(JSON.stringify(config.exportSettings()))
    config.applySettings(undefined)
    config.applySettings(saved)
    expect(config.calendarCompletion[completionKey(event)]).toEqual(marks()[completionKey(event)])
    const entry = collectEntries(saved).find((e) => e.section === 'calendars')!
    const target = applyEntries([entry], { refreshDelay: 300 })
    expect(target.calendarCompletion).toEqual(marks())
    expect(target.calendars).toEqual(settings)
    config.calendarCompletion[completionKey(event)].seenAt = 42
    expect(saved.calendarCompletion[completionKey(event)].seenAt).not.toBe(42)
  })

  it('drops malformed stored marks rather than treating arbitrary data as completed', () => {
    expect(
      completionMarksFrom({
        garbage: true,
        '["sample-feed","uid",null]': { feedId: 'different-feed', seenAt: 123 },
      })
    ).toEqual({})
    const key = '["sample-feed","sample-uid",null]'
    expect(completionMarksFrom({ [key]: { feedId: 'sample-feed', seenAt: 123 } })).toEqual({
      [key]: { feedId: 'sample-feed', seenAt: 123 },
    })
  })
})
