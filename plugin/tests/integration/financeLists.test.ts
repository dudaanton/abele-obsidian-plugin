import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountsList } from '@/entities/AccountsList'
import { TransactionsList } from '@/entities/TransactionsList'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

// The fake vault has real file moves and cache updates, but emits events explicitly.
// Its offref is a no-op: verify removal requests, not dispatch after unregistering.
describe.each(['account', 'transaction'] as const)('%s list metadata lifecycle', (type) => {
  let app: FakeApp
  let list: AccountsList | TransactionsList
  const tracked = () => (list instanceof AccountsList ? list.accounts : list.transactions)
  const fm = () => ({ type, accountType: 'asset', amount: 5, date: '2024-03-01', currency: 'EUR' })
  const file = (path = 'Finance/One.md') => app.vault.getFileByPath(path)!
  const resolve = () => app.emit('metadataCache', 'resolved')
  beforeEach(() => {
    app = useVault([
      { path: 'Finance/One.md', frontmatter: fm() },
      { path: 'Late.md' },
      { path: 'Plain.md', frontmatter: { type: 'note' } },
      { path: 'Upper.md', frontmatter: { type: type.toUpperCase() } },
      { path: 'Array.md', frontmatter: { type: [type] } },
      { path: 'Not markdown.txt', frontmatter: fm() },
    ])
    list = type === 'account' ? new AccountsList() : new TransactionsList()
  })
  afterEach(() => {
    list.cleanup()
    VaultWatcherWrapper.destroy()
    vi.restoreAllMocks()
  })

  it('scans only markdown with an exact type; first resolution finds late metadata once', () => {
    expect([...tracked().keys()]).toEqual(['Finance/One.md'])
    expect(tracked().get('Finance/One.md')?.loaded).toBe(true)
    app.setFrontmatter('Late.md', fm())
    resolve()
    expect([...tracked().keys()]).toEqual(['Finance/One.md', 'Late.md'])
    const scans = app.stats.getMarkdownFiles
    resolve()
    expect(app.stats.getMarkdownFiles).toBe(scans)
  })

  it('defers additions to resolved, deduplicates repeated changes and ignores folders/deleted files', async () => {
    resolve()
    const original = tracked().get('Finance/One.md')
    const late = file('Late.md')
    app.setFrontmatter('Late.md', fm())
    for (let i = 0; i < 3; i++) {
      app.emit('metadataCache', 'changed', late)
      app.emit('metadataCache', 'changed', file())
    }
    app.emit('metadataCache', 'changed', app.vault.getAbstractFileByPath('Finance'))
    const gone = file('Plain.md')
    app.setFrontmatter('Plain.md', fm())
    app.emit('metadataCache', 'changed', gone)
    await GlobalStore.getInstance().app.vault.delete(gone)
    expect(tracked().size).toBe(1)
    resolve()
    expect(tracked().size).toBe(2)
    expect(tracked().get('Finance/One.md')).toBe(original)
    expect(tracked().has('Plain.md')).toBe(false)
  })

  it('moves a tracked entry on resolve, cleans the old entity and ignores untracked renames', async () => {
    resolve()
    const original = tracked().get('Finance/One.md')!
    const moved = file()
    await GlobalStore.getInstance().app.fileManager.renameFile(moved, 'Archive/Two.md')
    app.emit('vault', 'rename', moved, 'Finance/One.md')
    expect(tracked().has('Finance/One.md')).toBe(true)
    resolve()
    expect([...tracked().keys()]).toEqual(['Archive/Two.md'])
    expect(tracked().get('Archive/Two.md')).not.toBe(original)
    expect(original.loaded).toBe(false)
    expect(tracked().get('Archive/Two.md')?.loaded).toBe(true)
    const plain = file('Plain.md')
    await GlobalStore.getInstance().app.fileManager.renameFile(plain, 'Archive/Plain.md')
    app.emit('vault', 'rename', plain, 'Plain.md')
    app.emit('vault', 'rename', app.vault.getAbstractFileByPath('Finance'), 'Old folder')
    resolve()
    expect(tracked().size).toBe(1)
  })

  it('defers deletion, cleans removed entities, and ignores repeated/untracked deletes', async () => {
    resolve()
    const removed = file()
    const original = tracked().get(removed.path)!
    await GlobalStore.getInstance().app.vault.delete(removed)
    app.emit('vault', 'delete', removed)
    expect(tracked().size).toBe(1)
    resolve()
    expect(tracked().size).toBe(0)
    expect(original.loaded).toBe(false)
    app.emit('vault', 'delete', removed)
    app.emit('vault', 'delete', app.vault.getAbstractFileByPath('Finance'))
    resolve()
    expect(tracked().size).toBe(0)
  })

  it('cleans all entries and unregisters the four list handlers exactly once', () => {
    const off = vi.spyOn(app.metadataCache, 'offref')
    const original = tracked().get('Finance/One.md')!
    list.cleanup()
    expect(tracked().size).toBe(0)
    expect(original.loaded).toBe(false)
    expect(off).toHaveBeenCalledTimes(4)
    list.cleanup()
    expect(off).toHaveBeenCalledTimes(4)
  })

  it('removes a note that is no longer a financial entity after its type is edited', () => {
    resolve()
    app.setFrontmatter('Finance/One.md', { type: 'note' })
    app.emit('metadataCache', 'changed', file())
    resolve()
    expect(tracked().size).toBe(0)
  })

  // BUG: the FileWatcher updates the entity path immediately on rename, but the
  // list map is re-keyed only at resolved. cleanup removes by the new path and
  // leaves the old map entry and its live watcher behind if closed in between.
  it.fails('empties the list when cleaned up between rename and metadata resolution', async () => {
    resolve()
    const moved = file()
    await GlobalStore.getInstance().app.fileManager.renameFile(moved, 'Archive/Two.md')
    app.emit('vault', 'rename', moved, 'Finance/One.md')
    list.cleanup()
    expect(tracked().size).toBe(0)
  })
})

describe('AccountsList.getAccountByWikilink', () => {
  it('resolves aliases and unique basenames but not missing links or non-accounts', () => {
    useVault([
      { path: 'Finance/Wallet.md', frontmatter: { type: 'account', accountType: 'asset' } },
      { path: 'Plain.md' },
    ])
    const list = new AccountsList()
    try {
      const expected = list.accounts.get('Finance/Wallet.md')
      expect(list.getAccountByWikilink('[[Wallet|Card]]')).toBe(expected)
      expect(list.getAccountByWikilink('[[Finance/Wallet]]')).toBe(expected)
      expect(list.getAccountByWikilink('[[Missing]]')).toBeNull()
      expect(list.getAccountByWikilink('[[Plain]]')).toBeNull()
    } finally {
      list.cleanup()
      VaultWatcherWrapper.destroy()
    }
  })
})
