import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import dayjs from 'dayjs'
import { TFile } from 'obsidian'
import { Log } from '@/entities/Log'
import { GlobalStore } from '@/stores/GlobalStore'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { configureAbele, useVault } from '../helpers/testEnv'

const PATH = 'Logs/2024-02-29 Orchard.md'
const TARGET = 'Notes/Orchard.md'
let app: ReturnType<typeof useVault>
let logs: Log[]
const log = (path = PATH, target?: string) => {
  const result = new Log(path, target)
  logs.push(result)
  return result
}
beforeEach(() => {
  app = useVault([
    {
      path: PATH,
      frontmatter: { type: 'log', created: '2024-03-01T01:00:00' },
      content: 'About [[Orchard]].\n\nOther paragraph.',
    },
    { path: TARGET },
  ])
  configureAbele()
  logs = []
})
afterEach(() => {
  logs.forEach((item) => item.cleanup())
  VaultWatcherWrapper.destroy()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Log metadata and watchers', () => {
  it('prefers created to the filename, reads metadata without reading the body, and registers once', async () => {
    const item = log(PATH, ' Notes/Orchard ')
    const register = vi.spyOn(VaultWatcherWrapper.getInstance(), 'registerCallback')
    await item.load()
    await item.load()
    item.initWatcher()
    // Log dates use DATE_FORMAT, discarding the time part of created.
    expect(item.createdAt?.format('YYYY-MM-DDTHH:mm:ss')).toBe('2024-03-01T00:00:00')
    expect(item.getLogDateOrToday()).toBe(item.createdAt)
    expect(item.type).toBe('log')
    expect(item.targetFilePath).toBe(TARGET)
    expect(item.loaded).toBe(true)
    expect(item.watcherInitialized).toBe(true)
    expect(register).toHaveBeenCalledTimes(2)
    expect(app.stats.read).toBe(0)
    app.setFrontmatter(PATH, { type: 'daily', created: 'bad' })
    await item.load()
    expect(item.type).toBe('log')
    await item.load(true)
    expect(item.type).toBe('daily')
    expect(item.createdAt?.format('YYYY-MM-DD')).toBe('2024-02-29')
  })

  it('has no type/date for an undated note and falls back to the current instant', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-03-01T00:00:01+01:00'))
    app = useVault([{ path: 'Logs/Undated.md' }])
    const item = log('Logs/Undated')
    await item.load()
    expect(item.type).toBeNull()
    expect(item.createdAt).toBeNull()
    expect(item.getLogDateOrToday().valueOf()).toBe(dayjs().valueOf())
  })

  it('cleanData clears only metadata and allows a fresh load without duplicate watchers', async () => {
    const item = log()
    await item.load()
    await item.loadContent()
    item.cleanData()
    expect(item.createdAt).toBeNull()
    expect(item.type).toBeNull()
    expect(item.loaded).toBe(false)
    expect(item.content).toBe('About [[Orchard]].\n\nOther paragraph.')
    expect(item.watcherInitialized).toBe(true)
    await item.load()
    expect(item.type).toBe('log')
  })

  it('follows a move and reads new metadata on subsequent changes, logging only at debug level', async () => {
    const item = log()
    await item.load()
    const ordinaryLog = vi.spyOn(console, 'log')
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const file = app.vault.getAbstractFileByPath(PATH) as TFile
    await GlobalStore.getInstance().app.fileManager.renameFile(file, 'Archive/Harvest.md')
    app.emit('vault', 'rename', file, PATH)
    expect(item.filePath).toBe('Archive/Harvest.md')
    expect(item.name).toBe('Harvest')
    expect(item.wikilink).toBe('[[Archive/Harvest.md|Harvest]]')
    app.setFrontmatter(file.path, { type: 'daily', created: '2024-04-01' })
    app.emit('vault', 'modify', file)
    expect(item.createdAt?.format('YYYY-MM-DD')).toBe('2024-04-01')
    expect(item.type).toBe('daily')
    expect(debug).toHaveBeenCalledWith('log file changed')
    expect(ordinaryLog).not.toHaveBeenCalled()
  })

  it('reloads related text when the target changes or moves', async () => {
    const item = log(PATH, TARGET)
    await item.load()
    await item.loadContent()
    expect(item.content).toBe('About [[Orchard]].')
    const file = app.vault.getAbstractFileByPath(TARGET) as TFile
    const content = vi.spyOn(item, 'loadContent')
    app.emit('vault', 'modify', file)
    await flushPromises()
    expect(content).toHaveBeenCalledTimes(1)
    await GlobalStore.getInstance().app.fileManager.renameFile(file, 'Archive/Orchard.md')
    app.emit('vault', 'rename', file, TARGET)
    await flushPromises()
    expect(item.targetFilePath).toBe('Archive/Orchard.md')
    expect(item.content).toBe('About [[Orchard]].')
    expect(content).toHaveBeenCalledTimes(2)
  })

  it('cleanup removes both watchers and prevents forced metadata reloads', async () => {
    const item = log(PATH, TARGET)
    await item.load()
    const remove = vi.spyOn(VaultWatcherWrapper.getInstance(), 'removeCallback')
    item.cleanup()
    item.cleanup()
    app.resetStats()
    await item.load(true)
    app.emit('vault', 'modify', app.vault.getAbstractFileByPath(PATH))
    app.emit('vault', 'modify', app.vault.getAbstractFileByPath(TARGET))
    expect(remove).toHaveBeenCalledTimes(2)
    expect(item.watcherInitialized).toBe(false)
    expect(item.loaded).toBe(false)
    expect(item.createdAt).toBeNull()
    expect(app.stats.getFileCache).toBe(0)
  })
})

