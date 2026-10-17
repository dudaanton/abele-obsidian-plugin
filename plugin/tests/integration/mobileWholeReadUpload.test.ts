import { connectionError } from '@/sync/tokenUi'
import { MobileWholeReadLimitError } from '@/sync/mobileWholeRead'
import { afterEach, expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { mobileReadSnapshot } from '@/sync/mobileReadDiagnostics'

const MiB = 1024 * 1024
afterEach(() => vi.unstubAllGlobals())
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
