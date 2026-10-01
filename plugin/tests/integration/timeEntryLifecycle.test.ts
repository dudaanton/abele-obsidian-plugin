import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { TFile } from 'obsidian'
import { TimeEntry } from '@/entities/TimeEntry'
import { TimeEntryList } from '@/entities/TimeEntryList'
import { GlobalStore } from '@/stores/GlobalStore'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { configureAbele, useVault } from '../helpers/testEnv'

const PATH = 'Timers/Orchard.md'
const START = '2024-02-29T23:59:30'
let app: ReturnType<typeof useVault>
let list: TimeEntryList | undefined
let entries: TimeEntry[]
let oldTZ: string | undefined
const entry = (wikilink = '[[Timers/Orchard|Picking]]') => {
  const result = new TimeEntry({ wikilink, filePath: ' Notes/Orchard ' })
  entries.push(result)
  return result
}
const fileAt = (path = PATH) => app.vault.getAbstractFileByPath(path) as TFile
const resolved = () => app.emit('metadataCache', 'resolved')

beforeEach(() => {
  oldTZ = process.env.TZ
  process.env.TZ = 'Europe/Berlin'
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2024-03-01T00:01:00+01:00'))
  app = useVault([
    { path: PATH, frontmatter: { type: 'time-entry', start: START, groups: ['[[Orchard]]'] } },
  ])
  configureAbele()
  entries = []
  list = undefined
})
afterEach(() => {
  list?.cleanup()
  GlobalStore.getInstance().timeEntryList.value = null
  entries.forEach((item) => item.cleanup())
  VaultWatcherWrapper.destroy()
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (oldTZ === undefined) delete process.env.TZ
  else process.env.TZ = oldTZ
})

