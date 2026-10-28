import { expect, it, vi } from 'vitest'
import {
  MemoryStateStore,
  scan,
  sha256,
  applyStaged,
  ExpectedWrites,
  type EngineClient,
  SyncEngine,
} from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'
import { selectiveFrom } from '@/sync/connection'

it('waits for the host index to settle shortly after layout readiness', async () => {
  const app = buildFakeVault([{ path: 'sample.md', content: 'x' }])
  let clean = false
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => clean })
  const fs = new ObsidianFileSystem(app as never, {
    prepareStartupInventory: async () => {},
  })
  const diskWalk = vi.spyOn(fs as never, 'diskVaultFiles')
  const settled = setTimeout(() => {
    clean = true
    app.emit('metadataCache', 'resolved')
  }, 150)
  try {
    expect((await Array.fromAsync(fs.list())).map((file) => file.path)).toEqual(['sample.md'])
    expect(diskWalk).not.toHaveBeenCalled()
  } finally {
    clearTimeout(settled)
  }
})

it('falls back to the physical inventory when the host index stays dirty', async () => {
  const app = buildFakeVault([{ path: 'sample.md', content: 'x' }])
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => false })
  const fs = new ObsidianFileSystem(app as never, {
    prepareStartupInventory: async () => {},
  })
  const diskWalk = vi.spyOn(fs as never, 'diskVaultFiles')
  expect((await Array.fromAsync(fs.list())).map((file) => file.path)).toEqual(['sample.md'])
  expect(diskWalk).toHaveBeenCalled()
})

it('reuses a settled disk listing within an inventory and retires it on a vault event', async () => {
  const app = buildFakeVault([{ path: 'sample.md', content: 'x' }])
  app.metadataCache.isCacheClean = () => false
  const fs = new ObsidianFileSystem(app as never)
  const raw = vi.spyOn(fs as never, 'listUnlocked')
  const stop = fs.watch(() => {})
  try {
    await Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1')).call(fs, async () => {
      const paths = async () => Array.fromAsync(fs.list()).then((files) => files.map((f) => f.path))
      expect(await paths()).toEqual(['sample.md'])
      expect(await paths()).toEqual(['sample.md'])
      expect(raw).toHaveBeenCalledTimes(1)
      const created = await app.vault.create('next.md', 'x')
      app.emit('vault', 'create', created)
      expect((await paths()).sort()).toEqual(['next.md', 'sample.md'])
      expect(raw).toHaveBeenCalledTimes(2)
    })
  } finally {
    stop()
  }
})

it('overlaps bounded file metadata reads while rebuilding a disk inventory', async () => {
  const app = buildFakeVault(
    Array.from({ length: 32 }, (_, n) => ({ path: `sample-${n}.md`, content: 'x' }))
  )
  app.metadataCache.isCacheClean = () => false
  const fs = new ObsidianFileSystem(app as never)
  const stat = app.vault.adapter.stat.bind(app.vault.adapter)
  let active = 0
  let maximum = 0
  vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
    active++
    maximum = Math.max(maximum, active)
    try {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return await stat(path)
    } finally {
      active--
    }
  })
  const paths: string[] = []
  for await (const file of fs.list()) paths.push(file.path)
  expect(paths).toHaveLength(32)
  expect(maximum).toBeGreaterThan(1)
  expect(maximum).toBeLessThanOrEqual(16)
})

it('distinguishes a missing download parent from a failed listing during rebuild', async () => {
  const app = buildFakeVault([])
  app.metadataCache.isCacheClean = () => false
  const fs = new ObsidianFileSystem(app as never)
  expect(await fs.listChildren('Incoming')).toEqual([])
  await app.vault.createFolder('Incoming')
  vi.spyOn(app.vault.adapter, 'list').mockRejectedValue(new Error('sample listing failure'))
  await expect(fs.listChildren('Incoming')).rejects.toThrow('sample listing failure')
})

