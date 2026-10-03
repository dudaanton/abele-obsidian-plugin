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
