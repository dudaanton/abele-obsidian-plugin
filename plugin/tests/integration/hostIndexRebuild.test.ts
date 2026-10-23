import { expect, it, vi } from 'vitest'
import {
  MemoryStateStore,
  scan,
  sha256,
  applyStaged,
  ExpectedWrites,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

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

it('abandons an indexed scan when rebuilding starts and retries from disk', async () => {
  const app = buildFakeVault([
    { path: 'a.md', content: 'a' },
    { path: 'b.md', content: 'b' },
  ])
  let clean = true
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => clean })
  const fs = new ObsidianFileSystem(app as never)
  const listing = fs.list()[Symbol.asyncIterator]()
  expect((await listing.next()).done).toBe(false)
  clean = false
  await expect(listing.next()).rejects.toThrow('Host index changed')
  const paths = []
  for await (const file of fs.list()) paths.push(file.path)
  expect(paths.sort()).toEqual(['a.md', 'b.md'])
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
      // The current direct-placement contract reads inspection and placement sources.
      // Reindexing must add no requests or bytes to that same steady-state contract.
      expect(openVersion).toHaveBeenCalledTimes(2)
      expect(received).toBe(bytes.length * 2)
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