it('starts a synced engine during a partial stale rebuild without transfers or content reads', async () => {
  const app = buildFakeVault([
    { path: 'a.md', content: 'x', mtime: 1000 },
    { path: 'b.md', content: 'x', mtime: 1000 },
  ])
  const files = app.vault.getFiles()
  files[0].stat = { ...files[0].stat, mtime: 0 }
  vi.spyOn(app.vault, 'getFiles').mockReturnValue(files.slice(0, 1))
  const diskStat = app.vault.adapter.stat.bind(app.vault.adapter)
  app.vault.adapter.stat = async (path) => {
    const info = await diskStat(path)
    return info?.type === 'file' ? { ...info, mtime: 1000 } : info
  }
  app.metadataCache.isCacheClean = () => false
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  withDesktopFs(app)
  const state = new MemoryStateStore()
  const fs = new ObsidianFileSystem(app as never, { ledger: state })
  const sha = await sha256(new Uint8Array([120]))
  for (const path of ['a.md', 'b.md']) {
    const entry = { path, wirePath: path, fileId: path, versionId: 'v1', sha, size: 1, mtime: 1000 }
    await state.put(entry)
    await state.setMeta(
      'paired-file:' + path,
      JSON.stringify({ ...entry, identity: await fs.fileIdentity!(path) })
    )
  }
  await state.setCursor(1)
  read.mockClear()
  const transfer = vi.fn(() => {
    throw new Error('Unexpected transfer')
  })
  const client = {
    state: async () => ({
      head_seq: 1,
      settings: {
        conflict: 'merge',
        max_file_bytes: 1000000,
        quota_bytes: null,
        retention: { notes_days: 30, attachments_days: 30, settings_days: 30 },
      },
    }),
    changes: async () => ({ items: [], head_seq: 1, next_since: 1 }),
    manifest: transfer,
    commit: transfer,
    commitRaw: transfer,
    getBlob: transfer,
    putBlob: transfer,
  } as unknown as EngineClient
  const engine = new SyncEngine({ fs, state, client, selective: selectiveFrom(undefined) })
  try {
    await engine.sync()
    expect(transfer).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  } finally {
    await engine.stop()
  }
})

it('uses a settled index when layout becomes ready before the first inventory pass', async () => {
  const app = buildFakeVault(
    Array.from({ length: 32 }, (_, n) => ({ path: `sample-${n}.md`, content: 'x' }))
  )
  app.workspace.layoutReady = false
  const fs = new ObsidianFileSystem(app as never)
  app.workspace.layoutReady = true
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  await Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1')).call(fs, async () => {
    const paths = []
    for await (const file of fs.list()) paths.push(file.path)
    expect(paths).toHaveLength(32)
  })
  expect(stat.mock.calls.filter(([path]) => path.startsWith('sample-'))).toHaveLength(16)
})

it('keeps a recorded physical spelling when a rebuilding host normalizes its disk listing', async () => {
  const path = 'Cafe\u0301.md'
  const app = buildFakeVault([{ path, content: 'sample', mtime: 1000 }])
  app.metadataCache.isCacheClean = () => false
  const list = app.vault.adapter.list.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'list').mockImplementation(async (parent) => {
    const result = await list(parent)
    return { ...result, files: result.files.map((file) => file.normalize('NFC')) }
  })
  const state = new MemoryStateStore()
  await state.put({
    path,
    wirePath: path.normalize('NFC'),
    fileId: 'sample',
    versionId: 'v1',
    size: 6,
    mtime: 1000,
    sha: 'a'.repeat(64),
  })
  const fs = new ObsidianFileSystem(app as never, { ledger: state })
  const paths = []
  for await (const file of fs.list()) paths.push(file.path)
  expect(paths).toEqual([path])
})

it('uses disk when the indexed count moves while taking the startup snapshot', async () => {
  const app = buildFakeVault([
    { path: 'a.md', content: 'a' },
    { path: 'b.md', content: 'b' },
  ])
  const files = app.vault.getFiles()
  vi.spyOn(app.vault, 'getFiles').mockReturnValueOnce(files).mockReturnValue(files.slice(0, 1))
  const fs = new ObsidianFileSystem(app as never)
  const paths = []
  for await (const file of fs.list()) paths.push(file.path)
  expect(paths.sort()).toEqual(['a.md', 'b.md'])
})

