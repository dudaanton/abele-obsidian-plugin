import { expect, it, vi } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { SCAN_HASH_READY } from '@/sync/progressiveLocalScan'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ignoreFor } from '@/sync/scope'

it.each([false, true])(
  'settles every cold first-upload file with native sources=%s',
  async (native) => {
    const fs = new MemoryFileSystem(),
      state = new MemoryStateStore()
    const bytes = new TextEncoder().encode('sample content'),
      sha = await sha256(bytes)
    const paths = Array.from({ length: 3009 }, (_, n) => `Notes/sample-${n}.md`)
    for (const path of paths) await fs.writeAtomic(path, bytes, 1000)
    const ready = new Set<string>()
    const passes = new Set<object>()
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    Object.defineProperty(fs, 'trustedIndexIdentities', { value: true })
    Object.defineProperty(fs, Symbol.for('abele.sync.scan-upload-source-v1'), { value: native })
    Object.defineProperty(fs, SCAN_HASH_READY, {
      value: async (info: { path: string }, pass: object) => {
        passes.add(pass)
        return ready.has(info.path)
      },
    })
    Object.assign(fs, {
      fingerprint: async (path: string) => {
        if (!ready.has(path)) clock += 10
        ready.add(path)
        return { sha, size: bytes.length, mtime: 1000 }
      },
    })
    const uploaded = new Set<string>()
    const blobs = new Map<string, Uint8Array>()
    let cursor = 1
    const scope = { kind: 'folder' as const, id: 'sample-root', path: '/' }
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const route = new URL(String(input)).pathname
      if (route === '/v2/connection') {
        return Response.json({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000000, quota_bytes: null },
        })
      }
      if (route === '/v2/manifest' || route === '/v2/changes')
        return Response.json({ items: [], cursor, next: null })
      if (route.startsWith('/v2/uploads/')) {
        const hash = route.split('/').at(-1)!
        if (init?.method === 'HEAD')
          return new Response(null, { status: blobs.has(hash) ? 200 : 404 })
        if (init?.method === 'PUT') {
          const content = new Uint8Array(await new Response(init.body).arrayBuffer())
          expect(await sha256(content)).toBe(hash)
          blobs.set(hash, content)
          return new Response(null, { status: 204 })
        }
      }
      if (route === '/v2/commit') {
        const { ops } = JSON.parse(String(init?.body))
        return Response.json({
          cursor: ++cursor,
          results: ops.map(
            (op: { op: string; path: string; sha?: string; size?: number; mtime?: number }) => {
              if (op.op === 'create') {
                expect(blobs.get(op.sha!)).toEqual(bytes)
                uploaded.add(op.path)
              }
              return {
                status: 'applied',
                file_id: crypto.randomUUID(),
                version_id: crypto.randomUUID(),
                seq: cursor,
                path: op.path,
                sha: op.sha ?? null,
                size: op.size ?? 0,
                mtime: op.mtime ?? 0,
              }
            }
          ),
        })
      }
      throw Error('Unexpected route: ' + route)
    }
    const runtime = new TokenEngineRuntime({
      id: 'sample-connection',
      fs,
      state,
      fetch,
      encoded: encodeAccessToken({
        v: 1,
        address: 'https://sync.example',
        key: 'a'.repeat(43),
        scope,
      }),
      reviews: {
        executables: new ExecutableReview(state),
        attachments: new AttachmentConsent(state),
        close: () => {},
      },
      changed: () => {},
      failed: () => {},
      covers: async () => false,
      scopeInput: async () => ({ key: 'sample', ignore: ignoreFor('.obsidian', null) }),
    })
    try {
      await runtime.sync()
      expect([...uploaded].sort()).toEqual([...paths].sort())
      expect(runtime.engine.status.pending).toBe(0)
      if (native) expect(passes.size).toBe(1)
      else expect(passes.size).toBeGreaterThan(1)
    } finally {
      await runtime.close()
      vi.restoreAllMocks()
    }
  },
  30000
)