describe('Log relatedText and content', () => {
  it.each([
    '[[Notes/Orchard]]',
    '[[Notes/Orchard.md]]',
    '[[Orchard.md]]',
    '[[Orchard.md|Fruit]]',
    '[[Orchard.md#Harvest]]',
    '[[Orchard|Fruit]]',
    '[[Orchard#Harvest]]',
  ])('selects full paths, extensions, aliases and headings: %s', async (link) => {
    app = useVault([{ path: PATH, content: `  Kept ${link}.  \n\n Removed. ` }, { path: TARGET }])
    const item = log(PATH, TARGET)
    await item.loadContent()
    expect(item.content).toBe(`Kept ${link}.`)
  })

  it('compares body spelling case-insensitively after metadata resolves the target', () => {
    expect(log(PATH, TARGET).relatedText('A [[ORCHARD]].\n\nNot about it.')).toBe('A [[ORCHARD]].')
  })

  it('trims paragraphs, preserves single newlines and duplicates, and supports empty/large bodies', () => {
    const item = log()
    expect(item.relatedText('')).toBe('')
    expect(item.relatedText('  First\nsecond  \n\n First\nsecond  ')).toBe(
      'First\nsecond\n\nFirst\nsecond'
    )
    const body = Array.from({ length: 2000 }, (_, i) => `Paragraph ${i}`).join('\n\n')
    expect(item.relatedText(body)).toBe(body)
  })

  it('searches later branches after an unrelated cycle and skips non-links', async () => {
    app = useVault([
      { path: PATH, content: 'Keep [[Seed]].\n\nDrop [[Other]].' },
      { path: TARGET },
      { path: 'Notes/Other.md' },
      {
        path: 'Notes/Seed.md',
        frontmatter: { groups: [null, 42, 'plain', '[[Cycle]]', '[[Orchard|Fruit]]'] },
      },
      { path: 'Notes/Cycle.md', frontmatter: { groups: ['[[Seed]]'] } },
    ])
    const item = log(PATH, TARGET)
    await item.loadContent()
    expect(item.content).toBe('Keep [[Seed]].') // Regression contract for 5f1a4b49.
  })

  // BUG: traversal iterates truthy groups without checking Array.isArray. A YAML mapping
  // or number on any related note makes the entire log body fail to load.
  it.each([42, { project: 'Orchard' }])(
    'ignores malformed groups %j instead of throwing',
    async (groups) => {
      app = useVault([
        { path: PATH, content: 'About [[Seed]].' },
        { path: 'Notes/Seed.md', frontmatter: { groups } },
        { path: TARGET },
      ])
      const item = log(PATH, TARGET)
      await item.loadContent()
      expect(item.content).toBe('About [[Seed]].')
    }
  )

  // BUG: relatedText matches link prefixes without a delimiter. A paragraph linking only
  // Orchard Annex leaks into Orchard once another paragraph really links Orchard.
  it('does not select an unrelated note with a shared name prefix', async () => {
    app = useVault([
      { path: PATH, content: 'Keep [[Orchard]].\n\nDrop [[Orchard Annex]].' },
      { path: TARGET },
      { path: 'Notes/Orchard Annex.md' },
    ])
    const item = log(PATH, TARGET)
    await item.loadContent()
    expect(item.content).toBe('Keep [[Orchard]].')
  })
})
