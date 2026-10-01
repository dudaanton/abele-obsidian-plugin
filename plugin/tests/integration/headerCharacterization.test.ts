import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { Header } from '@/entities/Header'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { configureAbele, dailyJournal } from '../helpers/testEnv'
import { templateHarness } from '../helpers/templateHarness'

const headers: Header[] = []
const make = (path = 'Notes/sample.md') => {
  const header = reactive(new Header({ id: 'sample-header', filePath: path })) as Header
  headers.push(header)
  return header
}
beforeEach(() => {
  configureAbele({ journals: [dailyJournal()] })
  vi.stubEnv('TZ', 'America/Los_Angeles')
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  headers.splice(0).forEach((h) => h.cleanup())
  VaultWatcherWrapper.destroy()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Header cache lifecycle', () => {
  it('normalizes paths, reads the cache rather than unsaved editor data, and reloads only when forced', async () => {
    const env = templateHarness([
      { path: 'Notes/sample.md', frontmatter: { created: '2028-02-29', type: 'sample' } },
    ])
    const header = make(' /Notes/sample/ ')
    expect(header.filePath).toBe('Notes/sample.md')
    env.workspace.getLeavesOfType.mockReturnValue([
      {
        view: {
          file: env.app.vault.getFileByPath('Notes/sample.md'),
          editor: { getValue: () => '---\ntype: unsaved\n---' },
        },
      },
    ] as never)
    await header.load()
    expect(header.loaded).toBe(true)
    expect(header.watcherInitialized).toBe(true)
    expect(header.createdAt?.format('YYYY-MM-DD')).toBe('2028-02-29')
    expect(header.type).toBe('sample')
    env.app.setFrontmatter('Notes/sample.md', { type: 'new', created: '2028-03-01' })
    await header.load()
    expect(header.type).toBe('sample')
    await header.load(true)
    expect(header.type).toBe('new')
    expect(header.createdAt?.format('YYYY-MM-DD')).toBe('2028-03-01')
    env.app.setFrontmatter('Notes/sample.md', {})
    await header.load(true)
    expect(header.createdAt).toBeNull()
    expect(header.type).toBeNull()
  })

  it('loads a missing file as an empty header and clears fields without stopping watchers', async () => {
    templateHarness()
    const header = make()
    await header.load()
    expect(header.loaded).toBe(true)
    expect(header.createdAt).toBeNull()
    expect(header.journal).toBeUndefined()
    header.cleanHeaderData()
    expect(header.loaded).toBe(false)
    expect(header.watcherInitialized).toBe(true)
  })

  it('rekeys file watching after a move and follows metadata at the new path', async () => {
    const env = templateHarness([{ path: 'Notes/sample.md', frontmatter: { type: 'old' } }])
    const file = env.app.vault.getFileByPath('Notes/sample.md')!
    const header = make()
    await header.load()
    await env.app.fileManager.renameFile(file, 'Other/renamed.md')
    env.app.emit('vault', 'rename', file, 'Notes/sample.md')
    expect(header.filePath).toBe('Other/renamed.md')
    env.app.setFrontmatter(file.path, { type: 'new' })
    env.app.emit('vault', 'modify', file)
    expect(header.type).toBe('new')
    env.app.emit('vault', 'modify', { path: 'Notes/sample.md' })
    expect(header.filePath).toBe('Other/renamed.md')
  })

  it('picks the first matching journal, retells it on metadata changes, and drops it when no longer matching', async () => {
    const env = templateHarness([
      { path: 'Journals/2028/2028-03-01.md', frontmatter: { type: 'journal' } },
    ])
    configureAbele({ journals: [dailyJournal({ id: 'first' }), dailyJournal({ id: 'second' })] })
    const file = env.app.vault.getFileByPath('Journals/2028/2028-03-01.md')!
    const header = make(file.path)
    await header.load()
    expect(header.journal?.id).toBe('first')
    expect(header.journalDate?.format('YYYY-MM-DD')).toBe('2028-03-01')
    env.app.setFrontmatter(file.path, { type: 'plain' })
    env.app.emit('metadataCache', 'changed', file)
    expect(header.journal).toBeUndefined()
    expect(header.journalDate).toBeUndefined()
    // Metadata notification alone only retells the journal; the vault event reloads type.
    expect(header.type).toBe('journal')
    env.app.emit('vault', 'modify', file)
    expect(header.type).toBe('plain')
  })

  it('initializes subscriptions once and makes cleanup idempotent, ignoring late events and forced loads', async () => {
    const env = templateHarness([{ path: 'Notes/sample.md', frontmatter: { type: 'sample' } }])
    const on = vi.spyOn(env.app.metadataCache, 'on')
    const header = make()
    await header.load()
    header.initWatcher()
    await header.load(true)
    expect(on.mock.calls.map((c) => c[0])).toEqual(['changed', 'resolved'])
    header.cleanup()
    header.cleanup()
    env.app.emit('metadataCache', 'changed', env.app.vault.getFileByPath('Notes/sample.md'))
    env.app.emit('metadataCache', 'resolved')
    await header.load(true)
    expect(header.loaded).toBe(false)
    expect(header.watcherInitialized).toBe(false)
    expect(header.type).toBeNull()
  })

  // BUG: load(true) resets fields only if a frontmatter object exists. Removing the YAML
  // fence leaves the previous type and created date visible in the open header.
  it('clears old properties when all frontmatter is removed', async () => {
    const env = templateHarness([
      { path: 'Notes/sample.md', frontmatter: { type: 'sample', created: '2028-03-01' } },
    ])
    const header = make()
    await header.load()
    vi.spyOn(env.app.metadataCache, 'getFileCache').mockReturnValue({
      links: [],
      frontmatterLinks: [],
    })
    await header.load(true)
    expect(header.type).toBeNull()
    expect(header.createdAt).toBeNull()
  })
})
