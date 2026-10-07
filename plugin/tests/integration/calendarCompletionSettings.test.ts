import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { settingsSnapshot } from '@/services/settingsEdits'
import { startCalendars } from '@/calendars/start'
import { completionKey } from '@/calendars/completion'
import { parseIcs } from '@/calendars/ics'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CalendarEventView from '@/components/CalendarEvent.vue'
import { newFeed } from '@/calendars/settings'
import { deferred } from '../helpers/deferred'

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
  it.each([true, false])(
    'updates the visible done=%s checkbox before a slow settings read can finish',
    async (done) => {
      const { disk, service } = await start()
      if (!done) await service.setDone(events[0], true)
      const read = disk.delays.holdNext('load')
      const reading = config.reloadSettings()
      await read.entered
      const view = mount(CalendarEventView, {
        props: {
          event: events[0],
          feed: { ...newFeed([]), id: 'sample-feed', name: 'Sample calendar' },
          day: '2026-04-10',
        },
      })
      const requested = deferred<void>()
      const save = config.saveSettings.bind(config)
      vi.spyOn(config, 'saveSettings').mockImplementation(() => {
        const writing = save()
        requested.resolve()
        return writing
      })
      const editing = service.setDone(events[0], done)
      let completed = false
      void editing.then(() => {
        completed = true
      })
      try {
        await requested.promise
        await nextTick()
        expect(completed).toBe(false) // Persistence is deliberately waiting behind the read.
        expect(service.isDone(events[0])).toBe(done)
        expect((view.find('input').element as HTMLInputElement).checked).toBe(done)
        expect(view.classes().includes('is-checked')).toBe(done)
        read.release()
        await Promise.all([reading, editing])
        expect((view.find('input').element as HTMLInputElement).checked).toBe(done)
      } finally {
        read.release()
        await Promise.all([reading, editing])
        view.unmount()
      }
    }
  )
  it('redraws a visible calendar mark when its queued save fails and rolls back', async () => {
    const { disk, service } = await start()
    const write = disk.delays.holdNext('save')
    const view = mount(CalendarEventView, {
      props: {
        event: events[0],
        feed: { ...newFeed([]), id: 'sample-feed', name: 'Sample calendar' },
        day: '2026-04-10',
      },
    })
    const editing = service.setDone(events[0], true)
    const failure = expect(editing).rejects.toThrow('Sample save failure')
    try {
      await write.entered
      await nextTick()
      expect((view.find('input').element as HTMLInputElement).checked).toBe(true)
      write.reject(new Error('Sample save failure'))
      await failure
      await nextTick()
      expect(service.isDone(events[0])).toBe(false)
      expect((view.find('input').element as HTMLInputElement).checked).toBe(false)
    } finally {
      write.release()
      await failure
      view.unmount()
    }
  })

  it.each([true, false])(
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

      const requested = deferred<void>()
      const save = config.saveSettings.bind(config)
      vi.spyOn(config, 'saveSettings').mockImplementation(() => {
        const writing = save()
        requested.resolve()
        return writing
      })
      const editing = service.setDone(events[0], done)
      await requested.promise // Local intent is applied; the queued disk write is not awaited.
      expect(service.isDone(events[0])).toBe(done)
      finishRead()
      await Promise.all([reading, editing])
      expect(disk.saved.at(-1)?.calendarCompletion).toEqual(config.calendarCompletion)

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
