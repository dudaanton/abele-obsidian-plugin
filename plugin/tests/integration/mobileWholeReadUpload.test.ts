import { gateMobileSource } from '@/sync/mobileLargeFileGate'
import { connectionError } from '@/sync/tokenUi'
import { MobileWholeReadLimitError } from '@/sync/mobileWholeRead'
import { afterEach, expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { mobileReadSnapshot } from '@/sync/mobileReadDiagnostics'
import { mobileLargeFileGate } from '@/sync/mobileLargeFileGate'
import { TransferBudget } from '@abele/sync-sdk/core'

it('opens an upload source without taking the large-buffer lease ahead of its transfer slot', async () => {
  const size = 51 * MiB
  const readBinary = vi.fn(async () => new ArrayBuffer(size))
  const io = new BoundedVaultIo({
    stat: async () => ({ type: 'file', size, mtime: 1, ctime: 1 }),
    readBinary,
  } as unknown as DataAdapter)
  const source = await io.openUploadRead('sample.bin')
  try {
    expect(readBinary).not.toHaveBeenCalled()
    // A queued publisher can open before acquiring a transfer slot. A scanner
    // already holding that slot must still be able to take the buffer lease.
    expect(Reflect.get(mobileLargeFileGate, 'active')).toBe(false)
    const release = await mobileLargeFileGate.acquire()
    release()
    const budget = new TransferBudget({ maxActiveTransfers: 1 })
    // Before lazy acquisition this is a cycle: the scanner holds the transfer
    // slot waiting for the publisher's buffer; the publisher waits for that slot.
    await Promise.all([
      budget.run(() => io.fingerprintForUpload('other.bin', async () => {})),
      budget.run(async () => {
        expect((await source.read(0, 1))[0]).toBe(0)
        await source.close()
      }),
    ])
    expect(readBinary).toHaveBeenCalledTimes(2)
  } finally {
    await source.close()
  }
  expect(Reflect.get(mobileLargeFileGate, 'active')).toBe(false)
})

const MiB = 1024 * 1024
afterEach(() => vi.unstubAllGlobals())
it('closes a queued whole-read source without allocating or releasing another transfer', async () => {
  const release = await mobileLargeFileGate.acquire()
  const readBinary = vi.fn(async () => new ArrayBuffer(51 * MiB))
  const io = new BoundedVaultIo({
    stat: async () => ({ type: 'file', size: 51 * MiB, mtime: 1, ctime: 1 }),
    readBinary,
  } as unknown as DataAdapter)
  try {
    const source = await io.openUploadRead('sample.bin')
    const reading = source.read(0, 1)
    const rejected = expect(reading).rejects.toThrow('Bounded source closed')
    await source.close()
    await rejected
    expect(readBinary).not.toHaveBeenCalled()
    expect(mobileLargeFileGate.snapshot()).toMatchObject({ active: true, queued: 0 })
  } finally {
    release()
  }
})
it('hashes and uploads from one whole mobile read and releases the buffer on failure', async () => {
  const size = 51 * MiB
  const readBinary = vi.fn(async () => new ArrayBuffer(size))
  const adapter = {
    stat: async () => ({ type: 'file', size, mtime: 1, ctime: 1 }),
    readBinary,
  } as unknown as DataAdapter
  const io = new BoundedVaultIo(adapter)
  await expect(
    io.fingerprintForUpload('sample.bin', async (identity, source) => {
      expect(identity.size).toBe(size)
      expect((await source.read(size - 1, 1))[0]).toBe(0)
      expect(mobileReadSnapshot().retainedBytes).toBeGreaterThanOrEqual(size)
      throw new Error('upload interrupted')
    })
  ).rejects.toThrow('upload interrupted')
  expect(readBinary).toHaveBeenCalledOnce()
  expect(mobileReadSnapshot().retainedBytes).toBe(0)
})
it('refuses a whole mobile read above 200 MiB before allocating', async () => {
  const readBinary = vi.fn()
  const adapter = {
    stat: async () => ({ type: 'file', size: 201 * MiB, mtime: 1, ctime: 1 }),
    readBinary,
  } as unknown as DataAdapter
  await expect(new BoundedVaultIo(adapter).openUploadRead('sample.bin')).rejects.toThrow('200 MiB')
  expect(readBinary).not.toHaveBeenCalled()
})

it('shows the requested byte size and mobile limit in the existing too-large failure', () => {
  const error = new MobileWholeReadLimitError(201 * MiB)
  expect(error.code).toBe('too_large')
  expect(connectionError(error)).toContain(String(201 * MiB))
  expect(connectionError(error)).toContain('200 MiB')
  expect(connectionError(error)).toContain('stays on this device')
})

it('reuses a successfully uploaded hash for offload without another whole read and keeps edits local', async () => {
  const size = 51 * MiB
  let mtime = 1
  const readBinary = vi.fn(async () => new ArrayBuffer(size))
  const adapter = {
    stat: async () => ({ type: 'file', size, mtime, ctime: 1 }),
    readBinary,
  } as unknown as DataAdapter
  const upload = new BoundedVaultIo(adapter)
  const identity = await upload.fingerprintForUpload('sample.bin', async () => {})
  const verification = new BoundedVaultIo(
    adapter,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true
  )
  expect(await verification.fingerprint('sample.bin')).toMatchObject({ size, sha: identity!.sha })
  mtime++
  await expect(verification.fingerprint('sample.bin')).rejects.toThrow(
    'Recorded file changed; file kept'
  )
  expect(readBinary).toHaveBeenCalledOnce()
})

it('drops the whole upload buffer before a hydration or another adapter can read a large file', async () => {
  const size = 51 * MiB
  const readBinary = vi.fn(async () => new ArrayBuffer(size))
  const adapter = {
    stat: async () => ({ type: 'file', size, mtime: 1, ctime: 1 }),
    readBinary,
  } as unknown as DataAdapter
  const first = await new BoundedVaultIo(adapter).openUploadRead('first.bin')
  // Opening is now allocation-free; first read takes the buffer lease.
  await first.read(0, 1)
  const remoteRead = vi.fn(async () => new Uint8Array(1))
  const remote = gateMobileSource({
    size,
    read: remoteRead,
    assertUnchanged: async () => {},
    close: async () => {},
  })
  const reading = remote.read(0, 1)
  const second = new BoundedVaultIo(adapter).openUploadRead('second.bin')
  await Promise.resolve()
  expect(remoteRead).not.toHaveBeenCalled()
  expect(readBinary).toHaveBeenCalledTimes(1)
  await first.close()
  await reading
  expect(mobileReadSnapshot().retainedBytes).toBe(0)
  expect(readBinary).toHaveBeenCalledTimes(1)
  await remote.close()
  const source = await second
  await source.read(0, 1)
  expect(readBinary).toHaveBeenCalledTimes(2)
  await source.close()
  expect(mobileReadSnapshot().retainedBytes).toBe(0)
})
