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
import { parseIcs } from '@/calendars/ics'
import { refreshedOccurrence } from '@/calendars/events'
import { deferred } from '../helpers/deferred'

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

  it.each([false, true])(
    'ticks a moved detached occurrence on the first click when its legacy cache ID changes (background read=%s)',
    async (background) => {
      const { service: initial, deps, request } = setup()
      const detached = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:sample-detached',
        'RECURRENCE-ID:20260410T090000Z',
        'DTSTART:20260410T120000Z',
        'DTEND:20260410T130000Z',
        'SUMMARY:Sample moved meeting',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:sample-detached',
        'RECURRENCE-ID:20260411T090000Z',
        'DTSTART:20260411T150000Z',
        'DTEND:20260411T160000Z',
        'SUMMARY:Sample other meeting',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
      const events = parseIcs(detached, 'sample-feed', {
        from: Date.UTC(2026, 3, 1),
        to: Date.UTC(2026, 4, 1),
      })
      const legacy = { ...events[1], id: 'sample-feed:sample-detached:once' }
      delete legacy.recurrenceId
      request.mockResolvedValue({
        status: 200,
        text: detached,
        headers: { etag: 'sample-detached-version' },
      })
      await initial.refresh()
      const cache = JSON.parse((await deps.storage.read())!)
      delete cache.feeds['sample-feed'].ics
      cache.feeds['sample-feed'].events = [legacy]
      await deps.storage.write(JSON.stringify(cache))
      const service = new CalendarService(deps)
      await service.load()
      expect(service.state.events['sample-feed']).toEqual([legacy])

      let reading: Promise<void> | undefined
      if (background) {
        const gate = deferred<Awaited<ReturnType<typeof request>>>()
        const entered = deferred()
        request.mockImplementationOnce(() => {
          entered.resolve()
          return gate.promise
        })
        reading = service.refresh()
        await entered.promise
        const ticking = service.setDone(legacy, true)
        const checked = ticking.then(
          () => null,
          (error: unknown) => error
        )
        // Let the tick reach the already-reading feed before its source response arrives.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        gate.resolve({ status: 200, text: detached, headers: { etag: 'sample-detached-version' } })
        expect(await checked).toBeNull()
      } else {
        await service.setDone(legacy, true)
      }
      await reading

      const refreshed = service.state.events['sample-feed']
      expect(request.mock.calls).toHaveLength(2)
      expect(refreshed.map((e) => service.isDone(e))).toEqual([false, true])
      expect(refreshed[1].id).not.toBe(legacy.id)
      expect(refreshed[1].recurrenceId).toBe(events[1].recurrenceId)
      await service.refresh()
      expect(service.state.events['sample-feed'].map((e) => service.isDone(e))).toEqual([
        false,
        true,
      ])
    }
  )

  it('never migrates a legacy row to an ambiguous slot or another feed with the same UID', () => {
    const events = parseIcs(calendar, 'sample-feed', {
      from: Date.UTC(2026, 3, 1),
      to: Date.UTC(2026, 4, 1),
    })
    const legacy = { ...events[0], id: 'sample-feed:sample-series:once' }
    delete legacy.recurrenceId
    const overlapping = { ...events[1], start: events[0].start, startDay: events[0].startDay }
    expect(refreshedOccurrence(legacy, [events[0], overlapping])).toBeUndefined()
    expect(refreshedOccurrence(legacy, [{ ...events[0], feedId: 'another-feed' }])).toBeUndefined()
    expect(
      refreshedOccurrence(legacy, [{ ...events[0], start: events[0].start + 86400000 }])
    ).toBeUndefined()
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