it('keeps a sealed indexed snapshot when rebuilding starts after its first result', async () => {
  const app = buildFakeVault([
    { path: 'a.md', content: 'a' },
    { path: 'b.md', content: 'b' },
  ])
  let clean = true
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => clean })
  const fs = new ObsidianFileSystem(app as never)
  const listing = fs.list()[Symbol.asyncIterator]()
  const first = await listing.next()
  expect(first.done).toBe(false)
  clean = false
  const sealed = [first.value!.path]
  for (;;) {
    const next = await listing.next()
    if (next.done) break
    sealed.push(next.value.path)
  }
  expect(sealed.sort()).toEqual(['a.md', 'b.md'])
  const paths = []
  for await (const file of fs.list()) paths.push(file.path)
  expect(paths.sort()).toEqual(['a.md', 'b.md'])
})

it('retries from disk when the host index changes inside an inventory', async () => {
  const app = buildFakeVault([
    { path: 'a.md', content: 'a' },
    { path: 'b.md', content: 'b' },
  ])
  let clean = true
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => clean })
  const fs = new ObsidianFileSystem(app as never)
  const physical = Reflect.get(fs, 'physicalPaths').bind(fs)
  let interrupted = false
  Reflect.set(fs, 'physicalPaths', async (...args: unknown[]) => {
    const result = await physical(...args)
    if (!interrupted) {
      interrupted = true
      clean = false
    }
    return result
  })
  const paths = []
  for await (const file of fs.list()) paths.push(file.path)
  expect(interrupted).toBe(true)
  expect(paths.sort()).toEqual(['a.md', 'b.md'])
})

it('waits through repeated metadata changes while reading one file stat', async () => {
  const app = buildFakeVault([{ path: 'sample.md', content: 'sample' }])
  Object.assign(app.metadataCache, { initialized: false, isCacheClean: () => false })
  const fs = new ObsidianFileSystem(app as never)
  const stat = app.vault.adapter.stat.bind(app.vault.adapter)
  const update = Reflect.get(fs, 'updateInventory').bind(fs)
  let changed = 0
  vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
    const result = await stat(path)
    if (path === 'sample.md' && changed < 3) {
      changed++
      update(['sample.md'])
    }
    return result
  })
  const inventory = Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1')).bind(fs)
  const result = await inventory(() => fs.stat('sample.md'))
  expect(changed).toBe(3)
  expect(result?.size).toBe(6)
})

it('waits through repeated directory changes before publishing their inventory', async () => {
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as never)
  let changed = 0
  Reflect.set(fs, 'listDirectories', async function* () {
    if (changed < 3) {
      changed++
      Reflect.get(fs, 'inventory').directoryRevision++
    }
  })
  const inventory = Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1')).bind(fs)
  const directories = Reflect.get(fs, Symbol.for('abele.sync.inventory-directories-v1')).bind(fs)
  expect(await inventory(() => directories())).toEqual([])
  expect(changed).toBe(3)
})

it.each(['partial', 'finishes', 'stale', 'unknown', 'layout', 'initializing'])(
  'uses disk membership and stats throughout a %s index pass without content reads',
  async (mode) => {
    const app = buildFakeVault([
      { path: 'a.md', content: 'alpha', mtime: 1000 },
      { path: 'b.md', content: 'bravo', mtime: 1000 },
    ])
    const files = app.vault.getFiles()
    let clean = mode === 'stale'
    Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => clean })
    if (mode === 'unknown') Object.assign(app.metadataCache, { isCacheClean: undefined })
    if (mode === 'layout') app.workspace.layoutReady = false
    if (mode === 'initializing') app.metadataCache.initialized = false
    vi.spyOn(app.vault, 'getFiles').mockReturnValue(mode === 'stale' ? files : files.slice(0, 1))
    if (mode === 'stale') files[0].stat = { ...files[0].stat, mtime: 500 }
    const state = new MemoryStateStore()
    for (const [path, content] of [
      ['a.md', 'alpha'],
      ['b.md', 'bravo'],
    ])
      await state.put({
        path,
        wirePath: path,
        fileId: path,
        versionId: 'v1',
        sha: await sha256(new TextEncoder().encode(content)),
        size: 5,
        mtime: 1000,
      })
    const stat = app.vault.adapter.stat.bind(app.vault.adapter)
    vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
      if (mode === 'finishes') clean = true
      const actual = await stat(path)
      // This fixture normally shares its index stat with its disk stat. Model a stale
      // index independently so the disk continues to report the unchanged baseline.
      return mode === 'stale' && path === 'a.md' && actual ? { ...actual, mtime: 1000 } : actual
    })
    const fs = new ObsidianFileSystem(app as never)
    const fingerprint = vi.spyOn(fs, 'fingerprint')
    const result = await scan(fs, state, { excluded: () => false })
    expect(result.ops).toEqual([])
    expect(result.hashes.size).toBe(2)
    expect(fingerprint).not.toHaveBeenCalled()
  }
)

