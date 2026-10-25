import { expect, it, vi } from 'vitest'
import { MemoryFileSystem, type FileSystem } from '@abele/sync-sdk/core'
import { INSTALL_BATCH, type InstallItem } from '@/sync/nativeInstallBatch'
import { coordinatedFileSystem, PathCoordinator, PLACEMENT } from '@/sync/pathCoordinator'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { TokenOffloadCoordinator } from '@/sync/tokenOffloadCoordinator'
import { ExternalRepresentation } from '@/sync/external/representation'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { serializeProjection } from '@/sync/external/projection'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { IDBFactory } from 'fake-indexeddb'

it('declines existing destinations before preserving them as possible write sources', async () => {
  const source = new MemoryFileSystem(),
    preserve = vi.fn(async () => {})
  const bytes = new Uint8Array([1])
  await source.writeAtomic('Notes/Sample.bin', bytes, 1)
  const install = vi.fn(async () => undefined)
  Reflect.set(source, INSTALL_BATCH, install)
  const fs = coordinatedFileSystem(source, new PathCoordinator(), () => {}, preserve)
  expect(
    await Reflect.get(fs, INSTALL_BATCH)(
      [{ path: 'Notes/Sample.bin', sha: 'a'.repeat(64), size: 1, mtime: 1 }],
      async () => {}
    )
  ).toBeUndefined()
  expect(preserve).not.toHaveBeenCalled()
  expect(install).not.toHaveBeenCalled()
})

it('retains the placement lease and preservation callback in the batch view', async () => {
  const source = new MemoryFileSystem(),
    preserve = vi.fn(async () => {})
  Reflect.set(
    source,
    INSTALL_BATCH,
    async (
      _items: InstallItem[],
      work: (view: FileSystem, flush: () => Promise<void>) => Promise<void>
    ) => work(new MemoryFileSystem(), async () => {})
  )
  const fs = coordinatedFileSystem(source, new PathCoordinator(), () => {}, preserve)
  const item = { path: 'Notes/Sample.md', sha: 'a'.repeat(64), size: 1, mtime: 1 }
  await Reflect.get(fs, INSTALL_BATCH)([item], async (view: FileSystem) => {
    expect(preserve).toHaveBeenCalledExactlyOnceWith([item.path])
    const place = Reflect.get(view, PLACEMENT)
    expect(typeof place).toBe('function')
    await place(['Notes/Sample.md'], async () => {})
    expect(preserve).toHaveBeenCalledExactlyOnceWith(['Notes/Sample.md'])
  })
})

for (const port of ['readCommittedEntries', 'observeCommittedEntries'] as const)
  it(`maps committed ledger acknowledgements through a different local root (${port})`, async () => {
    const root = await IndexedDbStateStore.open(new IDBFactory(), 'sample-placed-ledger')
    const entry = {
      path: 'Shared/Sample.bin',
      wirePath: 'Shared/Sample.bin',
      fileId: 'sample-file',
      versionId: 'sample-version',
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1,
    }
    const view = new LocalFolderPlacement('Shared', 'Local').localState(root)
    try {
      if (port === 'readCommittedEntries') {
        await root.put(entry)
        expect(await Reflect.get(view, port)(['Local/Sample.bin'])).toEqual([
          { ...entry, path: 'Local/Sample.bin' },
        ])
      } else {
        const seen: unknown[] = []
        Reflect.get(
          view,
          port
        )(async (entries: unknown[]) => {
          seen.push(...entries)
        })
        await root.put(entry)
        expect(seen).toEqual([{ ...entry, path: 'Local/Sample.bin' }])
      }
    } finally {
      root.close()
    }
  })

