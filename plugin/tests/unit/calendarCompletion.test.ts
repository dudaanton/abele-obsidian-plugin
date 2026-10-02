import { describe, expect, it } from 'vitest'
import { parseIcs } from '@/calendars/ics'
import { EventCompletionStore, completionKey, type CompletionMarks } from '@/calendars/completion'

const window = { from: Date.UTC(2026, 3, 1), to: Date.UTC(2026, 4, 1) }
const calendar = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR`
const item = (lines: string) => `BEGIN:VEVENT\r\n${lines}\r\nEND:VEVENT`
const series = item(
  'UID:sample-series\r\nDTSTART:20260410T090000Z\r\nDTEND:20260410T100000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Sample meeting'
)
function memory() {
  let marks: CompletionMarks = {}
  const store = new EventCompletionStore({
    read: () => marks,
    write: async (next) => {
      marks = next
    },
  })
  return { store, marks: () => marks }
}

describe('owner completion of external events', () => {
  it('ticks just one occurrence and survives refresh and a moved override, including a detached override', async () => {
    const events = parseIcs(calendar(series), 'sample-feed', window)
    const { store, marks } = memory()
    await store.setDone(events[1], true, 100)
    expect(events.map((e) => store.isDone(e))).toEqual([false, true, false])
    const override = item(
      'UID:sample-series\r\nRECURRENCE-ID:20260411T090000Z\r\nDTSTART:20260412T150000Z\r\nDTEND:20260412T160000Z\r\nSUMMARY:Moved sample meeting'
    )
    const refreshed = parseIcs(calendar(series + '\r\n' + override), 'sample-feed', window)
    const reopened = new EventCompletionStore({ read: () => marks(), write: async () => {} })
    expect(refreshed.map((e) => reopened.isDone(e))).toEqual([false, true, false])
    expect(reopened.isDone(parseIcs(calendar(override), 'sample-feed', window)[0])).toBe(true)
    await store.setDone(events[1], false, 101)
    expect(store.isDone(events[1])).toBe(false)
  })

  it('identifies a one-off by feed and UID, not by its rescheduled start', async () => {
    const first = parseIcs(
      calendar(item('UID:sample-once\r\nDTSTART:20260410T090000Z')),
      'sample-feed',
      window
    )[0]
    const moved = parseIcs(
      calendar(item('UID:sample-once\r\nDTSTART:20260415T160000Z')),
      'sample-feed',
      window
    )[0]
    const { store } = memory()
    await store.setDone(first, true, 100)
    expect(store.isDone(moved)).toBe(true)
    expect(store.isDone({ ...moved, feedId: 'another-feed' })).toBe(false)
  })

  it('survives device timezone changes for floating recurrence and equivalent zoned source times', async () => {
    const oldZone = process.env.TZ
    try {
      process.env.TZ = 'Europe/Berlin'
      const floating = calendar(
        series.replaceAll('090000Z', '090000').replaceAll('100000Z', '100000')
      )
      const first = parseIcs(floating, 'sample-feed', window)[1]
      const { store } = memory()
      await store.setDone(first, true, 100)
      process.env.TZ = 'America/New_York'
      const changed = parseIcs(floating, 'sample-feed', window)[1]
      expect(changed.start).not.toBe(first.start)
      expect(store.isDone(changed)).toBe(true)
      const utc = parseIcs(calendar(series), 'sample-feed', window)[1]
      const zoned = parseIcs(
        calendar(
          series
            .replace('DTSTART:20260410T090000Z', 'DTSTART;TZID=Europe/Berlin:20260410T110000')
            .replace('DTEND:20260410T100000Z', 'DTEND;TZID=Europe/Berlin:20260410T120000')
        ),
        'sample-feed',
        window
      )[1]
      expect(completionKey(zoned)).toBe(completionKey(utc))
    } finally {
      if (oldZone === undefined) delete process.env.TZ
      else process.env.TZ = oldZone
    }
  })

  it('keeps an unresolved source timezone independent of the device clock', () => {
    const oldZone = process.env.TZ
    const ics = calendar(
      series
        .replace('DTSTART:20260410T090000Z', 'DTSTART;TZID=Sample/Unknown:20260410T090000')
        .replace('DTEND:20260410T100000Z', 'DTEND;TZID=Sample/Unknown:20260410T100000')
    )
    try {
      process.env.TZ = 'Europe/Berlin'
      const first = parseIcs(ics, 'sample-feed', window)[1]
      process.env.TZ = 'America/New_York'
      expect(completionKey(parseIcs(ics, 'sample-feed', window)[1])).toBe(completionKey(first))
    } finally {
      if (oldZone === undefined) delete process.env.TZ
      else process.env.TZ = oldZone
    }
  })

  it('does not lose another mark while storage is still writing', async () => {
    let marks: CompletionMarks = {}
    const store = new EventCompletionStore({
      read: () => marks,
      write: async (next) => {
        await Promise.resolve()
        marks = next
      },
    })
    const events = parseIcs(calendar(series), 'sample-feed', window)
    await Promise.all(events.map((e) => store.setDone(e, true, 100)))
    expect(events.map((e) => store.isDone(e))).toEqual([true, true, true])
  })

  it('keeps seen marks and prunes missing ones only after the retention period', async () => {
    const events = parseIcs(calendar(series), 'sample-feed', window)
    const { store } = memory()
    await store.setDone(events[0], true, 100)
    await store.setDone(events[1], true, 100)
    const day = 86400000
    await store.reconcile('sample-feed', [events[0]], 100 + 179 * day)
    expect(store.isDone(events[1])).toBe(true)
    await store.reconcile('sample-feed', [events[0]], 100 + 181 * day)
    expect(store.isDone(events[0])).toBe(true)
    expect(store.isDone(events[1])).toBe(false)
  })
})
