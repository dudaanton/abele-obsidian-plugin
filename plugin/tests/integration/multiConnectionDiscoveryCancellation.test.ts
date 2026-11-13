import { expect, it, vi } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, TransferBudget, sha256 } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ignoreFor } from '@/sync/scope'
import { deferred } from '../helpers/deferred'

it.each(['folder', 'file'] as const)(
  'resumes a native scan interrupted by a sibling %s item commit on the same key',
  async (rightKind) => {
    const fs = new MemoryFileSystem(),
      budget = new TransferBudget({ maxActiveTransfers: 2 })
    const items = [
      { id: 'sample-left', kind: 'folder' as const, scope_id: 'scope-left', path: 'Left' },
      {
        id: 'sample-right',
        kind: rightKind,
        scope_id: 'scope-right',
        path: rightKind === 'file' ? 'Right/sample.md' : 'Right',
      },
    ]
    const encoded = encodeAccessToken({
      v: 2,
      address: 'https://sync.example',
      key: 'a'.repeat(43),
      items,
    })
    Object.assign(fs, {
      [Symbol.for('abele.sync.scan-upload-source-v1')]: true,
      openRead: async (path: string) => {
        const bytes = await fs.read(path)
        return {
          size: bytes.length,
          read: async (offset: number, length: number) => bytes.slice(offset, offset + length),
          assertUnchanged: async () => {},
          close: async () => {},
        }
      },
    })
    let cursor = 1,
      interrupt = false
    const entered = deferred<void>()
    const subscribers = new Set<(seq: number) => void>()
    const blobs = new Map<string, Uint8Array>()
    const stored = new Map<
      string,
      {
        path: string
        file_id: string
        version_id: string
        sha: string
        size: number
        mtime: number
        kind: string
      }
    >()
    const leftBytes = new TextEncoder().encode('sample left'),
      leftSha = await sha256(leftBytes)
    const rightBytes = new TextEncoder().encode('sample right')
    if (rightKind === 'file') {
      const oldBytes = new TextEncoder().encode('sample previous right'),
        sha = await sha256(oldBytes)
      await fs.writeAtomic('Right/sample.md', oldBytes, 1000)
      blobs.set(sha, oldBytes)
      stored.set('Right/sample.md', {
        path: 'Right/sample.md',
        file_id: 'sample-existing',
        version_id: 'sample-old',
        sha,
        size: oldBytes.length,
        mtime: 1000,
        kind: 'note',
      })
    }
    const publications: string[] = []
    const failures: unknown[] = []
    const make = (item: (typeof items)[number]) => {
      const state = new MemoryStateStore()
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const route = new URL(String(input)).pathname
        if (route === '/v2/connection')
          return Response.json({
            protocol: 2,
            token_id: 'sample-token',
            space_id: 'sample-space',
            scope: { kind: item.kind, id: item.scope_id, path: item.path },
            status: 'active',
            limits: { max_file_bytes: 1000000, quota_bytes: null },
          })
        if (route === '/v2/manifest')
          return Response.json({
            items: [...stored.values()].filter(
              (row) => row.path === item.path || row.path.startsWith(item.path + '/')
            ),
            cursor,
            next: null,
          })
        if (route === '/v2/changes') return Response.json({ items: [], cursor, next: null })
        if (route.startsWith('/v2/uploads/')) {
          const sha = route.split('/').at(-1)!
          if (init?.method === 'HEAD') {
            if (sha === leftSha && interrupt) {
              interrupt = false
              entered.resolve()
              return new Promise<Response>((_resolve, reject) => {
                const signal = init.signal!
                const cancel = () => reject(signal.reason)
                signal.addEventListener('abort', cancel, { once: true })
                if (signal.aborted) cancel()
              })
            }
            return new Response(null, { status: blobs.has(sha) ? 200 : 404 })
          }
          if (init?.method === 'PUT') {
            blobs.set(sha, new Uint8Array(await new Response(init.body).arrayBuffer()))
            return new Response(null, { status: 204 })
          }
        }
        if (route === '/v2/commit') {
          const { ops } = JSON.parse(String(init?.body))
          const results = ops.map(
            (op: {
              op: string
              path?: string
              file_id?: string
              sha?: string
              size?: number
              mtime?: number
            }) => {
              const prior = [...stored.values()].find((row) => row.file_id === op.file_id)
              const path = op.path ?? prior!.path
              const row = {
                path,
                file_id: prior?.file_id ?? crypto.randomUUID(),
                version_id: crypto.randomUUID(),
                sha: op.sha ?? '',
                size: op.size ?? 0,
                mtime: op.mtime ?? 1000,
                kind: 'note',
              }
              if (op.op === 'create' || op.op === 'modify') {
                stored.set(path, row)
                publications.push(path)
              }
              return { ...row, sha: op.sha ?? null, status: 'applied', seq: ++cursor }
            }
          )
          for (const notify of subscribers) notify(cursor)
          return Response.json({ results, cursor })
        }
        throw Error('Unexpected route: ' + route)
      }
      const runtime = new TokenEngineRuntime({
        id: item.id,
        item: item.id,
        encoded,
        fs,
        state,
        transferBudget: budget,
        fetch,
        reviews: {
          executables: new ExecutableReview(state),
          attachments: new AttachmentConsent(state),
          close: () => {},
        },
        changed: () => {},
        failed: (error) => failures.push(error),
        covers: async () => false,
        scopeInput: async () => ({ key: item.id, ignore: ignoreFor('.obsidian', null) }),
      })
      vi.spyOn(runtime.client, 'subscribe').mockImplementation((notify) => {
        subscribers.add(notify)
        return () => {
          subscribers.delete(notify)
        }
      })
      return runtime
    }
    const left = make(items[0]),
      right = make(items[1])
    let work = Promise.resolve()
    try {
      await left.start()
      await right.start()
      await Promise.all([left.sync(), right.sync()])
      interrupt = true
      await fs.writeAtomic('Left/sample.md', leftBytes, 1000)
      work = left.sync()
      await entered.promise
      await fs.writeAtomic('Right/sample.md', rightBytes, 2000)
      await right.sync()
      await work
      await left.sync()
      expect(failures).toEqual([])
      expect([...stored.keys()].sort()).toEqual(['Left/sample.md', 'Right/sample.md'])
      expect(publications.sort()).toEqual(['Left/sample.md', 'Right/sample.md'])
      expect(blobs.get(stored.get('Left/sample.md')!.sha)).toEqual(leftBytes)
      expect(blobs.get(stored.get('Right/sample.md')!.sha)).toEqual(rightBytes)
      expect(await fs.read('Right/sample.md')).toEqual(rightBytes)
      expect(left.engine.status.lastError).toBeNull()
      expect(Reflect.get(left, 'scanUploadFailure')).toBeUndefined()
      expect(Reflect.get(left, 'scanUploads').size).toBe(0)
      await left.close()
      expect(subscribers.size).toBe(1)
      const edited = new TextEncoder().encode('sample edit after sibling retirement')
      await fs.writeAtomic('Right/sample.md', edited, 3000)
      await right.sync()
      expect(failures).toEqual([])
      expect(blobs.get(stored.get('Right/sample.md')!.sha)).toEqual(edited)
      expect(await fs.read('Left/sample.md')).toEqual(leftBytes)
      expect(right.engine.status.lastError).toBeNull()
    } finally {
      await Promise.allSettled([work, left.close(), right.close()])
    }
  },
  15000
)