describe('TimeEntry public state and lifecycle', () => {
  it('resolves basenames, keeps display aliases and normalises the owning note', () => {
    const item = entry('[[Orchard|Harvest]]')
    expect(item.entryPath).toBe(PATH)
    expect(item.entryFolder).toBe('Timers')
    expect(item.entryName).toBe('Harvest')
    expect(item.filePath).toBe('Notes/Orchard.md')
    expect(item.id).toEqual(expect.any(String))
    expect(new TimeEntry({ id: 'fixed', wikilink: '[[Missing]]' }).id).toBe('fixed')
    expect(new TimeEntry({ wikilink: '[[Missing]]' }).entryFolder).toBe('')
  })

  it('loads once, force reloads metadata, and registers its watcher only once', async () => {
    const item = entry()
    const register = vi.spyOn(VaultWatcherWrapper.getInstance(), 'registerCallback')
    await item.load()
    expect(item.loaded).toBe(true)
    expect(item.watcherInitialized).toBe(true)
    expect(item.start?.format('YYYY-MM-DDTHH:mm:ss')).toBe(START)
    expect(item.date).toBe(item.start)
    expect(item.groups).toEqual(['[[Orchard]]'])
    expect(item.isActive).toBe(true)
    app.setFrontmatter(PATH, { start: START, end: '2024-03-01T00:00:00', groups: '[[Orchard]]' })
    await item.load()
    expect(item.isActive).toBe(true)
    await item.load(true)
    expect(item.isActive).toBe(false)
    expect(item.duration).toBe(30)
    expect(item.groups).toEqual([])
    item.initWatcher()
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('computes live seconds across midnight, truncates fractional seconds, and preserves negative durations', () => {
    const item = entry()
    expect(item.duration).toBe(0)
    expect(item.isActive).toBe(false)
    item.start = dayjs(START)
    expect(item.duration).toBe(90)
    vi.advanceTimersByTime(1500)
    expect(item.duration).toBe(91)
    item.end = item.start.add(999, 'millisecond')
    expect(item.duration).toBe(0)
    item.end = item.start.subtract(2, 'second')
    expect(item.duration).toBe(-2)
  })

  it('uses elapsed instants across a DST jump rather than wall-clock subtraction', () => {
    const item = entry()
    item.start = dayjs('2024-03-31T01:30:00+01:00')
    item.end = dayjs('2024-03-31T03:30:00+02:00')
    expect(item.duration).toBe(3600)
  })

  it('keeps invalid dates as invalid Dayjs values and accepts only arrays for groups', async () => {
    app.setFrontmatter(PATH, { start: 'broken', end: 'broken', groups: { bad: true } })
    const item = entry()
    await item.load()
    expect(item.start?.isValid()).toBe(false)
    expect(item.end?.isValid()).toBe(false)
    expect(item.duration).toBeNaN()
    expect(item.groups).toEqual([])
    app.setFrontmatter(PATH, {})
    await item.load(true)
    expect(item.start).toBeNull()
    expect(item.end).toBeNull()
    expect(item.duration).toBe(0)
  })

  it('marks missing entries and produces a DTO whose groups can be edited independently', async () => {
    const missing = entry('[[Gone]]')
    await missing.load()
    expect(missing.entryNotFound).toBe(true)
    const item = entry()
    await item.load()
    const dto = item.toCreateDTO()
    expect(dto).toEqual({ start: item.start, end: null, groups: ['[[Orchard]]'] })
    dto.groups!.push('[[Meadow]]')
    expect(item.groups).toEqual(['[[Orchard]]'])
  })

  it('follows moves, drops the old alias and continues receiving edits at the new path', async () => {
    const item = entry()
    await item.load()
    const file = fileAt()
    await GlobalStore.getInstance().app.fileManager.renameFile(file, 'Archive/Harvest.md')
    app.emit('vault', 'rename', file, PATH)
    expect(item.entryPath).toBe('Archive/Harvest.md')
    expect(item.entryName).toBe('Harvest')
    expect(item.entryFolder).toBe('Archive')
    app.setFrontmatter(file.path, { start: START, end: '2024-03-01T00:00:00' })
    app.emit('vault', 'modify', file)
    expect(item.duration).toBe(30)
  })

  it('trashes through the file manager, even on a second remove, and cannot reload after cleanup', async () => {
    const manager = GlobalStore.getInstance().app.fileManager
    const trash = vi.spyOn(manager, 'trashFile')
    const item = entry()
    await item.load()
    await item.remove()
    expect(trash).toHaveBeenCalledTimes(1)
    expect(app.vault.getAbstractFileByPath(PATH)).toBeNull()
    await item.remove()
    await item.load(true)
    expect(trash).toHaveBeenCalledTimes(1)
    expect(item.loaded).toBe(false)
    expect(item.watcherInitialized).toBe(false)
    expect(item.start).toBeNull()
    expect(item.end).toBeNull()
    expect(item.groups).toEqual([])
    expect(item.entryNotFound).toBe(false)
  })

  it('unsubscribes on cleanup so later modifications do not read metadata', async () => {
    const item = entry()
    await item.load()
    const remove = vi.spyOn(VaultWatcherWrapper.getInstance(), 'removeCallback')
    item.cleanup()
    item.cleanup()
    app.resetStats()
    app.emit('vault', 'modify', fileAt())
    expect(remove).toHaveBeenCalledTimes(1)
    expect(app.stats.getFileCache).toBe(0)
  })

  // BUG: VaultWatcherWrapper's delete event omits `file`; FileWatcher requires a TFile.
  // Deleting an open timer outside this entity leaves it apparently present and active.
  it('notices an external deletion of the watched entry', async () => {
    const item = entry()
    await item.load()
    const file = fileAt()
    await GlobalStore.getInstance().app.vault.delete(file)
    app.emit('vault', 'delete', file)
    expect(item.entryNotFound).toBe(true)
  })
})

describe('TimeEntryList metadata batches', () => {
  it('discovers only markdown time entries and returns all active entries', () => {
    app = useVault([
      { path: PATH, frontmatter: { type: 'time-entry', start: START } },
      { path: 'Timers/Second.md', frontmatter: { type: 'time-entry', start: START } },
      { path: 'Timers/Stopped.md', frontmatter: { type: 'time-entry', start: START, end: START } },
      { path: 'Timers/Empty.md', frontmatter: { type: 'time-entry' } },
      { path: 'Notes/Not a timer.md', frontmatter: { type: 'note' } },
      { path: 'Timers/Other.txt', frontmatter: { type: 'time-entry', start: START } },
    ])
    list = new TimeEntryList()
    expect(list.entries.size).toBe(4)
    expect(list.activeEntries.value.map((item) => item.entryPath)).toEqual([
      PATH,
      'Timers/Second.md',
    ])
  })

  it('rescans once at first resolution, then batches and deduplicates changes', () => {
    app.setFrontmatter(PATH, {})
    list = new TimeEntryList()
    expect(list.entries.size).toBe(0)
    app.setFrontmatter(PATH, { type: 'time-entry', start: START })
    resolved()
    const original = list.entries.get(PATH)
    expect(original).toBeDefined()
    app.resetStats()
    for (let i = 0; i < 1000; i++) app.emit('metadataCache', 'changed', fileAt())
    expect(list.entries.size).toBe(1)
    resolved()
    resolved()
    expect(list.entries.size).toBe(1)
    expect(list.entries.get(PATH)).toBe(original)
    expect(app.stats.getMarkdownFiles).toBe(0)
  })

  it('waits for resolution before admitting newly typed entries', () => {
    app.setFrontmatter(PATH, { type: 'note' })
    list = new TimeEntryList()
    resolved()
    app.setFrontmatter(PATH, { type: 'time-entry', start: START })
    app.emit('metadataCache', 'changed', fileAt())
    expect(list.entries.size).toBe(0)
    resolved()
    expect(list.activeEntries.value).toHaveLength(1)
  })

  it.each(['change-first', 'rename-first'])(
    'applies a move and stop in one batch (%s)',
    async (order) => {
      list = new TimeEntryList()
      resolved()
      const old = list.entries.get(PATH)!
      const file = fileAt()
      app.setFrontmatter(PATH, { type: 'time-entry', start: START, end: START })
      if (order === 'change-first') app.emit('metadataCache', 'changed', file)
      await GlobalStore.getInstance().app.fileManager.renameFile(file, 'Archive/Harvest.md')
      app.emit('vault', 'rename', file, PATH)
      if (order === 'rename-first') app.emit('metadataCache', 'changed', file)
      resolved()
      expect([...list.entries.keys()]).toEqual(['Archive/Harvest.md'])
      expect(list.activeEntries.value).toEqual([])
      expect(old.loaded).toBe(false)
      expect(list.entries.get(file.path)?.duration).toBe(0)
    }
  )

  it('cleans deleted entries after resolution and ignores folders', async () => {
    list = new TimeEntryList()
    resolved()
    const old = list.entries.get(PATH)!
    const file = fileAt()
    await GlobalStore.getInstance().app.vault.delete(file)
    app.emit('vault', 'delete', file)
    app.emit('vault', 'delete', app.vault.getAbstractFileByPath('Timers'))
    expect(list.entries.size).toBe(1)
    resolved()
    expect(list.entries.size).toBe(0)
    expect(old.loaded).toBe(false)
    expect(list.activeEntries.value).toEqual([])
  })

  it('clears a large list and does not replay a queued change after cleanup', () => {
    app = useVault(
      Array.from({ length: 1000 }, (_, i) => ({
        path: `Timers/Entry ${i}.md`,
        frontmatter: { type: 'time-entry', start: START },
      }))
    )
    list = new TimeEntryList()
    expect(list.activeEntries.value).toHaveLength(1000)
    resolved()
    const off = vi.spyOn(app.metadataCache, 'offref')
    app.emit('metadataCache', 'changed', fileAt('Timers/Entry 0.md'))
    list.cleanup()
    list.cleanup()
    // The shared fake's offref is deliberately a no-op, so this also exercises the guard.
    resolved()
    expect(list.entries.size).toBe(0)
    expect(list.activeEntries.value).toEqual([])
    expect(off).toHaveBeenCalledTimes(4)
  })

  // BUG: changed only adds matching entries, never removes a note whose type was changed.
  // Converting a timer into a regular note leaves it in the timer list until restart.
  it('removes an entry when its type ceases to be time-entry', () => {
    list = new TimeEntryList()
    resolved()
    app.setFrontmatter(PATH, { type: 'note' })
    app.emit('metadataCache', 'changed', fileAt())
    resolved()
    expect(list.entries.size).toBe(0)
  })
})
