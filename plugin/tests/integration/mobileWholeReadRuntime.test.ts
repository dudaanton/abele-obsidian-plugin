import { sourcesFromScan } from '../../node_modules/@abele/sync-core/dist/pushSources.js'
import { afterEach, expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { MemoryFileSystem, MemoryStateStore, selectiveDefaults } from '@abele/sync-core'
import { encodeAccessToken } from '@abele/sync-protocol'
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
  const size = 51 * MiB
  const readBinary = vi.fn(async () => new ArrayBuffer(size))
  const io = new BoundedVaultIo({
    stat: async () => ({ type: 'file', size, mtime: 1, ctime: 1 }),
    readBinary,
  } as unknown as DataAdapter)
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
      if (path.endsWith('/begin'))
        return Response.json({
          upload_id: 'sample-upload',
          part_size: MiB,
          parts: 51,
          received: [],
        })
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
    expect(readBinary).toHaveBeenCalledOnce()
    expect(fs.fingerprint).not.toHaveBeenCalled()
    expect(fs.openRead).not.toHaveBeenCalled()
    // Revalidation enters through the fresh-fingerprint capability rather than fingerprint().
    const port = Reflect.get(one.engine, 'opts').fs
    expect(await port[fresh]('sample.bin')).toMatchObject({ size })
    expect(readBinary).toHaveBeenCalledTimes(2)
    expect(fs.fingerprint).not.toHaveBeenCalled()
    expect(fs.openRead).not.toHaveBeenCalled()
  } finally {
    await one.close()
  }
})

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
