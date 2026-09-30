import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { TimeEntryList } from '@/entities/TimeEntryList'
import { createTimeEntry, stopActiveTimeEntry } from '@/commands/createTimeEntry'
import { getNoteData } from '@/helpers/notesUtils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { configureAbele, useVault } from '../helpers/testEnv'

let app: ReturnType<typeof useVault>
let list: TimeEntryList | undefined
let oldTZ: string | undefined
let oldTemplate: string
beforeEach(() => {
  oldTZ = process.env.TZ
  process.env.TZ = 'Europe/Berlin'
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2024-03-01T00:01:00+01:00'))
  app = useVault([])
  configureAbele()
  oldTemplate = AbeleConfig.getInstance().timeEntryPathTemplate
  AbeleConfig.getInstance().timeEntryPathTemplate = 'Timers/{{date}} {{groups}} {{start}}'
  GlobalStore.getInstance().timeEntryList.value = null
})
afterEach(() => {
  list?.cleanup()
  list = undefined
  GlobalStore.getInstance().timeEntryList.value = null
  VaultWatcherWrapper.destroy()
  AbeleConfig.getInstance().timeEntryPathTemplate = oldTemplate
  vi.useRealTimers()
  if (oldTZ === undefined) delete process.env.TZ
  else process.env.TZ = oldTZ
})
const installList = () => {
  list = new TimeEntryList()
  GlobalStore.getInstance().timeEntryList.value = list
}

describe('time entry creation and stopping', () => {
  it('reports no running timers for a missing or empty list', async () => {
    expect(await stopActiveTimeEntry()).toBe(false)
    installList()
    expect(await stopActiveTimeEntry()).toBe(false)
  })

  it('stops every active timer at one instant and preserves unrelated properties and body', async () => {
    app = useVault([
      {
        path: 'Timers/First.md',
        frontmatter: { type: 'time-entry', start: '2024-02-29T23:50:00', extra: 'keep' },
        content: 'Keep this body.\n',
      },
      {
        path: 'Timers/Second.md',
        frontmatter: { type: 'time-entry', start: '2024-02-29T23:59:00' },
      },
      {
        path: 'Timers/Stopped.md',
        frontmatter: {
          type: 'time-entry',
          start: '2024-02-28T12:00:00',
          end: '2024-02-28T13:00:00',
        },
      },
    ])
    installList()
    expect(await stopActiveTimeEntry()).toBe(true)
    expect(await getNoteData('Timers/First.md')).toMatchObject({
      end: '2024-03-01T00:01:00',
      extra: 'keep',
      content: 'Keep this body.\n',
    })
    expect(await getNoteData('Timers/Second.md')).toMatchObject({ end: '2024-03-01T00:01:00' })
    expect(await getNoteData('Timers/Stopped.md')).toMatchObject({ end: '2024-02-28T13:00:00' })
    expect(app.stats.modify).toBe(2)
  })

  it('creates local timestamps and a default Timer name without stealing focus', async () => {
    const openLinkText = vi.fn()
    Object.assign(app, { workspace: { openLinkText } })
    await createTimeEntry(undefined, false)
    expect(await getNoteData('Timers/2024-03-01 Timer 00-01.md')).toMatchObject({
      type: 'time-entry',
      start: '2024-03-01T00:01:00',
      end: null,
    })
    expect(openLinkText).not.toHaveBeenCalled()
  })

  it('uses aliases in filenames, preserves groups, and allocates a suffix even before cache resolution', async () => {
    const data = {
      start: dayjs('2024-02-29T23:59:00'),
      end: dayjs('2024-03-01'),
      groups: ['[[Notes/Orchard|Harvest]]', '[[Meadow]]'],
    }
    await createTimeEntry(data, false)
    await createTimeEntry(data, false)
    expect(app.vault.getMarkdownFiles().map((file) => file.path)).toEqual([
      'Timers/2024-02-29 Harvest, Meadow 23-59.md',
      'Timers/2024-02-29 Harvest, Meadow 23-59 (1).md',
    ])
    // The command always starts an active timer, even if the caller passed an end.
    expect(await getNoteData('Timers/2024-02-29 Harvest, Meadow 23-59 (1).md')).toMatchObject({
      start: '2024-02-29T23:59:00',
      end: null,
      groups: data.groups,
    })
  })

  it('stops the previous timer before creating and focusing its replacement', async () => {
    app = useVault([
      { path: 'Timers/Old.md', frontmatter: { type: 'time-entry', start: '2024-02-29T23:50:00' } },
    ])
    const openLinkText = vi.fn()
    Object.assign(app, { workspace: { openLinkText, getActiveViewOfType: () => null } })
    installList()
    AbeleConfig.getInstance().timeEntryPathTemplate = '{{date}}.md'
    await createTimeEntry()
    expect(await getNoteData('Timers/Old.md')).toMatchObject({ end: '2024-03-01T00:01:00' })
    expect(await getNoteData('2024-03-01.md')).toMatchObject({ end: null })
    expect(openLinkText).toHaveBeenCalledWith('2024-03-01.md', '', false)
  })
})
