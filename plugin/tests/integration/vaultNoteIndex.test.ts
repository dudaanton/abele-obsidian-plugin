import { afterEach, describe, expect, it, vi } from 'vitest'
import { TasksList } from '@/entities/TasksList'
import { TimeEntryList } from '@/entities/TimeEntryList'
import { TransactionsList } from '@/entities/TransactionsList'
import { AccountsList } from '@/entities/AccountsList'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault, configureAbele } from '../helpers/testEnv'

const owned: { cleanup(): void }[] = []
afterEach(() => {
  for (const list of owned.splice(0)) list.cleanup()
  VaultWatcherWrapper.destroy()
  vi.restoreAllMocks()
})

describe('shared vault type and day index', () => {
  it('enumerates once for all four lists, then coalesces repeated metadata changes', async () => {
    const app = useVault(
      Array.from({ length: 100 }, (_, i) => ({
        path: `Samples/note-${i}.md`,
        frontmatter: {
          type: ['task', 'time-entry', 'transaction', 'account'][i % 4],
          date: '2024-01-01',
          start: '2024-01-01T09:00',
          amount: 1,
        },
      }))
    )
    configureAbele().applySettings(undefined)
    const before = app.stats.getMarkdownFiles
    const lists = [new TasksList(), new TimeEntryList(), new TransactionsList(), new AccountsList()]
    owned.push(...lists)
    expect(app.stats.getMarkdownFiles - before).toBe(1)
    app.emit('metadataCache', 'resolved')
    expect(app.stats.getMarkdownFiles - before).toBe(1)
    const { acquireVaultNoteIndex } = await import('@/entities/vaultNoteIndex')
    const lease = acquireVaultNoteIndex(GlobalStore.getInstance().app)
    const reads = vi.spyOn(app.metadataCache, 'getFileCache')
    const file = app.vault.getFileByPath('Samples/note-0.md')!
    reads.mockClear()
    for (let i = 0; i < 100; i++) app.emit('metadataCache', 'changed', file)
    app.emit('metadataCache', 'resolved')
    expect(reads.mock.calls.filter(([f]) => f.path === file.path).length).toBeLessThan(10)
    expect([...lease.index.pathsOnDay('2024-01-01')]).toHaveLength(100)
    lease.release()
  })

  it('isolates a failed metadata read and retries it without losing another type change', () => {
    const app = useVault([
      { path: 'Samples/first.md', frontmatter: { type: 'task' } },
      { path: 'Samples/second.md' },
    ])
    configureAbele().applySettings(undefined)
    const list = new TasksList()
    owned.push(list)
    app.emit('metadataCache', 'resolved')
    const first = app.vault.getFileByPath('Samples/first.md')!,
      second = app.vault.getFileByPath('Samples/second.md')!
    app.setFrontmatter(first.path, { type: 'note' })
    app.setFrontmatter(second.path, { type: 'task' })
    const read = app.metadataCache.getFileCache.bind(app.metadataCache)
    let fail = true
    vi.spyOn(app.metadataCache, 'getFileCache').mockImplementation((file) => {
      if (file === second && fail) {
        fail = false
        throw new Error('Sample delayed metadata failure')
      }
      return read(file)
    })
    app.emit('metadataCache', 'changed', first)
    app.emit('metadataCache', 'changed', second)
    expect(() => app.emit('metadataCache', 'resolved')).not.toThrow()
    expect(list.tasks.has(first.path)).toBe(false)
    app.emit('metadataCache', 'resolved')
    expect([...list.tasks.keys()]).toEqual([second.path])
  })

  it('handles folder-only rename/delete notifications without leaving old paths in any list', async () => {
    const app = useVault(
      ['task', 'time-entry', 'transaction', 'account'].map((type) => ({
        path: `Samples/nested/${type}.md`,
        frontmatter: { type, date: '2024-01-01' },
      }))
    )
    configureAbele().applySettings(undefined)
    const taskList = new TasksList(),
      timeList = new TimeEntryList(),
      txList = new TransactionsList(),
      accountList = new AccountsList()
    owned.push(taskList, timeList, txList, accountList)
    app.emit('metadataCache', 'resolved')
    const folder = app.vault.getAbstractFileByPath('Samples')!
    await app.vault.rename(folder, 'Renamed samples')
    app.emit('vault', 'rename', folder, 'Samples')
    app.emit('metadataCache', 'resolved')
    for (const map of [
      taskList.tasks,
      timeList.entries,
      txList.transactions,
      accountList.accounts,
    ]) {
      expect([...map.keys()]).toHaveLength(1)
      expect([...map.keys()][0]).toMatch(/^Renamed samples\/nested\//)
    }
    await app.vault.delete(folder)
    app.emit('vault', 'delete', folder)
    app.emit('metadataCache', 'resolved')
    for (const map of [taskList.tasks, timeList.entries, txList.transactions, accountList.accounts])
      expect(map.size).toBe(0)
  })

  it('updates type/day changes, late metadata, rename and delete only after resolution', async () => {
    const app = useVault([{ path: 'Samples/late.md' }])
    const { acquireVaultNoteIndex } = await import('@/entities/vaultNoteIndex')
    const lease = acquireVaultNoteIndex(GlobalStore.getInstance().app)
    const list = new TasksList()
    owned.push(list)
    const file = app.vault.getFileByPath('Samples/late.md')!
    app.setFrontmatter(file.path, { type: 'task', date: '2024-01-02' })
    app.emit('metadataCache', 'resolved')
    expect([...lease.index.pathsOfType('task')]).toEqual([file.path])
    app.setFrontmatter(file.path, { type: 'note', due: '2024-01-03', date: '2024-01-02' })
    app.emit('metadataCache', 'changed', file)
    expect(list.tasks.size).toBe(1)
    app.emit('metadataCache', 'resolved')
    expect(list.tasks.size).toBe(0)
    expect([...lease.index.pathsOnDay('2024-01-02')]).toEqual([])
    expect([...lease.index.pathsOnDay('2024-01-03')]).toEqual([file.path])
    await app.vault.rename(file, 'Samples/renamed.md')
    app.emit('vault', 'rename', file, 'Samples/late.md')
    app.emit('metadataCache', 'resolved')
    expect([...lease.index.pathsOnDay('2024-01-03')]).toEqual([file.path])
    await app.vault.delete(file)
    app.emit('vault', 'delete', file)
    app.emit('metadataCache', 'resolved')
    expect([...lease.index.pathsOnDay('2024-01-03')]).toEqual([])
    lease.release()
  })
})
