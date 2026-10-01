process.env.TZ = 'Europe/Berlin'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { TFile } from 'obsidian'
import { NoteRelations } from '@/entities/NoteRelations'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { configureAbele, dailyJournal, useVault } from '../helpers/testEnv'

const ROOT = 'Groups/Garden.md'
const BRANCH = 'Groups/Seedlings.md'
const LEAF = 'Entries/Sample.md'
const kinds = [
  ['task', 'tasks'],
  ['transaction', 'transactions'],
  ['time-entry', 'timeEntries'],
  ['log', 'logs'],
  ['note', 'notes'],
] as const

/** Drive both cache surfaces: setFrontmatter deliberately does not rebuild resolvedLinks. */
describe('NoteRelations — group edits and lifecycle', () => {
  let app: ReturnType<typeof useVault>
  const opened: NoteRelations[] = []
  const open = (path = ROOT) => {
    const relations = new NoteRelations(path)
    opened.push(relations)
    return relations
  }
  const file = (path: string) => {
    const found = app.vault.getAbstractFileByPath(path)
    if (!(found instanceof TFile)) throw new Error(`Missing fixture: ${path}`)
    return found
  }
  const changed = (path: string) => app.emit('metadataCache', 'changed', file(path))
  const resolve = async () => {
    // Backlinks are memoized for one synchronous burst, just as in the perf tests.
    await Promise.resolve()
    app.emit('metadataCache', 'resolved')
  }
  const paths = (r: NoteRelations) => kinds.flatMap(([, key]) => [...r[key].keys()]).sort()

  beforeEach(async () => {
    await Promise.resolve()
    configureAbele()
    app = useVault([
      { path: ROOT },
      { path: BRANCH, frontmatter: { groups: ['[[Groups/Garden]]'] } },
      { path: LEAF, frontmatter: { type: 'note', groups: ['[[Groups/Seedlings]]'] } },
    ])
  })
  afterEach(() => {
    opened.splice(0).forEach((r) => r.cleanup())
    VaultWatcherWrapper.destroy()
    vi.restoreAllMocks()
  })

  it.each(kinds)(
    'keeps a %s through repeated notifications and removes it when unlinked',
    async (type, key) => {
      app.setFrontmatter(LEAF, { type, groups: ['[[Groups/Seedlings]]'] })
      const r = open()
      const entry = r[key].get(LEAF)!
      const cleanup = vi.spyOn(entry, 'cleanup')
      changed(LEAF)
      changed(LEAF)
      await resolve()
      expect(r[key].get(LEAF)).toBe(entry)
      expect(cleanup).not.toHaveBeenCalled()

      app.setFrontmatter(LEAF, { type })
      app.metadataCache.resolvedLinks[LEAF] = {}
      changed(LEAF)
      // Changes are queued, not applied against a half-resolved cache.
      expect(r[key].has(LEAF)).toBe(true)
      await resolve()
      expect(r[key].has(LEAF)).toBe(false)
      expect(cleanup).toHaveBeenCalledTimes(1)
      expect(paths(r)).toEqual(paths(open()))
    }
  )

  it.each(kinds)('moves and deletes a %s without retaining the old entity', async (type, key) => {
    app.setFrontmatter(LEAF, { type, groups: ['[[Groups/Seedlings]]'] })
    const r = open()
    const cleanup = vi.spyOn(r[key].get(LEAF)!, 'cleanup')
    const moved = 'Archive/Renamed.md'
    const leaf = file(LEAF)
    await app.fileManager.renameFile(leaf, moved)
    app.emit('vault', 'rename', leaf, LEAF)
    await resolve()
    expect([...r[key].keys()].sort()).toEqual(key === 'notes' ? [moved, BRANCH] : [moved])
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(paths(r)).toEqual(paths(open()))

    await app.vault.delete(leaf)
    delete app.metadataCache.resolvedLinks[moved]
    app.emit('vault', 'delete', leaf)
    await resolve()
    expect([...r[key].keys()]).toEqual(key === 'notes' ? [BRANCH] : [])
    expect(paths(r)).toEqual(paths(open()))
  })

  it('walks a newly grouped branch, but not a body mention, and revisits it on later passes', async () => {
    app.setFrontmatter(BRANCH, {}) // Its existing link is now only a body mention.
    const r = open()
    expect(paths(r)).toEqual([BRANCH])
    await resolve()

    app.setFrontmatter(BRANCH, { groups: ['plain', null, '[[Missing]]', '[[Groups/Garden|Beds]]'] })
    changed(BRANCH)
    await resolve()
    expect(paths(r)).toEqual([LEAF, BRANCH].sort())

    app.setFrontmatter(BRANCH, {})
    changed(BRANCH)
    await resolve()
    expect(paths(r)).toEqual([BRANCH])

    app.setFrontmatter(BRANCH, { groups: ['[[Groups/Garden]]'] })
    changed(BRANCH)
    await resolve()
    expect(paths(r)).toEqual(paths(open()))
    expect(paths(r)).toContain(LEAF)
  })

  it('prunes a deleted group subtree but retains a member with a second route', async () => {
    const orphan = await app.vault.create('Entries/Branch only.md', '')
    app.setFrontmatter(orphan.path, { groups: ['[[Groups/Seedlings]]'] })
    app.metadataCache.resolvedLinks[orphan.path] = { [BRANCH]: 1 }
    app.metadataCache.resolvedLinks[LEAF][ROOT] = 1
    const r = open()
    expect(paths(r)).toContain(orphan.path)
    const branch = file(BRANCH)
    await app.vault.delete(branch)
    delete app.metadataCache.resolvedLinks[BRANCH]
    delete app.metadataCache.resolvedLinks[LEAF][BRANCH]
    app.emit('vault', 'delete', branch)
    await resolve()
    expect(paths(r)).toEqual([LEAF])
    expect(paths(r)).toEqual(paths(open()))
  })

  it('ignores zero-count, missing and folder backlinks, and never follows outgoing links', () => {
    app.metadataCache.resolvedLinks[LEAF] = { [ROOT]: 0 }
    app.metadataCache.resolvedLinks['Ghost.md'] = { [ROOT]: 1 }
    app.metadataCache.resolvedLinks['Entries'] = { [ROOT]: 1 }
    app.metadataCache.resolvedLinks[ROOT] = { [LEAF]: 1, [ROOT]: 1 }
    const r = open()
    expect(paths(r)).toEqual([BRANCH])
  })

  it('removeRelations cleans entries once and a later explicit walk can refill it', () => {
    const r = open()
    const cleanup = vi.spyOn(r.notes.get(LEAF)!, 'cleanup')
    r.removeRelations()
    expect(paths(r)).toEqual([])
    expect(cleanup).toHaveBeenCalledTimes(1)
    r.removeRelations()
    expect(cleanup).toHaveBeenCalledTimes(1)
    r.findRelations(ROOT)
    expect(paths(r)).toEqual([LEAF, BRANCH].sort())
  })

  it('unregisters original event refs even when cleanup is reached through a reactive footer', () => {
    // Empty relations isolate the four NoteRelations subscriptions from child FileWatchers.
    app.metadataCache.resolvedLinks[BRANCH] = {}
    const onVault = vi.spyOn(app.vault, 'on')
    const onMetadata = vi.spyOn(app.metadataCache, 'on')
    const offVault = vi.spyOn(app.vault, 'offref')
    const offMetadata = vi.spyOn(app.metadataCache, 'offref')
    const r = open()
    const refs = [...onVault.mock.results, ...onMetadata.mock.results].map((r) => r.value)
    expect(refs).toHaveLength(4)
    reactive(r).cleanup()
    reactive(r).cleanup()
    expect(offVault.mock.calls.map(([ref]) => ref)).toEqual(expect.arrayContaining(refs))
    expect(offMetadata.mock.calls.map(([ref]) => ref)).toEqual(expect.arrayContaining(refs))
    for (const ref of refs) {
      expect(offVault.mock.calls.filter(([seen]) => seen === ref)).toHaveLength(1)
      expect(offMetadata.mock.calls.filter(([seen]) => seen === ref)).toHaveLength(1)
    }
  })

  it('deleting the tracked note stops the remaining queued changes from adding relations', async () => {
    const r = open()
    await resolve()
    const root = file(ROOT)
    await app.vault.delete(root)
    app.emit('vault', 'delete', root)
    changed(LEAF)
    await resolve()
    expect(paths(r)).toEqual([])
  })

  it.each(kinds)(
    'sweeps a %s by due, date, then created across a leap-month boundary',
    async (type, key) => {
      const day = 'Journals/2028/2028-03-01.md'
      app = useVault([
        { path: day, frontmatter: { type: 'journal' } },
        {
          path: 'Entries/Chosen.md',
          frontmatter: { type, due: '2028-03-01', date: '2028-02-29', created: '2028-02-29' },
        },
        { path: 'Entries/Null.md', frontmatter: { type, due: null, date: '2028-03-01' } },
        { path: 'Entries/Created.md', frontmatter: { type, created: '2028-03-01' } },
        { path: 'Entries/Empty.md', frontmatter: { type, due: '', date: '2028-03-01' } },
        { path: 'Entries/Invalid.md', frontmatter: { type, due: 'invalid', date: '2028-03-01' } },
        {
          path: 'Entries/Leap.md',
          frontmatter: { type, due: '2028-02-29', created: '2028-03-01' },
        },
        {
          path: 'Entries/Future.md',
          frontmatter: { type, date: '2028-03-02', created: '2028-03-01' },
        },
        { path: 'Entries/Undated.md', frontmatter: { type } },
      ])
      configureAbele({ journals: [dailyJournal()] })
      const r = open(day)
      expect([...r[key].keys()].sort()).toEqual([
        'Entries/Chosen.md',
        'Entries/Created.md',
        'Entries/Null.md',
      ])
      for (const entry of app.vault.getMarkdownFiles()) changed(entry.path)
      await resolve()
      expect(paths(r)).toEqual(paths(open(day)))
    }
  )

  it('keeps a completed dated task in the footer when its checkbox changes', async () => {
    const day = 'Journals/2028/2028-03-01.md'
    app = useVault([
      { path: day, frontmatter: { type: 'journal' } },
      { path: LEAF, frontmatter: { type: 'task', date: '2028-03-01' } },
    ])
    configureAbele({ journals: [dailyJournal()] })
    const r = open(day)
    await resolve()
    app.setFrontmatter(LEAF, { type: 'task', date: '2028-03-01', completed: '2028-03-01T10:00:00' })
    changed(LEAF)
    await resolve()
    expect([...r.tasks.keys()]).toEqual([LEAF])
  })

  // Resolve group links from their member so duplicate basenames retain descendants.
  it('expands the locally resolved group when its basename is shared by another folder', () => {
    app = useVault([
      { path: 'East/Trees.md' },
      { path: 'West/Trees.md' },
      { path: 'East/Branch.md', frontmatter: { groups: ['[[Trees]]'] } },
      { path: LEAF, frontmatter: { type: 'task', groups: ['[[East/Branch]]'] } },
    ])
    // The fixture's initial backlink builder uses no source path. Model the resolved
    // result explicitly; getFirstLinkpathDest itself supports the nearby-note rule.
    app.metadataCache.resolvedLinks['East/Branch.md'] = { 'East/Trees.md': 1 }
    expect(app.metadataCache.getFirstLinkpathDest('Trees.md', 'East/Branch.md')?.path).toBe(
      'East/Trees.md'
    )
    const r = open('East/Trees.md')
    expect([...r.notes.keys()]).toEqual(['East/Branch.md'])
    expect([...r.tasks.keys()]).toEqual([LEAF])
  })

  it('retains locally grouped descendants through metadata changes and pruning', async () => {
    app = useVault([
      { path: 'East/Trees.md' },
      { path: 'West/Trees.md' },
      { path: 'East/Branch.md', frontmatter: { groups: ['[[Trees]]'] } },
      { path: LEAF, frontmatter: { type: 'task', groups: ['[[East/Branch]]'] } },
    ])
    app.metadataCache.resolvedLinks['East/Branch.md'] = { 'East/Trees.md': 1 }
    const r = open('East/Trees.md')
    await resolve()
    changed(LEAF)
    changed('East/Branch.md')
    await resolve()
    expect([...r.tasks.keys()]).toEqual([LEAF])
    expect(paths(r)).toEqual(paths(open('East/Trees.md')))
  })

  // A related note changing kind must move sections without reopening the footer.
  it('reclassifies a related note after its type changes', async () => {
    const r = open()
    await resolve()
    app.setFrontmatter(LEAF, { type: 'task', groups: ['[[Groups/Seedlings]]'] })
    changed(LEAF)
    await resolve()
    expect([...r.tasks.keys()]).toEqual([...open().tasks.keys()])
    expect(r.notes.has(LEAF)).toBe(false)
  })

  it.each(kinds)('reclassifies every kind of relation starting from %s', async (type, key) => {
    app.setFrontmatter(LEAF, { type, groups: ['[[Groups/Seedlings]]'] })
    const r = open()
    await resolve()
    let previous = r[key].get(LEAF)!
    for (const [nextType, nextKey] of kinds.filter(([kind]) => kind !== type)) {
      const cleanup = vi.spyOn(previous, 'cleanup')
      app.setFrontmatter(LEAF, { type: nextType, groups: ['[[Groups/Seedlings]]'] })
      changed(LEAF)
      await resolve()
      expect(cleanup).toHaveBeenCalledTimes(1)
      expect(kinds.filter(([, section]) => r[section].has(LEAF))).toEqual([[nextType, nextKey]])
      previous = r[nextKey].get(LEAF)!
      const retained = vi.spyOn(previous, 'cleanup')
      changed(LEAF)
      await resolve()
      expect(r[nextKey].get(LEAF)).toBe(previous)
      expect(retained).not.toHaveBeenCalled()
    }
  })

  // A rename within one journal must replace the old day's dated entries.
  it('rebuilds the dated relations when the tracked daily note is renamed to another day', async () => {
    app = useVault([
      { path: 'Journals/2028/2028-02-29.md', frontmatter: { type: 'journal' } },
      { path: 'Entries/Leap.md', frontmatter: { date: '2028-02-29' } },
      { path: 'Entries/March.md', frontmatter: { date: '2028-03-01' } },
    ])
    configureAbele({ journals: [dailyJournal()] })
    const old = 'Journals/2028/2028-02-29.md'
    const next = 'Journals/2028/2028-03-01.md'
    const r = open(old)
    await resolve()
    const root = file(old)
    await app.fileManager.renameFile(root, next)
    app.emit('vault', 'rename', root, old)
    await resolve()
    expect(r.filePath).toBe(next)
    expect(r.journalDate?.format('YYYY-MM-DD')).toBe('2028-03-01')
    expect(paths(r)).toEqual(paths(open(next)))
  })
})
