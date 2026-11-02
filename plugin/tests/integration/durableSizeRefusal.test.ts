import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryFileSystem, MemoryStateStore } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ExecutableReview } from '@/sync/executableReview'

it('negotiates an unchanged oversized source once across cycles and restarts, until its identity or server limit changes', async () => {
  const MiB = 1024 * 1024,
    factory = new IDBFactory(),
    fs = new MemoryFileSystem()
  const path = 'sample.bin',
    bytes = new Uint8Array(2 * MiB).fill(37)
  await fs.writeAtomic(path, bytes, 1000)
  let ctime = 100,
    limit = MiB,
    negotiations = 0,
    payloads = 0
  const stat = fs.stat.bind(fs)
  fs.stat = async (path) => {
    const info = await stat(path)
    return info ? { ...info, ctime } : null
  }
  Object.assign(fs, {
    openRead: async (path: string) => {
      const value = await fs.read(path)
      return {
        size: value.length,
        read: async (offset: number, size: number) => value.slice(offset, offset + size),
        assertUnchanged: async () => {},
        close: async () => {},
      }
    },
  })
  const scope = { kind: 'folder' as const, id: 'sample-root', path: '/' }
  const cycle = async (expected: number) => {
    const state = await IndexedDbStateStore.open(factory, 'sample-size-refusal')
    const metadata = new MemoryStateStore()
    const runtime = new TokenEngineRuntime({
      id: 'sample-connection',
      state,
      fs,
      encoded: encodeAccessToken({
        v: 1,
        address: 'https://sync.example.invalid',
        key: 'a'.repeat(43),
        scope,
      }),
      reviews: {
        attachments: new AttachmentConsent(metadata),
        executables: new ExecutableReview(metadata),
        close: () => {},
      },
      changed: () => {},
      failed: () => {},
      covers: async () => false,
      fetch: async (input, init) => {
        const route = new URL(String(input)).pathname
        if (route === '/v2/connection')
          return Response.json({
            protocol: 2,
            token_id: 'sample-token',
            space_id: 'sample-space',
            scope,
            status: 'active',
            limits: { max_file_bytes: limit, quota_bytes: null },
          })
        if (route === '/v2/manifest' || route === '/v2/changes')
          return Response.json({ items: [], cursor: 0, next: null })
        if (
          route === '/v2/connection/items' ||
          (route.startsWith('/v2/uploads/') && init?.method === 'HEAD')
        )
          return new Response(null, { status: 404 })
        if (route.endsWith('/begin')) {
          negotiations++
          return Response.json(
            {
              error: { code: 'too_large', message: 'Sample server size limit', details: { limit } },
            },
            { status: 413 }
          )
        }
        if (route.startsWith('/v2/uploads/') && init?.method === 'PUT') payloads++
        throw new Error('Unexpected sample route: ' + route)
      },
    })
    try {
      await runtime.sync()
      await runtime.sync()
      expect(negotiations).toBe(expected)
      expect(payloads).toBe(0)
      expect((await fs.stat(path))?.size).toBeGreaterThan(limit)
      expect(await runtime.notSynced()).toEqual(
        expect.arrayContaining([expect.objectContaining({ path, kind: 'too-large' })])
      )
    } finally {
      await runtime.close()
      state.close()
    }
  }
  for (let generation = 0; generation < 3; generation++) await cycle(1)
  // New runtimes drop the SDK's per-instance SHA memo: each change must also
  // invalidate the durable tuple, rather than being hidden by that memo.
  limit++
  await cycle(2)
  await fs.writeAtomic(path, bytes, 2000)
  await cycle(3)
  ctime++
  await cycle(4)
  await fs.writeAtomic(path, new Uint8Array(2 * MiB + 8), 2000)
  await cycle(5)
}, 30000)
