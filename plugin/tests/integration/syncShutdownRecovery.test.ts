import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryFileSystem, MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ignoreFor } from '@/sync/scope'
import { deferred } from '../helpers/deferred'

it.each(['pull', 'push'] as const)(
  'closes during %s and reopens the ledger without lost or duplicated work',
  async (direction) => {
    const factory = new IDBFactory(),
      fs = new MemoryFileSystem()
    const bytes = new TextEncoder().encode('sample persisted bytes'),
      sha = await sha256(bytes)
    const scope = { kind: 'folder' as const, id: 'sample-root', path: 'Notes' }
    const path = 'Notes/sample.md'
    const item = {
      file_id: 'sample-file',
      version_id: 'sample-version',
      path,
      sha,
      size: bytes.length,
      mtime: 1000,
      kind: 'note',
    }
    if (direction === 'push') await fs.writeAtomic(path, bytes, 1000)
    const entered = deferred<void>(),
      late = deferred<void>()
    const receipts = new Map<string, unknown>()
    const keys: string[] = []
    let interrupted = false,
      committed = false,
      effects = 0
    const send: typeof fetch = async (input, init) => {
      const route = new URL(String(input)).pathname
      if (route === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000000, quota_bytes: null },
        })
      if (route === '/v2/manifest')
        return Response.json({
          items: direction === 'pull' || committed ? [item] : [],
          cursor: committed || direction === 'pull' ? 1 : 0,
          next: null,
        })
      if (route === '/v2/changes')
        return Response.json({
          items: [],
          cursor: committed || direction === 'pull' ? 1 : 0,
          next: null,
        })
      if (route.startsWith('/v2/uploads/')) return new Response(null, { status: 204 })
      if (route.includes('/content') || route === '/v2/commit') {
        const key = new Headers(init?.headers).get('idempotency-key') ?? ''
        if (route === '/v2/commit') keys.push(key)
        if (!interrupted) {
          interrupted = true
          entered.resolve()
          await new Promise<void>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            )
            // Model a native commit landing after JavaScript has stopped waiting.
            void late.promise.then(() => {
              if (direction === 'push' && !receipts.has(key)) {
                effects++
                committed = true
                receipts.set(key, { cursor: 1, results: [{ status: 'applied', ...item, seq: 1 }] })
              }
            })
          })
        }
        if (route.includes('/content')) return new Response(bytes)
        expect(key).not.toBe('')
        return Response.json(receipts.get(key))
      }
      throw new Error('Unexpected route ' + route)
    }
    const failed = vi.fn(),
      changed = vi.fn()
    const make = (state: IndexedDbStateStore) => {
      const metadata = new MemoryStateStore()
      return new TokenEngineRuntime({
        id: 'sample-connection',
        encoded: encodeAccessToken({
          v: 1,
          address: 'https://sync.example',
          key: 'a'.repeat(43),
          scope,
        }),
        fs,
        state,
        fetch: send,
        reviews: {
          executables: new ExecutableReview(metadata),
          attachments: new AttachmentConsent(metadata),
          close() {},
        },
        changed,
        failed,
        covers: async () => false,
        scopeInput: async () => ({ key: 'sample-scope', ignore: ignoreFor('.obsidian', null) }),
      })
    }
    let state = await IndexedDbStateStore.open(factory, 'sample-shutdown')
    let host = make(state)
    const running = host.sync().catch(() => {})
    try {
      await entered.promise
      const pending = await state.getJournal()
      await host.close()
      await running
      state.close()
      late.resolve()
      await Promise.resolve()
      state = await IndexedDbStateStore.open(factory, 'sample-shutdown')
      host = make(state)
      if (direction === 'push')
        expect((await state.getJournal())?.idempotencyKey).toBe(pending?.idempotencyKey)
      await host.sync()
      expect(await fs.read(path)).toEqual(bytes)
      expect(await state.getJournal()).toBeNull()
      expect(await Array.fromAsync(state.all())).toHaveLength(1)
      if (direction === 'push') {
        expect(effects).toBe(1)
        expect(keys).toHaveLength(2)
        expect(new Set(keys).size).toBe(1)
      }
      expect(failed).not.toHaveBeenCalled()
    } finally {
      late.resolve()
      await host.close()
      state.close()
    }
  }
)
