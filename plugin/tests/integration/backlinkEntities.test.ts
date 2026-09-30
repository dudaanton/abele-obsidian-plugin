process.env.TZ = 'Europe/Berlin'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Note } from '@/entities/Note'
import { Footer } from '@/entities/Footer'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { configureAbele, useVault } from '../helpers/testEnv'

const PATH = 'Notes/Sample 2028-02-29.md'

describe('backlink metadata entities', () => {
  let app: ReturnType<typeof useVault>
  const entities: Array<Note | Footer> = []
  const note = () => {
    const n = new Note(PATH)
    entities.push(n)
    return n
  }
  const footer = () => {
    const f = new Footer({ id: 'sample-footer', filePath: PATH })
    entities.push(f)
    return f
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2028-03-01T00:30:00+01:00'))
    configureAbele()
    app = useVault([{ path: PATH, frontmatter: {} }])
    app.vault.getFileByPath(PATH)!.stat.mtime = Date.parse('2028-02-29T23:10:00Z')
  })
  afterEach(() => {
    entities.splice(0).forEach((entity) => entity.cleanup())
    VaultWatcherWrapper.destroy()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each([
    [' padded text ', 'padded text'],
    [['first', 9, null, 'second'], 'first, second'],
    [42, '42'],
    [0, '0'],
    [false, null],
    [{ text: 'not text' }, null],
    [[], null],
    ['  ', null],
  ])(
    'normalizes the description %j without reading the note body',
    async (description, expected) => {
      app.setFrontmatter(PATH, { description })
      const n = note()
      await n.load()
      expect(n.description).toBe(expected)
      expect(app.stats.read).toBe(0)
    }
  )

  it('normalizes paths and falls back to filename creation and local file modification dates', async () => {
    const n = note()
    expect(new Note(' /Notes/Sample 2028-02-29/ ').filePath).toBe(PATH)
    expect(n.name).toBe('Sample 2028-02-29')
    await n.load()
    expect(n.createdAt?.format('YYYY-MM-DD')).toBe('2028-02-29')
    expect(n.updatedAt?.format('YYYY-MM-DD HH:mm')).toBe('2028-03-01 00:10')
    expect(n.getNoteDateOrToday()).toBe(n.createdAt)
    expect(n.noteNotFound).toBe(false)
  })

  it('prefers explicit dates and falls back from invalid ones', async () => {
    app.setFrontmatter(PATH, { created: '2027-12-31', updated: '2028-02-28', type: 'book' })
    const n = note()
    await n.load()
    expect(n.createdAt?.format('YYYY-MM-DD')).toBe('2027-12-31')
    expect(n.updatedAt?.format('YYYY-MM-DD')).toBe('2028-02-28')
    expect(n.type).toBe('book')
    app.setFrontmatter(PATH, { created: 'invalid', updated: 'invalid', type: '' })
    await n.load(true)
    expect(n.createdAt?.format('YYYY-MM-DD')).toBe('2028-02-29')
    expect(n.updatedAt?.format('YYYY-MM-DD')).toBe('2028-03-01')
    expect(n.type).toBeNull()
  })

  it('uses today for an undated name and cleanData clears decorations but leaves its watcher', async () => {
    const n = new Note('Notes/Undated.md')
    entities.push(n)
    await app.vault.create(n.filePath, '')
    app.setFrontmatter(n.filePath, { description: 'Summary', cover: '[[image.png]]' })
    await n.load()
    expect(n.createdAt).toBeNull()
    expect(n.getNoteDateOrToday().format('YYYY-MM-DD HH:mm')).toBe('2028-03-01 00:30')
    n.cleanData()
    expect([n.createdAt, n.updatedAt, n.type, n.description, n.cover]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
    expect(n.loaded).toBe(false)
    expect(n.watcherInitialized).toBe(true)
    await n.load()
    expect(n.description).toBe('Summary')
  })

  it('loads a footer from metadata without the note filename fallback', async () => {
    const f = footer()
    await f.load()
    expect(f.id).toBe('sample-footer')
    expect(f.createdAt).toBeNull()
    expect(f.loaded).toBe(true)
    app.setFrontmatter(PATH, { created: '2028-02-29', type: 'project' })
    await f.load(true)
    expect(f.createdAt?.format('YYYY-MM-DD')).toBe('2028-02-29')
    expect(f.type).toBe('project')
    f.cleanFooterData()
    expect([f.createdAt, f.type, f.loaded]).toEqual([null, null, false])
    expect(f.watcherInitialized).toBe(true)
  })

  it('constructs footer relations before loading metadata and cleans them with the footer', async () => {
    const child = await app.vault.create('Notes/Child.md', '')
    app.setFrontmatter(child.path, {})
    app.metadataCache.resolvedLinks[child.path] = { [PATH]: 1 }
    const f = footer()
    expect(f.loaded).toBe(false)
    expect([...f.noteRelations.notes.keys()]).toEqual([child.path])
    const cleanup = vi.spyOn(f.noteRelations, 'cleanup')
    await f.load()
    f.cleanup()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(f.noteRelations.notes.size).toBe(0)
    expect(f.watcherInitialized).toBe(false)
  })

  for (const kind of ['note', 'footer'] as const) {
    it(`${kind}: caches normal loads, forces refresh and installs only one watcher`, async () => {
      const entity = kind === 'note' ? note() : footer()
      const register = vi.spyOn(VaultWatcherWrapper.getInstance(), 'registerCallback')
      await entity.load()
      app.setFrontmatter(PATH, { type: 'project', created: '2028-03-01' })
      app.resetStats()
      await entity.load()
      expect(entity.type).toBeNull()
      expect(app.stats.getFileCache).toBe(0)
      await entity.load(true)
      entity.initWatcher()
      expect(entity.type).toBe('project')
      expect(register).toHaveBeenCalledTimes(1)
    })

    it(`${kind}: follows modify and rename events and does not reload after cleanup`, async () => {
      const entity = kind === 'note' ? note() : footer()
      await entity.load()
      const file = app.vault.getFileByPath(PATH)!
      app.setFrontmatter(PATH, { type: 'project' })
      app.emit('vault', 'modify', file)
      expect(entity.type).toBe('project')
      await app.fileManager.renameFile(file, 'Archive/Renamed.md')
      app.emit('vault', 'rename', file, PATH)
      expect(entity.filePath).toBe('Archive/Renamed.md')
      app.setFrontmatter(file.path, { type: 'book' })
      app.emit('vault', 'modify', file)
      expect(entity.type).toBe('book')
      entity.cleanup()
      entity.cleanup()
      app.resetStats()
      await entity.load(true)
      app.emit('vault', 'modify', file)
      expect(entity.loaded).toBe(false)
      expect(entity.watcherInitialized).toBe(false)
      expect(entity.type).toBeNull()
      expect(app.stats.getFileCache).toBe(0)
    })

    it(`${kind}: currently retains old metadata when the cache has no frontmatter`, async () => {
      app.setFrontmatter(PATH, { created: '2028-02-29', type: 'project' })
      const entity = kind === 'note' ? note() : footer()
      await entity.load()
      // Characterization: an absent cache may be temporary. No product decision here about
      // whether removing the YAML block should clear the fields or wait for metadata.
      vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue({
        links: [],
        frontmatterLinks: [],
      })
      await entity.load(true)
      expect(entity.type).toBe('project')
      expect(entity.createdAt?.format('YYYY-MM-DD')).toBe('2028-02-29')
      if (entity instanceof Note) expect(entity.noteNotFound).toBe(true)
    })
  }
})
