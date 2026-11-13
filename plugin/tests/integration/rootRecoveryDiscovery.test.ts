import { expect, it, vi } from 'vitest'
import { MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { IDBFactory } from 'fake-indexeddb'
import { buildFakeVault } from '../helpers/fakeVault'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ExecutableReview } from '@/sync/executableReview'
import { ignoreFor } from '@/sync/scope'

it.each(['restore', 'follow-server'] as const)(
  'uploads a fresh indexed create on the first explicit sync after root %s without watcher delivery',
  async (recovery) => {
    const app = buildFakeVault([])
    const host = await HostSyncStorage.open(new IDBFactory(), 'sample-host-' + recovery, app)
    const fs = new ObsidianFileSystem(app as never, { prepareStartupInventory: async () => {} })
    const bytes = new TextEncoder().encode('sample original')
    const scope = { kind: 'folder' as const, id: 'root', path: 'Shared' }
    const item = {
      file_id: 'sample-file',
      version_id: 'sample-version',
      path: 'Shared/sample.md',
      kind: 'note',
      sha: await sha256(bytes),
      size: bytes.length,
      mtime: 1000,
    }
    const committed: string[] = []
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000000, quota_bytes: null },
        })
      if (path === '/v2/manifest') return Response.json({ items: [item], cursor: 1, next: null })
      if (path === '/v2/changes') return Response.json({ items: [], cursor: 1, next: null })
      if (path.includes('/content')) {
        const range = new Headers(init?.headers).get('range')
        if (!range) return new Response(bytes)
        const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range)!
        return new Response(bytes.slice(Number(start), Number(end) + 1), {
          status: 206,
          headers: {
            'content-range': 'bytes ' + start + '-' + end + '/' + bytes.length,
            'content-length': String(Number(end) - Number(start) + 1),
          },
        })
      }
      if (path.startsWith('/v2/uploads/')) return new Response(null, { status: 204 })
      if (path === '/v2/commit') {
        const { ops } = JSON.parse(String(init?.body))
        return Response.json({
          cursor: 1,
          results: ops.map((op: typeof item) => {
            committed.push(op.path)
            return {
              status: 'applied',
              path: op.path,
              sha: op.sha ?? null,
              size: op.size ?? 0,
              mtime: op.mtime ?? 1000,
              file_id: 'new-file-' + op.path,
              version_id: 'new-version',
              seq: 1,
            }
          }),
        })
      }
      throw Error('Unexpected route: ' + path)
    })
    const metadata = new MemoryStateStore()
    const runtime = new TokenEngineRuntime({
      id: 'sample-connection',
      encoded: encodeAccessToken({
        v: 1,
        address: 'https://sync.example',
        key: 'a'.repeat(43),
        scope,
      }),
      fs,
      state: new MemoryStateStore(),
      reviews: {
        executables: new ExecutableReview(metadata),
        attachments: new AttachmentConsent(metadata),
        close: () => {},
      },
      fetch,
      changed: () => {},
      failed: () => {},
      covers: async () => false,
      scopeInput: async () => ({ key: 'sample', ignore: ignoreFor('.obsidian', null) }),
    })
    try {
      await runtime.sync()
      if (recovery === 'restore') {
        await app.vault.delete(app.vault.getFileByPath(item.path)!)
        runtime.scopeRootGone({ kind: 'deleted' })
        await runtime.restoreRoot()
      } else {
        scope.path = 'Renamed'
        item.path = 'Renamed/sample.md'
        await expect(runtime.sync()).rejects.toThrow(/Shared.*Renamed/)
        await runtime.followServerRoot()
      }
      expect(new TextDecoder().decode(await fs.read('Shared/sample.md'))).toBe('sample original')
      await fs.writeAtomic('Shared/resumed.md', new TextEncoder().encode('sample resumed'), 2000)
      await runtime.sync()
      expect(committed).toContain(scope.path + '/resumed.md')
      expect(committed).not.toContain('Shared/sample.md')
    } finally {
      await runtime.close()
      host.close()
    }
  }
)
