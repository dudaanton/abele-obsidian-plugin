import { expect, it, vi } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { TokenOffloadCoordinator } from '@/sync/tokenOffloadCoordinator'
import { PathCoordinator } from '@/sync/pathCoordinator'
import { deferred } from '../helpers/deferred'

it('accepts incoming metadata without hydrating an offloaded stale version after reconnect', async () => {
  const manager = new TokenOffloadCoordinator(new PathCoordinator())
  const hydrate = vi.fn(async () => {
    throw new Error('The old version is no longer current')
  })
  manager.remember('sample', [{ path: 'Media/sample.bin', size: 12, mtime: 1 }], [])
  manager.hydrator('sample', hydrate)
  await expect(
    manager.prepareIncoming('sample', ['Media/sample.bin', 'Notes/ordinary.md'])
  ).resolves.toBeUndefined()
  expect(hydrate).not.toHaveBeenCalled()
  // An explicit request for content still goes through the authorized hydrator.
  await expect(manager.prepare(['Media/sample.bin'])).rejects.toThrow('no longer current')
  expect(hydrate).toHaveBeenCalledOnce()
})

it('still prepares offloaded descendants before an incoming parent placement', async () => {
  const manager = new TokenOffloadCoordinator(new PathCoordinator())
  const hydrate = vi.fn(async () => {})
  manager.remember('sample', [{ path: 'Media/sample.bin', size: 12, mtime: 1 }], [])
  manager.hydrator('sample', hydrate)
  await manager.prepareIncoming('sample', ['Media'])
  expect(hydrate).toHaveBeenCalledWith('Media/sample.bin')
})

it('prepares content offloaded by another source before ordinary incoming placement', async () => {
  const manager = new TokenOffloadCoordinator(new PathCoordinator())
  const hydrate = vi.fn(async () => {})
  manager.remember('other', [{ path: 'Media/sample.bin', size: 12, mtime: 1 }], [])
  manager.hydrator('other', hydrate)
  await manager.prepareIncoming('sample', ['Media/sample.bin'])
  expect(hydrate).toHaveBeenCalledWith('Media/sample.bin')
})

it('tries a reachable authorized source before the offline source backoff, even when offline is preferred', async () => {
  const manager = new TokenOffloadCoordinator(new PathCoordinator())
  const bytes = new TextEncoder().encode('retained bytes')
  const head = {
    fileId: 'a',
    versionId: 'v',
    path: 'sample.bin',
    wirePath: 'sample.bin',
    sha: await sha256(bytes),
    size: bytes.length,
    mtime: 1,
  }
  const ledger = new MemoryStateStore()
  await ledger.put(head)
  const slowOffline = vi.fn(async () => {
    throw new Error('offline retry would wait six seconds')
  })
  manager.register('offline', {
    ledger,
    available: () => false,
    assertOwned: () => {},
    includes: () => true,
    verify: slowOffline,
    download: async () => bytes,
  })
  manager.register('online', {
    ledger,
    available: () => true,
    assertOwned: () => {},
    includes: () => true,
    verify: async () => {},
    download: async () => bytes,
  })
  await manager.authorize(head)
  expect(await manager.download('offline', head)).toEqual(bytes)
  expect(slowOffline).not.toHaveBeenCalled()
})

it('uses another authorized connection when the original source is offline, without a placement lease', async () => {
  const locks = new PathCoordinator(),
    manager = new TokenOffloadCoordinator(locks),
    fs = new MemoryFileSystem(),
    bytes = new TextEncoder().encode('real bytes'),
    head = {
      fileId: 'a',
      versionId: 'v',
      path: 'sample.bin',
      wirePath: 'sample.bin',
      sha: await sha256(bytes),
      size: bytes.length,
      mtime: 1000,
    },
    ledger = new MemoryStateStore()
  await ledger.put(head)
  const offline = vi.fn(async () => {
      throw new Error('offline')
    }),
    download = vi.fn(async () => {
      await locks.run(['sample.bin'], async () => {})
      return bytes
    })
  manager.register('first', {
    ledger,
    assertOwned: () => {},
    download: offline,
    verify: async () => {},
    includes: () => true,
  })
  manager.register('second', {
    ledger,
    assertOwned: () => {},
    download,
    verify: async () => {},
    includes: () => true,
  })
  expect(await manager.download('first', head)).toEqual(bytes)
  expect(download).toHaveBeenCalledOnce()
  expect(await fs.stat('sample.bin')).toBeNull()
})
it('does not turn another connection’s intentional absence into a delete or upload projection bytes', async () => {
  const manager = new TokenOffloadCoordinator(new PathCoordinator()),
    fs = new MemoryFileSystem()
  manager.remember(
    'first',
    [{ path: 'sample.bin', size: 10, mtime: 1000 }],
    ['sample.bin.abele-ref']
  )
  await fs.writeAtomic('sample.bin.abele-ref', new TextEncoder().encode('placeholder'), 1000)
  const view = manager.fileSystem(fs, () => true)
  expect(await Array.fromAsync(view.list())).toEqual([
    { path: 'sample.bin', size: 10, mtime: 1000 },
  ])
  expect(await view.stat('sample.bin')).toEqual({ path: 'sample.bin', size: 10, mtime: 1000 })
  await expect(view.read('sample.bin')).rejects.toThrow(/unavailable/i)
})
it('a stalled hydration leaves unrelated paths free and coalesces competing opens', async () => {
  const locks = new PathCoordinator(),
    manager = new TokenOffloadCoordinator(locks),
    gate = deferred<void>(),
    hydrate = vi.fn(async () => {
      await gate.promise
    })
  manager.remember('first', [{ path: 'sample.bin', size: 10, mtime: 1000 }], [])
  manager.hydrator('first', hydrate)
  const first = manager.prepare(['sample.bin']),
    second = manager.prepare(['sample.bin'])
  await locks.run(['other.bin'], async () => {})
  expect(hydrate).toHaveBeenCalledOnce()
  gate.resolve()
  await Promise.all([first, second])
})
