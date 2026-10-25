import { expect, it } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { connectionAdapter, vaultDisk } from '@/sync/vaultPathLinks'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'

it.each(['placement', 'scope', 'both'])(
  'forwards proof invalidation through %s without granting paths',
  async (kind) => {
    const app = buildFakeVault([{ path: 'Private/sample.md', content: 'sample' }])
    const raw = new ObsidianFileSystem(app as never)
    const includes = (path: string) => path === 'Shared' || path.startsWith('Shared/')
    let fs = raw as import('@abele/sync-sdk/core').FileSystem
    if (kind !== 'placement')
      fs = scopedFileSystem(
        fs,
        (path) => {
          if (!includes(path)) throw new Error('outside scope')
        },
        includes,
        undefined,
        'Shared'
      )
    if (kind !== 'scope') fs = new LocalFolderPlacement('Shared', 'Shared').fileSystem(fs)
    const stop = fs.watch!(() => {})
    try {
      const revision = () =>
        Reflect.get(fs, Symbol.for('abele.sync.local-scan-revision-v1')).call(fs)
      const before = revision()
      Reflect.get(fs, Symbol.for('abele.sync.invalidate-local-scan-v1')).call(fs)
      expect(revision()).not.toBe(before)
      await expect(fs.read('Private/sample.md')).rejects.toThrow()
      Object.assign(raw, { unrecognizedFunction: () => {} })
      expect(() => Reflect.get(fs, 'unrecognizedFunction')).toThrow()
    } finally {
      stop()
    }
  }
)

it('retires a watched proof on foreground inspection without inventing file changes', () => {
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as never)
  let notifications = 0
  const stop = fs.watch(() => notifications++)
  try {
    const revision = () => Reflect.get(fs, Symbol.for('abele.sync.local-scan-revision-v1')).call(fs)
    const before = revision()
    Reflect.get(fs, Symbol.for('abele.sync.invalidate-local-scan-v1')).call(fs)
    expect(revision()).not.toBe(before)
    expect(notifications).toBe(0)
  } finally {
    stop()
  }
})

it('observes ordinary adapter changes when its own file port is connection-scoped', async () => {
  const app = buildFakeVault([{ path: 'Notes/sample.md', content: 'sample' }])
  const fs = new ObsidianFileSystem(app as never, {
    adapter: connectionAdapter(vaultDisk(app.vault as never), 'Notes', 'Private/sample'),
    fileScope: 'Notes',
  })
  const revision = () => Reflect.get(fs, Symbol.for('abele.sync.local-scan-revision-v1')).call(fs)
  const stop = fs.watch(() => {})
  try {
    let before = revision()
    await app.vault.adapter.mkdir('Notes/Empty')
    expect(revision()).not.toBe(before)
    before = revision()
    await app.vault.adapter.write('Notes/sample.md', 'changed')
    expect(revision()).not.toBe(before)
    before = revision()
    await app.vault.rename(app.vault.getFileByPath('Notes/sample.md')!, 'Notes/renamed.md')
    expect(revision()).not.toBe(before)
    before = revision()
    await app.vault.delete(app.vault.getFileByPath('Notes/renamed.md')!)
    expect(revision()).not.toBe(before)
  } finally {
    stop()
  }
})

it('invalidates a watched scan before debounce and ignores device-local state writes', async () => {
  const app = buildFakeVault([
    { path: 'Notes/sample.md', content: 'sample' },
    { path: '.obsidian/plugins/abele/data.json', content: '{}' },
    { path: '.obsidian/plugins/abele/sync-cache/sample.json', content: '{}' },
  ])
  const fs = new ObsidianFileSystem(app as never)
  const revision = () => Reflect.get(fs, Symbol.for('abele.sync.local-scan-revision-v1')).call(fs)
  expect(revision()).toBeUndefined()
  const stop = fs.watch(() => {})
  try {
    for (const event of ['create', 'modify', 'delete', 'rename']) {
      const before = revision()
      app.emit('vault', event, app.vault.getFileByPath('Notes/sample.md'), 'Notes/previous.md')
      expect(revision()).not.toBe(before)
    }
    let before = revision()
    await app.vault.adapter.write('Notes/new.md', 'new')
    expect(revision()).not.toBe(before)
    before = revision()
    await app.vault.adapter.write('.obsidian/plugins/abele/data.json', '{}')
    expect(revision()).not.toBe(before)
    before = revision()
    await app.vault.adapter.write('.obsidian/plugins/abele/sync-cache/sample.json', '{}')
    expect(revision()).toBe(before)
  } finally {
    stop()
    stop()
  }
  expect(revision()).toBeUndefined()
})
