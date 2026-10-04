import { afterEach, describe, expect, it, vi } from 'vitest'
import { TasksList } from '@/entities/TasksList'
import { TimeEntryList } from '@/entities/TimeEntryList'
import { TransactionsList } from '@/entities/TransactionsList'
import { AccountsList } from '@/entities/AccountsList'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { useVault, configureAbele } from '../helpers/testEnv'

let list: { cleanup(): void } | undefined
afterEach(() => {
  list?.cleanup()
  list = undefined
  VaultWatcherWrapper.destroy()
  vi.useRealTimers()
})

const cases = [
  {
    type: 'task',
    make: () => new TasksList(),
    map: (l: TasksList) => l.tasks,
    fm: (n: number) => ({ type: 'task', priority: ['low', 'medium', 'high'][n - 1] }),
    read: (e: any) => e.priority,
    values: ['low', 'medium', 'high'],
  },
  {
    type: 'time-entry',
    make: () => new TimeEntryList(),
    map: (l: TimeEntryList) => l.entries,
    fm: (n: number) => ({
      type: 'time-entry',
      start: '2024-01-01 08:00:00',
      end: `2024-01-01 ${String(8 + n).padStart(2, '0')}:00:00`,
    }),
    read: (e: any) => e.duration,
    values: [3600, 7200, 10800],
  },
  {
    type: 'transaction',
    make: () => new TransactionsList(),
    map: (l: TransactionsList) => l.transactions,
    fm: (n: number) => ({ type: 'transaction', amount: n, currency: 'XTS', date: '2024-01-01' }),
    read: (e: any) => e.amount,
    values: [1, 2, 3],
  },
  {
    type: 'account',
    make: () => new AccountsList(),
    map: (l: AccountsList) => l.accounts,
    fm: (n: number) => ({
      type: 'account',
      accountType: 'asset',
      currency: 'XTS',
      startingBalance: n,
    }),
    read: (e: any) => e.startingBalance,
    values: [1, 2, 3],
  },
] as const

describe.each(cases)('$type identity replacement in one metadata batch', (sample) => {
  it('replaces the dead entity and observes a subsequent edit of the replacement', async () => {
    vi.useFakeTimers()
    const path = `Samples/${sample.type}.md`
    const app = useVault([{ path, frontmatter: sample.fm(1), content: 'Sample entry' }])
    const config = configureAbele()
    config.applySettings(undefined)
    config.refreshDelay = 10
    list = sample.make()
    const map = sample.map(list as never)
    app.emit('metadataCache', 'resolved')
    const original = map.get(path)!
    expect(sample.read(original)).toBe(sample.values[0])
    const oldFile = app.vault.getFileByPath(path)!
    await app.vault.delete(oldFile)
    app.emit('vault', 'delete', oldFile)
    const replacement = await app.vault.create(path, 'Sample replacement')
    app.setFrontmatter(path, sample.fm(2))
    app.emit('vault', 'create', replacement)
    app.emit('metadataCache', 'changed', replacement)
    app.emit('metadataCache', 'resolved')
    const entity = map.get(path)!
    expect(entity).not.toBe(original)
    expect(sample.read(entity)).toBe(sample.values[1])
    app.setFrontmatter(path, sample.fm(3))
    app.emit('vault', 'modify', replacement)
    app.emit('metadataCache', 'changed', replacement)
    app.emit('metadataCache', 'resolved')
    await vi.advanceTimersByTimeAsync(20)
    expect(map.get(path)).toBe(entity)
    expect(sample.read(entity)).toBe(sample.values[2])
  })
})