it.each([
  ['upload', false],
  ['upload', true],
  ['download', false],
  ['download', true],
] as const)(
  'keeps transfer behavior stable mid-%s with rebuilding=%s',
  async (direction, rebuilding) => {
    const bytes = new TextEncoder().encode('sample transfer')
    const app = buildFakeVault(
      direction === 'upload'
        ? [{ path: 'sample.bin', content: 'sample transfer', mtime: 1000 }]
        : []
    )
    withDesktopFs(app)
    let clean = true
    Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => clean })
    const indexed = app.vault.getFiles.bind(app.vault)
    vi.spyOn(app.vault, 'getFiles').mockImplementation(() => (clean ? indexed() : []))
    const state = new MemoryStateStore()
    const fs = new ObsidianFileSystem(app as never, { ledger: state })
    const sha = await sha256(bytes)
    if (direction === 'upload') {
      const source = await fs.openRead('sample.bin')
      try {
        expect(await source.read(0, 3)).toEqual(bytes.slice(0, 3))
        clean = !rebuilding
        expect(await source.read(3, bytes.length - 3)).toEqual(bytes.slice(3))
        await source.assertUnchanged()
      } finally {
        await source.close()
      }
      await state.put({
        path: 'sample.bin',
        wirePath: 'sample.bin',
        fileId: 'sample',
        versionId: 'v1',
        sha,
        size: bytes.length,
        mtime: 1000,
      })
    } else {
      let received = 0
      const openVersion = vi.fn(async () => ({
        size: bytes.length,
        read: async (offset: number, length: number) => {
          clean = !rebuilding
          const chunk = bytes.slice(offset, offset + length)
          received += chunk.length
          return chunk
        },
        assertUnchanged: async () => {},
        close: async () => {},
      }))
      await applyStaged(
        { openVersion } as unknown as EngineClient,
        fs,
        state,
        [
          {
            seq: 1,
            file_id: 'sample',
            version_id: 'v1',
            path: 'sample.bin',
            prev_path: null,
            op: 'create',
            kind: 'attachment',
            sha,
            size: bytes.length,
            mtime: 1000,
            at: '',
            actor: { kind: 'system', id: 'sample', name: 'Sample' },
          },
        ],
        {
          filter: { excluded: () => false },
          dirty: new Set(),
          expected: new ExpectedWrites(),
          prefetchBytes: 0,
        }
      )
      // Direct placement verifies and installs one source read. Rebuilding must
      // add no requests or bytes to that same steady-state baseline.
      expect(openVersion).toHaveBeenCalledTimes(1)
      expect(received).toBe(bytes.length)
    }
    const fingerprint = vi.spyOn(fs, 'fingerprint')
    expect((await scan(fs, state, { excluded: () => false })).ops).toEqual([])
    expect(fingerprint).not.toHaveBeenCalled()
    clean = true
    const restarted = new ObsidianFileSystem(app as never, { ledger: state })
    expect((await scan(restarted, state, { excluded: () => false })).ops).toEqual([])
    expect(new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))).toEqual(bytes)
  }
)
