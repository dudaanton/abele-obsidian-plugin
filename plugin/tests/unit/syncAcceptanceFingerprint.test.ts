import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryFileSystem, sha256 } from '@abele/sync-sdk/core'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it.each([
  'bound',
  'cohort',
  'changed',
  'unbound',
  'mutation',
  'event',
  'during-read',
  'cancelled',
  'claim',
])('proves accepted native content without trusting an indexed hint (%s)', async (mode) => {
  const path = 'sample.bin'
  const app = buildFakeVault([{ path, content: 'old', mtime: 1000, ctime: 100 }])
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-acceptance', app)
  try {
    let body = 'old',
      clock = 'first'
    const files = new ObsidianFileSystem(app as never)
    Object.defineProperty(files, 'native', { value: { fileContentRevision: async () => clock } })
    Object.assign(files, {
      fileIdentity: async () => 'sample-object',
      rawStat: async () => ({ type: 'file', size: 3, mtime: 1000, ctime: 100 }),
    })
    const physical = vi.fn(async () => ({
      sha: await sha256(new TextEncoder().encode(body)),
      size: 3,
      mtime: 1000,
      generation: '3:1000:100',
    }))
    Object.defineProperty(files, 'fingerprintFresh', { value: physical })
    const expected = await files.fingerprint(path)
    if (mode === 'changed') {
      body = 'new'
      clock = 'second'
    }
    if (mode === 'unbound' || mode === 'during-read') {
      const saved = (await host.readScanFingerprint(path))!
      delete saved.contentRevision
      await host.writeScanFingerprint(path, saved)
      body = 'new'
    }
    if (mode === 'mutation') {
      const stat = Reflect.get(files, 'rawStat')
      Object.assign(files, {
        rawStat: async () => {
          const result = await stat()
          await host.withScanMutation([path], async () => {})
          return result
        },
      })
    }
    const signal = new AbortController()
    if (mode === 'cancelled') signal.abort()
    if (mode === 'claim')
      Reflect.set(files, 'runtimeFence', {
        assertReady: () => {
          throw new Error('claim lost')
        },
      })
    physical.mockClear()
    if (mode === 'cohort')
      vi.spyOn(host, 'pendingScanInstallation').mockImplementation(() => {
        throw new Error('Acceptance cannot wait for its publication cohort')
      })
    const fingerprint = files.fingerprint.bind(files)
    const counted = vi.spyOn(files, 'fingerprint')
    if (mode === 'event') {
      counted.mockImplementationOnce(async (...args) => {
        const result = await fingerprint(...args)
        app.emit('vault', 'modify', app.vault.getFileByPath(path))
        return result
      })
    }
    if (mode === 'during-read')
      physical.mockImplementationOnce(async () => {
        const sha = await sha256(new TextEncoder().encode(body))
        clock = 'raced'
        return { sha, size: 3, mtime: 1000, generation: '3:1000:100' }
      })
    const proof = files.fingerprintAfterAcceptance(path, expected, signal.signal)
    if (['mutation', 'event', 'during-read'].includes(mode))
      await expect(proof).rejects.toThrow('File changed during acceptance proof')
    else if (['cancelled', 'claim'].includes(mode)) await expect(proof).rejects.toThrow()
    else {
      expect(await proof).toEqual({
        path,
        size: 3,
        mtime: 1000,
        ctime: 100,
        sha: await sha256(new TextEncoder().encode(body)),
      })
      expect(counted).toHaveBeenCalledOnce()
      expect(physical).toHaveBeenCalledTimes(['bound', 'cohort'].includes(mode) ? 0 : 1)
    }
  } finally {
    host.close()
  }
})

it('leaves unavailable native proof to the bounded core fallback', async () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'old', mtime: 1000 }])
  const files = new ObsidianFileSystem(app as never)
  const cached = vi.spyOn(files, 'fingerprint')
  expect(
    await files.fingerprintAfterAcceptance('sample.bin', { sha: 'a'.repeat(64), size: 3 })
  ).toBeNull()
  expect(cached).not.toHaveBeenCalled()
})

it('maps the acceptance proof through placement and scope without granting writes', async () => {
  const proof = vi.fn(async (path: string) => ({
    path,
    sha: 'a'.repeat(64),
    size: 3,
    mtime: 1,
    ctime: 2,
  }))
  const raw = Object.assign(new MemoryFileSystem(), { fingerprintAfterAcceptance: proof })
  const scoped = scopedFileSystem(
    raw,
    (path) => {
      if (!path.startsWith('Local/')) throw new Error('outside scope')
    },
    (path) => path.startsWith('Local/')
  )
  const mapped = new LocalFolderPlacement('Remote', 'Local').fileSystem(scoped)
  const expected = { sha: 'a'.repeat(64), size: 3 }
  const signal = new AbortController().signal
  expect(await mapped.fingerprintAfterAcceptance!('Remote/sample.bin', expected, signal)).toEqual({
    path: 'Remote/sample.bin',
    ...expected,
    mtime: 1,
    ctime: 2,
  })
  expect(proof).toHaveBeenCalledExactlyOnceWith('Local/sample.bin', expected, signal)
  await expect(scoped.fingerprintAfterAcceptance!('Other/sample.bin', expected)).rejects.toThrow(
    'outside scope'
  )
  expect(proof).toHaveBeenCalledOnce()
})
