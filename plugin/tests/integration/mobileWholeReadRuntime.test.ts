import { mobileStreamFixture } from '../helpers/mobileStreamFixture'
import { mobileReadSnapshot } from '@/sync/mobileReadDiagnostics'
import { sourcesFromScan } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pushSources.js'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, selectiveDefaults } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { FINGERPRINT_UPLOAD, UPLOAD_READ } from '@/sync/mobileWholeRead'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ExecutableReview } from '@/sync/executableReview'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'

const MiB = 1024 * 1024
afterEach(() => vi.unstubAllGlobals())
it('scans and publishes a large whole-read source once before the normal path commit', async () => {
  const size = 200 * MiB
  const fixture = mobileStreamFixture(size)
  const readBinary = fixture.readBinary
  const io = new BoundedVaultIo(fixture.adapter)
  const fs = new MemoryFileSystem()
  // Keep inventory virtual so the test accounts for only the actual mobile source buffer.
  fs.list = async function* () {
    yield { path: 'sample.bin', size, mtime: 1 }
  }
  fs.stat = async (path) => (path === 'sample.bin' ? { path, size, mtime: 1 } : null)
  fs.fingerprint = vi.fn(async () => {
    throw new Error('second scan read')
  })
  fs.openRead = vi.fn(async () => {
    throw new Error('second upload read')
  })
  const fresh = Symbol.for('abele.sync.fingerprint-fresh-v1')
  Object.assign(fs, {
    [FINGERPRINT_UPLOAD]: io.fingerprintForUpload.bind(io),
    [fresh]: fs.fingerprint,
  })
  const scope = { kind: 'folder' as const, id: 'root', path: '/' }
  const address = 'https://sync.example'
  const metadata = new MemoryStateStore()
  let complete = 0,
    committed = false
  let concurrent: Promise<unknown[]> | undefined
  const one = new TokenEngineRuntime({
    id: 'sample',
    encoded: encodeAccessToken({ v: 1, address, key: 'a'.repeat(43), scope }),
    fs,
    state: new MemoryStateStore(),
    selective: { ...selectiveDefaults(), maxFileBytes: size },
    reviews: {
      attachments: new AttachmentConsent(metadata),
      executables: new ExecutableReview(metadata),
      close: () => {},
    },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 200 * MiB, quota_bytes: null },
        })
      if (path === '/v2/manifest' || path === '/v2/changes')
        return Response.json({ items: [], cursor: 0, next: null })
      if (path.endsWith('/begin')) {
        const port = Reflect.get(one.engine, 'opts').fs
        concurrent ??= Promise.all([port[fresh]('sample.bin'), port.fingerprint('sample.bin')])
        return Response.json({
          upload_id: 'sample-upload',
          part_size: MiB,
          parts: 200,
          received: [],
        })
      }
      if (path.endsWith('/complete')) {
        complete++
        return new Response(null, { status: 204 })
      }
      if (path.startsWith('/v2/uploads/')) return new Response(null, { status: 204 })
      if (path === '/v2/commit') {
        expect(complete).toBe(1)
        committed = true
        const ops = JSON.parse(String(init?.body)).ops
        return Response.json({
          cursor: 1,
          results: ops.map(() => ({
            status: 'rejected',
            code: 'quota_exceeded',
            message: 'sample quota',
          })),
        })
      }
      throw new Error('Unexpected route: ' + path)
    },
    changed: () => {},
    failed: () => {},
    covers: async () => false,
  })
  try {
    await one.sync()
    expect(committed).toBe(true)
    await concurrent
    expect(fixture.counts.largeFetches).toBe(0)
    expect(readBinary).toHaveBeenCalledOnce()
    expect(fs.fingerprint).not.toHaveBeenCalled()
    expect(fs.openRead).not.toHaveBeenCalled()
    // Revalidation after an acknowledged upload uses its unchanged stamp and hash, not another read.
    const port = Reflect.get(one.engine, 'opts').fs
    const baseline = mobileReadSnapshot()
    const checks = await Promise.all([
      port[fresh]('sample.bin'),
      port[fresh]('sample.bin'),
      port.fingerprint('sample.bin'),
    ])
    expect(checks.every((one) => one.size === size)).toBe(true)
    expect(readBinary).toHaveBeenCalledOnce()
    expect(mobileReadSnapshot().retainedBytes).toBe(0)
    expect(mobileReadSnapshot().peakRetainedBytes).toBe(size + MiB)
    expect(mobileReadSnapshot().maxChunkBytes).toBe(size)
    expect(fixture.counts.bytesProduced).toBe(size)
    expect(mobileReadSnapshot().wholeReads - baseline.wholeReads).toBe(0)
    expect(fs.fingerprint).not.toHaveBeenCalled()
    expect(fs.openRead).not.toHaveBeenCalled()
    vi.mocked(fs.fingerprint).mockResolvedValueOnce({ size: 16, sha: 'b'.repeat(64), mtime: 1 })
    expect(await port.fingerprint('small.bin')).toMatchObject({ size: 16 })
    expect(fs.fingerprint).toHaveBeenCalledWith('small.bin')
    // A fully verified received version is already acknowledged by this server, too.
    const receivedSha = 'c'.repeat(64)
    const http = Reflect.get(one.client, 'http')
    const close = vi.fn(async () => {})
    vi.spyOn(http, 'openRange').mockResolvedValue({
      size: 4,
      read: async (_offset: number, length: number) => new Uint8Array(length),
      assertUnchanged: async () => {},
      close,
    })
    const received = await one.client.openVersion('sample-received', 'sample-v2', {
      size: 4,
      sha: receivedSha,
    })
    await received.read(2, 2)
    await received.assertUnchanged()
    expect(Reflect.get(one, 'wholeReadUploads').has(receivedSha)).toBe(false)
    await received.read(0, 4)
    await received.assertUnchanged()
    expect(Reflect.get(one, 'wholeReadUploads').has(receivedSha)).toBe(true)
    // Receiving bytes proves nothing about this token's right to commit them: a scoped server
    // admits a new sha only against this principal's own upload, so the blob check must still
    // send it. Otherwise a note whose content this device once received is never committed.
    expect(await one.client.hasBlob(receivedSha)).toBe(false)
    await received.close()
    expect(close).toHaveBeenCalledOnce()

    expect(readBinary).toHaveBeenCalledOnce()
    await one.sync()
    expect(readBinary).toHaveBeenCalledOnce()
  } finally {
    await one.close()
  }
}, 60_000)

