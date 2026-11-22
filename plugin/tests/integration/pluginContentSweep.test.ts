import { expect, it, vi } from 'vitest'
import { MemoryStateStore, scan, sha256 } from '@abele/sync-sdk/core'
import { reconciliationScan } from '../../node_modules/@abele/sync-sdk/dist/internal/core/reconciliation.js'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { sweepFingerprintFile } from '../../node_modules/@abele/sync-sdk/dist/internal/core/fs.js'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import * as hostStorage from '@/sync/hostSyncStorage'

it.each(['atomic', 'stage'])(
  'keeps portable installation evidence across adapter replacement and rejects observed events (%s)',
  async (kind) => {
    const app = buildFakeVault([])
    const fs = new ObsidianFileSystem(app as never)
    const bytes = new TextEncoder().encode('installed sample')
    const expected = { sha: await sha256(bytes), size: bytes.length }
    if (kind === 'atomic') await fs.writeAtomic('sample.bin', bytes, 1000)
    else {
      const stage = await fs.beginAtomicWrite('sample.bin', 1000, null)
      await stage.append(0, bytes)
      await stage.seal(expected)
      await stage.commit()
    }
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    read.mockClear()
    expect(await fs.verifiedInstallation('sample.bin', expected)).toBe(true)
    app.vault.adapter = new Proxy(app.vault.adapter, {})
    const restarted = new ObsidianFileSystem(app as never)
    expect(await restarted.verifiedInstallation('sample.bin', expected)).toBe(true)
    app.emit('vault', 'modify', { path: 'sample.bin' })
    expect(await restarted.verifiedInstallation('sample.bin', expected)).toBe(false)
    expect(read).not.toHaveBeenCalled()
  }
)

it('accepts only an exact installation bound to the current object and content revision', async () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'sample' }])
  const fs = new ObsidianFileSystem(app as never)
  const stat = (await app.vault.adapter.stat('sample.bin'))!
  const expected = { sha: 'a'.repeat(64), size: stat.size }
  const receipt = {
    ...expected,
    ...stat,
    identity: 'object-1',
    installation: true,
    contentRevision: 'revision-1',
  }
  let identity = receipt.identity
  let revision = receipt.contentRevision
  let epoch = 0
  let bound = true
  Object.defineProperty(fs, 'native', { value: { fileContentRevision: async () => revision } })
  Object.defineProperty(fs, 'fileIdentity', { value: async () => identity })
  const store = vi.spyOn(hostStorage, 'durableHostOf').mockReturnValue({
    scanFingerprintRevision: () => epoch,
    scanInstallation: () => (bound ? receipt : undefined),
  } as never)
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  try {
    expect(await fs.verifiedInstallation('sample.bin', expected)).toBe(true)
    expect(await fs.verifiedInstallation('sample.bin', { ...expected, sha: 'b'.repeat(64) })).toBe(
      false
    )
    expect(await fs.verifiedInstallation('sample.bin', { ...expected, size: stat.size + 1 })).toBe(
      false
    )
    revision = 'revision-2'
    expect(await fs.verifiedInstallation('sample.bin', expected)).toBe(false)
    revision = receipt.contentRevision
    identity = 'object-2'
    expect(await fs.verifiedInstallation('sample.bin', expected)).toBe(false)
    identity = receipt.identity
    vi.spyOn(app.vault.adapter, 'stat').mockImplementationOnce(async () => {
      bound = false
      return stat
    })
    expect(await fs.verifiedInstallation('sample.bin', expected)).toBe(false)
    bound = true
    vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async () => {
      epoch++
      return stat
    })
    expect(await fs.verifiedInstallation('sample.bin', expected)).toBe(false)
    expect(read).not.toHaveBeenCalled()
  } finally {
    store.mockRestore()
  }
})

it('maps read-only proof capabilities through connection scope and placement', async () => {
  const proof = vi.fn(async () => true)
  const bounded = vi.fn(async () => false)
  const fs = Object.assign(new ObsidianFileSystem(buildFakeVault([]) as never), {
    verifiedInstallation: proof,
    boundedReadAvailable: bounded,
  })
  const scoped = scopedFileSystem(
    fs,
    (path) => {
      if (!path.startsWith('Local/')) throw new Error('outside')
    },
    (path) => path.startsWith('Local/')
  )
  const mapped = new LocalFolderPlacement('Shared', 'Local').fileSystem(scoped)
  const expected = { sha: 'a'.repeat(64), size: 7 }
  expect(await mapped.verifiedInstallation!('Shared/sample.bin', expected)).toBe(true)
  expect(await mapped.boundedReadAvailable!('Shared/sample.bin')).toBe(false)
  expect(proof).toHaveBeenCalledExactlyOnceWith('Local/sample.bin', expected)
  expect(bounded).toHaveBeenCalledExactlyOnceWith('Local/sample.bin')
  await expect(scoped.verifiedInstallation!('Other/sample.bin', expected)).rejects.toThrow(
    'outside'
  )
  expect(proof).toHaveBeenCalledOnce()
})

it('does not turn an indexed hash or an eager reader into installation evidence', async () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'sample' }])
  const fs = new ObsidianFileSystem(app as never)
  const identity = await fs.fingerprint('sample.bin')
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  read.mockClear()
  expect(await fs.verifiedInstallation('sample.bin', identity)).toBe(false)
  expect(await fs.boundedReadAvailable('sample.bin')).toBe(false)
  expect(read).not.toHaveBeenCalled()
})

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
