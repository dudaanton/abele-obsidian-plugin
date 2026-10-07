import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setTimeout, clearTimeout } from 'node:timers'
import { AbeleConfig } from '@/services/AbeleConfig'
import { settingsSnapshot } from '@/services/settingsEdits'
import { startCalendars } from '@/calendars/start'
import { completionKey } from '@/calendars/completion'
import { parseIcs } from '@/calendars/ics'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'

const config = AbeleConfig.getInstance()
const disposals: Array<() => void> = []
const events = parseIcs(
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:sample-series',
    'DTSTART:20260410T090000Z',
    'RRULE:FREQ=DAILY;COUNT=3',
    'SUMMARY:Sample meeting',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'),
  'sample-feed',
  { from: Date.UTC(2026, 3, 1), to: Date.UTC(2026, 4, 1) }
)

beforeEach(() => {
  vi.useFakeTimers()
  config.destroy()
  config.applySettings(undefined)
})
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
  config.destroy()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function start() {
  const app = useVault([])
  const disk = Object.assign(new FakeSettings(config.exportSettings()), {
    app: { vault: app.vault, workspace: { onLayoutReady: vi.fn() } },
    manifest: { dir: '.obsidian/plugins/sample-plugin' },
    register: (dispose: () => void) => disposals.push(dispose),
    registerInterval: (id: number) => disposals.push(() => window.clearInterval(id)),
  })
  config.init(disk as never)
  await config.loadSettings()
  const service = startCalendars(disk as never)
  return { disk, service }
}

describe('calendar marks while shared settings are being read', () => {
  // BUG: setDone awaits persistence queued behind the held reload; it cannot finish before that read is released.
  it.fails.each([true, false])(
    'keeps a later local done=%s edit after an older read returns, and on the next save',
    async (done) => {
      const { disk, service } = await start()
      if (!done) await service.setDone(events[0], true)
      const old = settingsSnapshot(disk.stored) as ReturnType<typeof config.exportSettings>
      old.tasksFolder = 'Sample incoming tasks'
      old.calendarCompletion[completionKey(events[2])] = {
        feedId: events[2].feedId,
        seenAt: Date.now(),
      }
      let finishRead!: () => void
      const gate = new Promise<void>((resolve) => {
        finishRead = resolve
      })
      vi.spyOn(disk, 'loadData').mockImplementationOnce(async () => {
        await gate
        return old
      })
      const reading = config.reloadSettings()

      const writing = service.setDone(events[0], done)
      let timeout: ReturnType<typeof setTimeout>
      try {
        await Promise.race([
          writing,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('save is queued behind the held read')),
              100
            )
          }),
        ])
      } finally {
        clearTimeout(timeout!)
        finishRead()
        await reading
        await writing
      }
      expect(service.isDone(events[0])).toBe(done)
      expect(disk.saved.at(-1)?.calendarCompletion).toEqual(config.calendarCompletion)
      finishRead()
      await reading

      expect(service.isDone(events[0])).toBe(done)
      expect(service.isDone(events[1])).toBe(false)
      expect(service.isDone(events[2])).toBe(true)
      expect(config.tasksFolder).toBe('Sample incoming tasks')
      await config.saveSettings()
      expect(disk.saved.at(-1)?.calendarCompletion).toEqual(config.calendarCompletion)
      await config.reloadSettings()
      expect(service.isDone(events[0])).toBe(done)
      expect(service.isDone(events[2])).toBe(true)
    }
  )
})