it('checks scope before a whole-read fingerprint and translates placed paths', async () => {
  const fs = new MemoryFileSystem()
  const fingerprint = vi.fn(async (_path: string, ..._args: unknown[]) => undefined)
  Object.assign(fs, { [FINGERPRINT_UPLOAD]: fingerprint })
  const scoped = scopedFileSystem(
    fs,
    (path) => {
      if (!path.startsWith('Shared/')) throw new Error('outside scope')
    },
    (path) => path.startsWith('Shared/')
  )
  const placed = new LocalFolderPlacement('Remote', 'Shared').fileSystem(scoped)
  const call = Reflect.get(placed, FINGERPRINT_UPLOAD)
  await call('Remote/sample.bin', async () => {})
  expect(fingerprint.mock.calls[0]?.[0]).toBe('Shared/sample.bin')
  await expect(Reflect.get(scoped, FINGERPRINT_UPLOAD)('Private/sample.bin')).rejects.toThrow(
    'outside scope'
  )
  expect(fingerprint).toHaveBeenCalledOnce()
})

it('uses the upload-only reader when opening a journal or scan source through placement and scope', async () => {
  const fs = new MemoryFileSystem()
  fs.openRead = vi.fn(async () => {
    throw new Error('non-upload read must not run')
  })
  const source = { size: 51 * MiB, read: vi.fn(), assertUnchanged: vi.fn(), close: vi.fn() }
  const upload = vi.fn(async (_path: string) => source)
  Object.assign(fs, { [UPLOAD_READ]: upload })
  const scoped = scopedFileSystem(
    fs,
    (path) => {
      if (!path.startsWith('Shared/')) throw new Error('outside scope')
    },
    () => true
  )
  const placed = new LocalFolderPlacement('Remote', 'Shared').fileSystem(scoped)
  const sources = sourcesFromScan(placed, {
    hashes: new Map([['Remote/sample.bin', 'sample-sha']]),
    diskPaths: new Map(),
  } as never)
  expect(await sources.open!('sample-sha')).toBe(source)
  expect(upload).toHaveBeenCalledWith('Shared/sample.bin')
  expect(fs.openRead).not.toHaveBeenCalled()
  await expect(Reflect.get(scoped, UPLOAD_READ)('Private/sample.bin')).rejects.toThrow(
    'outside scope'
  )
  expect(upload).toHaveBeenCalledOnce()
})

it('spends an own upload acknowledgement on the commit that used it, but keeps it after a rejection', async () => {
  const scope = { kind: 'folder' as const, id: 'root', path: '/' }
  const metadata = new MemoryStateStore()
  const kept = 'd'.repeat(64),
    spent = 'e'.repeat(64),
    lost = 'f'.repeat(64)
  let failNext = false
  const one = new TokenEngineRuntime({
    id: 'sample',
    encoded: encodeAccessToken({
      v: 1,
      address: 'https://sync.example',
      key: 'a'.repeat(43),
      scope,
    }),
    fs: new MemoryFileSystem(),
    state: new MemoryStateStore(),
    selective: selectiveDefaults(),
    reviews: {
      attachments: new AttachmentConsent(metadata),
      executables: new ExecutableReview(metadata),
      close: () => {},
    },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path !== '/v2/commit') throw new Error('Unexpected route: ' + path)
      if (failNext) throw new TypeError('sample network loss')
      const ops = JSON.parse(String(init?.body)).ops as { sha: string; path: string }[]
      return Response.json({
        cursor: 1,
        results: ops.map((op, index) =>
          op.sha === kept
            ? { status: 'rejected', code: 'quota_exceeded', message: 'sample quota' }
            : {
                status: 'applied',
                file_id: 'sample-file-' + index,
                version_id: 'sample-version-' + index,
                seq: 1,
                path: op.path,
                sha: op.sha,
                size: 1,
                mtime: 1,
              }
        ),
      })
    },
    changed: () => {},
    failed: () => {},
    covers: async () => false,
  })
  try {
    const acknowledged = Reflect.get(one, 'uploadEntitlements') as Set<string>
    for (const sha of [kept, spent, lost]) acknowledged.add(sha)
    const create = (sha: string, path: string) =>
      ({ op: 'create', path, sha, size: 1, mtime: 1 }) as const
    await one.client.commitRaw([create(kept, 'kept.md'), create(spent, 'spent.md')], 'sample-1')
    expect(await one.client.hasBlob(kept)).toBe(true)
    expect(await one.client.hasBlob(spent)).toBe(false)
    failNext = true
    await expect(one.client.commitRaw([create(lost, 'lost.md')], 'sample-2')).rejects.toThrow()
    // The server may have consumed it before the response was lost; upload again rather than guess.
    expect(await one.client.hasBlob(lost)).toBe(false)
  } finally {
    await one.close()
  }
})