it('keeps another connection’s virtual files visible and out of fresh installation', async () => {
  const source = new MemoryFileSystem(),
    manager = new TokenOffloadCoordinator(new PathCoordinator())
  const install = vi.fn(
    async (
      _items: InstallItem[],
      work: (view: FileSystem, flush: () => Promise<void>) => Promise<void>
    ) => work(new MemoryFileSystem(), async () => {})
  )
  Reflect.set(source, INSTALL_BATCH, install)
  manager.remember(
    'sample-owner',
    [{ path: 'Media/Sample.bin', size: 10, mtime: 1 }],
    ['Media/Sample.bin.abele-ref']
  )
  const fs = manager.fileSystem(source, () => true, 'sample-other')
  const item = { path: 'Media/Sample.bin', sha: 'a'.repeat(64), size: 10, mtime: 1 }
  expect(await Reflect.get(fs, INSTALL_BATCH)([item], async () => {})).toBeUndefined()
  expect(install).not.toHaveBeenCalled()
  await Reflect.get(fs, INSTALL_BATCH)(
    [{ ...item, path: 'Media/Other.bin' }],
    async (view: FileSystem) => {
      expect(await view.stat(item.path)).toEqual({ path: item.path, size: 10, mtime: 1 })
    }
  )
})

it('keeps representation admission on the returned installation view', async () => {
  const source = new MemoryFileSystem()
  Reflect.set(
    source,
    INSTALL_BATCH,
    async (
      _items: InstallItem[],
      work: (view: FileSystem, flush: () => Promise<void>) => Promise<void>
    ) => work(new MemoryFileSystem(), async () => {})
  )
  const representation = await ExternalRepresentation.open({
    state: null,
    ledger: new MemoryStateStore(),
    fs: source,
    emptyView: {
      ledgerId: 'sample-ledger',
      binding: {
        endpoint: 'https://sync.example.invalid',
        vaultId: 'sample-vault',
        mode: 'personal',
        principalId: 'sample-principal',
        principalType: 'device',
        grantId: null,
        generation: 1,
        credentialAssociation: 'sample-slot',
      },
    },
    assertOwned: () => {},
    scriptsFolder: () => 'Scripts',
    verify: async () => {
      throw new Error('unexpected verification')
    },
    installProjection: async () => {
      throw new Error('unexpected installation')
    },
  })
  const bytes = serializeProjection({
    format: 'abele.external',
    schema: 1,
    vaultId: 'sample-vault',
    fileId: 'sample-file',
    path: 'Media/Sample.bin',
    observedVersionId: 'sample-version',
    sha256: 'a'.repeat(64),
    size: 10,
    mime: 'application/octet-stream',
    mtime: 1,
  })
  await Reflect.get(representation.fileSystem(), INSTALL_BATCH)([], async (view: FileSystem) => {
    await expect(view.writeAtomic('Media/Sample.bin', bytes, 1)).rejects.toThrow('projection bytes')
  })
})

it('maps batch plans and returned capabilities through the local scope', async () => {
  const source = new MemoryFileSystem()
  const plans: InstallItem[][] = []
  Reflect.set(
    source,
    INSTALL_BATCH,
    async (
      items: InstallItem[],
      work: (view: FileSystem, flush: () => Promise<void>) => Promise<void>
    ) => {
      plans.push(items)
      return work(source, async () => {})
    }
  )
  const includes = (path: string) => path === 'Local' || path.startsWith('Local/')
  const assertPath = (path: string) => {
    if (!includes(path)) throw new Error('sample scope refusal')
  }
  const scoped = scopedFileSystem(source, assertPath, includes)
  const placement = new LocalFolderPlacement('Shared', 'Local')
  const fs = placement.fileSystem(scoped)
  const item = { path: 'Shared/Sample.md', sha: 'a'.repeat(64), size: 1, mtime: 1 }
  await Reflect.get(fs, INSTALL_BATCH)([item], async (view: FileSystem) => {
    await view.stat('Shared/Sample.md')
    await expect(view.stat('Other/Sample.md')).rejects.toThrow()
  })
  expect(plans).toEqual([[{ ...item, path: 'Local/Sample.md' }]])
  expect(() =>
    Reflect.get(scoped, INSTALL_BATCH)([{ ...item, path: 'Other/Sample.md' }], async () => {})
  ).toThrow('sample scope refusal')
  expect(plans).toHaveLength(1)
})
