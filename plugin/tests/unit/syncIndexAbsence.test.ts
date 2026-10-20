import { expect, it, vi } from 'vitest'
import type { TFolder } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { ExpectedWrites, MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { PullPlacer } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pullPlace.js'

const absent = Symbol.for('abele.sync.index-absent-v1')
const pass = Symbol.for('abele.sync.inventory-pass-v1')

it('reads a populated folder index once per pass for many incoming paths', async () => {
  const app = buildFakeVault(
    Array.from({ length: 3000 }, (_, i) => ({
      path: `notes/sample-${i}.md`,
      content: 'sample',
    }))
  )
  const fs = new ObsidianFileSystem(app as never)
  const folder = app.vault.getAbstractFileByPath('notes') as TFolder
  const children = folder.children
  let reads = 0
  Object.defineProperty(folder, 'children', {
    configurable: true,
    get: () => {
      reads++
      return children
    },
  })
  await Reflect.get(fs, pass).call(fs, async () => {
    for (let i = 0; i < 32; i++)
      expect(await Reflect.get(fs, absent).call(fs, `notes/new-${i}.md`)).toBe(true)
    expect(reads).toBe(1)
    const added = await app.vault.create('notes/added.md', 'independent bytes')
    app.emit('vault', 'create', added)
    expect(await Reflect.get(fs, absent).call(fs, 'notes/ADDED.md')).toBe(false)
  })
})

it('uses the folder index only inside a pass and preserves case and Unicode aliases', async () => {
  const app = buildFakeVault([
    { path: 'notes/Sample.md', content: 'local' },
    { path: 'notes/Café.md', content: 'local' },
  ])
  const fs = new ObsidianFileSystem(app as never)
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  const list = vi.spyOn(app.vault.adapter, 'list')
  expect(await Reflect.get(fs, absent).call(fs, 'notes/missing.md')).toBe(false)
  await Reflect.get(fs, pass).call(fs, async () => {
    expect(await Reflect.get(fs, absent).call(fs, 'notes/missing.md')).toBe(true)
    expect(await Reflect.get(fs, absent).call(fs, 'notes/sample.md')).toBe(false)
    expect(await Reflect.get(fs, absent).call(fs, 'notes/Cafe\u0301.md')).toBe(false)
    expect(await Reflect.get(fs, absent).call(fs, 'missing/sample.md')).toBe(false)
    expect(stat).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })
})

it('confines and maps index absence probes through folder adapters', async () => {
  const probe = vi.fn(async () => true)
  const mapped = new LocalFolderPlacement('remote', 'local').fileSystem({
    [absent]: probe,
  } as never)
  const fs = scopedFileSystem(
    mapped,
    (path) => {
      if (!path.startsWith('remote/')) throw new Error('outside scope')
    },
    (path) => path.startsWith('remote/')
  )
  expect(await Reflect.get(fs, absent)('remote/sample.md')).toBe(true)
  expect(probe).toHaveBeenCalledWith('local/sample.md')
  probe.mockClear()
  await expect(Reflect.get(fs, absent)('private/sample.md')).rejects.toThrow('outside scope')
  expect(probe).not.toHaveBeenCalled()
})

it('never treats indexed absence as permission to overwrite an unindexed local file', async () => {
  const app = buildFakeVault([{ path: 'notes/sample.md', content: 'sample' }])
  const fs = new ObsidianFileSystem(app as never),
    state = new MemoryStateStore()
  const bytes = new TextEncoder().encode('remote bytes'),
    sha = await sha256(bytes)
  const path = 'notes/incoming.md'
  const placer = new PullPlacer(
    { openVersion: vi.fn() } as never,
    fs,
    state,
    { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
    sha256
  )
  await Reflect.get(fs, pass).call(fs, async () => {
    expect(await Reflect.get(fs, absent).call(fs, path)).toBe(true)
    await app.vault.adapter.write(path, 'independent local bytes')
    // Model the host's asynchronous index after the raw file has already appeared.
    const indexed = app.vault.getFileByPath.bind(app.vault)
    vi.spyOn(app.vault, 'getFileByPath').mockImplementation((name) =>
      name === path ? null : indexed(name)
    )
    expect(app.vault.getFileByPath(path)).toBeNull()
    const result = await placer.place(
      {
        file_id: 'sample-incoming',
        version_id: 'v1',
        path,
        sha,
        size: bytes.length,
        mtime: 1000,
        op: 'create',
      } as never,
      sha,
      null,
      new Map([[sha, bytes]]),
      new Map()
    )
    expect(result).toBe(false)
    expect(await app.vault.adapter.read(path)).toBe('independent local bytes')
    expect(await state.get(path)).toBeNull()
  })
})
