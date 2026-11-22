import { expect, it, vi } from 'vitest'
import { MemoryStateStore, scan, sha256 } from '@abele/sync-sdk/core'
import { reconciliationScan } from '../../node_modules/@abele/sync-sdk/dist/internal/core/reconciliation.js'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { sweepFingerprintFile } from '../../node_modules/@abele/sync-sdk/dist/internal/core/fs.js'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'

it.each(['io', 'filesystem'])(
  'rejects grown mobile sweep files before eager whole-file reads (%s)',
  async (port) => {
    const admittedSize = 1024 * 1024
    const app = buildFakeVault([{ path: 'sample.bin', content: 'sample' }])
    // The listing admitted 1 MiB; the mobile adapter now sees a 4 MiB replacement.
    vi.spyOn(app.vault.adapter, 'stat').mockResolvedValue({
      type: 'file',
      size: 4 * admittedSize,
      mtime: 1,
      ctime: 1,
    })
    const read = vi
      .spyOn(app.vault.adapter, 'readBinary')
      .mockImplementation(async () => new ArrayBuffer(4 * admittedSize))
    const io = new BoundedVaultIo(app.vault.adapter as never)
    const fs =
      port === 'io' ? { openRead: io.openRead.bind(io) } : new ObsidianFileSystem(app as never)
    for (let n = 0; n < 16; n++) {
      await expect(
        sweepFingerprintFile(fs as never, 'sample.bin', admittedSize, sha256)
      ).rejects.toThrow()
    }
    expect(read).not.toHaveBeenCalled()
  }
)

async function fixture(count: number) {
  const paths = Array.from(
    { length: count },
    (_, n) => `sample-${n.toString().padStart(3, '0')}.bin`
  )
  const app = buildFakeVault(paths.map((path) => ({ path, content: 'old' })))
  const fs = new ObsidianFileSystem(app as never)
  const state = new MemoryStateStore()
  const stale = await fs.fingerprint(paths[0])
  for (const [n, path] of paths.entries()) {
    const info = (await fs.stat(path))!
    await state.put({
      ...info,
      wirePath: path,
      fileId: `sample-file-${n}`,
      versionId: 'base',
      sha: stale.sha,
    })
    await app.vault.adapter.writeBinary(path, new TextEncoder().encode('new').buffer, {
      mtime: info.mtime,
    })
  }
  const cached = vi.spyOn(fs, 'fingerprint').mockResolvedValue(stale)
  Object.defineProperty(fs, Symbol.for('abele.sync.cached-scan-hash-v1'), {
    value: async () => stale,
  })
  return { fs, state, paths, cached }
}

it('uses fresh bytes for admitted cold candidates during full recovery inspection', async () => {
  const { fs, paths, cached } = await fixture(1)
  const deferred = vi.fn(async () => false)
  Object.assign(fs, { deferNewLocalFile: deferred })
  const found = await scan(
    fs,
    new MemoryStateStore(),
    { excluded: () => false },
    { revalidate: 'all' }
  )
  expect(found.hashes.get(paths[0])).toBe(await sha256(new TextEncoder().encode('new')))
  expect(found.complete).toBe(true)
  expect(deferred).toHaveBeenCalledOnce()
  expect(cached).not.toHaveBeenCalled()
})

it('finds same-stat edits through openRead within three rotating bounded sweeps', async () => {
  const { fs, state, paths, cached } = await fixture(33)
  const open = fs.openRead.bind(fs)
  let readBytes = 0
  vi.spyOn(fs, 'openRead').mockImplementation(async (...args) => {
    const source = await open(...args)
    return {
      ...source,
      read: async (at, length, signal) => {
        readBytes += length
        return source.read(at, length, signal)
      },
    }
  })
  const foundPaths = new Set<string>()
  const expected = await sha256(new TextEncoder().encode('new'))
  for (let pass = 0; pass < 3; pass++) {
    const before = readBytes
    const { found } = await reconciliationScan(
      fs,
      state,
      { excluded: () => false },
      0,
      undefined,
      undefined,
      false
    )
    expect(found.skipped).toEqual([])
    for (const [path, hash] of found.hashes) if (hash === expected) foundPaths.add(path)
    expect(readBytes - before).toBeLessThanOrEqual(16 * 3)
  }
  expect([...foundPaths].sort()).toEqual(paths)
  expect(cached).not.toHaveBeenCalled()
})

it('closes a grown sweep source before reading beyond its admitted size', async () => {
  const { fs, state } = await fixture(1)
  const read = vi.fn(async () => new Uint8Array(4))
  const close = vi.fn(async () => {})
  vi.spyOn(fs, 'openRead').mockResolvedValue({
    size: 4,
    read,
    close,
    assertUnchanged: async () => {},
  })
  const { found } = await reconciliationScan(
    fs,
    state,
    { excluded: () => false },
    0,
    undefined,
    undefined,
    false
  )
  expect(read).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
  expect(found.ops).toEqual([])
  expect(found.skipped).toHaveLength(1)
})
