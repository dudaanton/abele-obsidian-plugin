import { expect, it, vi } from 'vitest'
import {
  EngineError,
  MemoryFileSystem,
  MemoryStateStore,
  SyncEngine,
  sha256,
  selectiveDefaults,
  V2EngineClient,
  fingerprintSource,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { VaultSettingsSchema, encodeAccessToken } from '@abele/sync-sdk/protocol'

// BUG: SDK scan fingerprints the entire inventory before SyncCycle can publish any file.
it.fails(
  'uploads an available note before waiting for an unrelated attachment fingerprint',
  async () => {
    const fs = new MemoryFileSystem(),
      state = new MemoryStateStore()
    const note = new TextEncoder().encode('sample note'),
      video = new Uint8Array([1, 2, 3])
    await fs.writeAtomic('sample.md', note, 1000)
    await fs.writeAtomic('sample.mp4', video, 1000)
    let release!: () => void, began!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const hashing = new Promise<void>((resolve) => {
      began = resolve
    })
    const fingerprint = async (path: string) => {
      if (path === 'sample.mp4') {
        began()
        await waiting
      }
      const bytes = await fs.read(path)
      return { size: bytes.length, sha: await sha256(bytes) }
    }
    const putBlob = vi.fn(async () => {
      throw new EngineError('offline', 'sample upload stop')
    })
    const client = {
      state: async () => ({ head_seq: 0, settings: VaultSettingsSchema.parse({}), usage: {} }),
      manifest: async () => ({ items: [], head_seq: 0, next: null }),
      changes: async () => ({ items: [], head_seq: 0, next_since: 0 }),
      hasBlob: async () => false,
      putBlob,
    } as unknown as EngineClient
    const engine = new SyncEngine({
      fs: Object.assign(fs, { fingerprint }),
      state,
      client,
      selective: selectiveDefaults(),
    })
    const work = engine.sync().catch((error) => error)
    try {
      await Promise.race([
        hashing,
        work.then((error) => {
          throw error ?? new Error('Sync ended before hashing')
        }),
      ])
      // The note's bytes and identity are already available. No wall-clock limit or real large
      // allocation is needed to prove that unrelated fingerprint work blocks its publication.
      expect(putBlob).toHaveBeenCalled()
    } finally {
      release()
      await work
      await engine.stop()
    }
  }
)

// BUG: SDK directory reconciliation commits one mkdir per round trip before uploading files.
it.fails('batches independent directory creation before file uploads', async () => {
  const { V2Directories } = await import(
    '../../node_modules/@abele/sync-sdk/dist/internal/core/v2Directories.js'
  )
  const fs = Object.assign(new MemoryFileSystem(), {
    async *listDirectories() {
      for (let n = 0; n < 40; n++)
        yield { path: `sample-${n}`, mtime: 1000, identity: `directory-${n}` }
    },
  })
  const commit = vi.fn(async (ops: { path: string; mtime: number }[]) =>
    ops.map((op) => ({
      status: 'applied',
      file_id: `file-${op.path}`,
      version_id: `version-${op.path}`,
      path: op.path,
      mtime: op.mtime,
    }))
  )
  const directories = new V2Directories(fs, new MemoryStateStore(), () => true, commit as never)
  await directories.scan()
  expect(commit).toHaveBeenCalledTimes(1)
})

// BUG: SDK multipart upload awaits each part response before scheduling the next part.
it.fails('pipelines a bounded pair of multipart requests', async () => {
  const chunk = 1024 * 1024
  const source = {
    size: 3 * chunk,
    read: async (_offset: number, length: number) => new Uint8Array(length),
    assertUnchanged: async () => {},
    close: async () => {},
  }
  const identity = await fingerprintSource(source)
  let release!: () => void, entered!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const first = new Promise<void>((resolve) => {
    entered = resolve
  })
  let requests = 0
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (String(input).endsWith('/begin'))
      return Response.json({
        upload_id: '00000000-0000-4000-8000-000000000001',
        part_size: chunk,
        parts: 3,
      })
    if (init?.method === 'PUT') {
      requests++
      if (requests === 1) entered()
      await waiting
    }
    return new Response(null, { status: 204 })
  })
  const client = new V2EngineClient(
    encodeAccessToken({
      v: 1,
      address: 'https://sync.example.invalid',
      key: 'a'.repeat(43),
      scope: { kind: 'folder', id: 'sample-root', path: '/' },
    }),
    { fetch }
  )
  const work = client.putBlobSource(identity, source)
  try {
    await first
    // Give already scheduled parallel work a turn without a performance threshold.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toBe(2)
  } finally {
    release()
    await work
  }
})

// BUG: SDK scan persists committed entries only; an unfinished inventory loses its hashes.
it.fails('retains fingerprints of unchanged files that have not been committed', async () => {
  const { scan } = await import('../../node_modules/@abele/sync-sdk/dist/internal/core/scanner.js')
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  await fs.writeAtomic('sample.md', new TextEncoder().encode('sample note'), 1000)
  const fingerprint = vi.fn(async (path: string) => {
    const bytes = await fs.read(path)
    return { size: bytes.length, sha: await sha256(bytes) }
  })
  const ports = Object.assign(fs, { fingerprint })
  await scan(ports, state, { excluded: () => false })
  fingerprint.mockClear()
  // The durable state survives reconstruction of the engine, while its process-local maps do not.
  await scan(ports, state, { excluded: () => false })
  expect(fingerprint).not.toHaveBeenCalled()
})
