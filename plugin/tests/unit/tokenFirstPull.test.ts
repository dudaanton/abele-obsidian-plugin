import { IDBFactory } from 'fake-indexeddb'
import { nativeTokenFixture } from '../helpers/nativeTokenFixture'
import { expect, it, vi } from 'vitest'
import { MemoryStateStore, sha256 } from '@abele/sync-core'
import { encodeAccessToken } from '@abele/sync-protocol'
import type { App } from 'obsidian'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { buildFakeVault } from '../helpers/fakeVault'

it.each([false, true])(
  'pulls a pre-token folder snapshot across pages into a populated vault without a directory scan per item (host=%s)',
  async (host) => {
    const scope = { kind: 'folder' as const, id: 'shared-folder', path: 'Shared sample' }
    const bytes = new TextEncoder().encode('seeded before token issuance')
    const sha = await sha256(bytes)
    const directories = Array.from({ length: 12 }, (_, i) => ({
      file_id: 'directory-' + i,
      version_id: 'directory-version-' + i,
      path: scope.path + '/section-' + i,
      kind: 'directory',
      mtime: 1000,
    }))
    const files = Array.from({ length: 1003 }, (_, i) => ({
      file_id: 'file-' + i,
      version_id: 'version-' + i,
      path: scope.path + '/section-' + (i % 12) + '/note-' + i + '.md',
      kind: 'note',
      sha,
      size: bytes.length,
      mtime: 1000,
    }))
    directories.unshift({
      file_id: scope.id,
      version_id: 'folder-version',
      path: scope.path,
      kind: 'directory',
      mtime: 1000,
    })
    const items = [...directories, ...files]
    const requests: URL[] = []
    const fetchPort: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      requests.push(url)
      if (url.pathname === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'folder-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000000, quota_bytes: null },
        })
      if (url.pathname === '/v2/manifest') {
        const offset = Number(url.searchParams.get('next') ?? 0)
        return Response.json({
          items: items.slice(offset, offset + 1000),
          cursor: 1100,
          next: offset + 1000 < items.length ? String(offset + 1000) : null,
        })
      }
      if (url.pathname === '/v2/changes')
        return Response.json({ items: [], cursor: 1100, next: null })
      if (url.pathname.endsWith('/content')) {
        const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range') ?? '')
        return range
          ? new Response(bytes.slice(Number(range[1]), Number(range[2]) + 1), {
              status: 206,
              headers: {
                'content-range': `bytes ${range[1]}-${range[2]}/${bytes.length}`,
                'content-length': String(Number(range[2]) - Number(range[1]) + 1),
              },
            })
          : new Response(bytes)
      }
      throw new Error('Unexpected request: ' + url.pathname)
    }
    const app = buildFakeVault(
      Array.from({ length: 120 }, (_, i) => ({
        path: 'Existing/section-' + i + '/local.md',
        content: 'untouched',
      }))
    )
    const fs = new ObsidianFileSystem(app as unknown as App, { preserveEmptyDirectories: true })
    const scans = vi.spyOn(ObsidianFileSystem.prototype, 'listDirectories')
    const progress: { stage: string; completed: number; total: number }[] = []
    const metadata = new MemoryStateStore()
    const runtime = new TokenEngineRuntime({
      id: 'folder-first-pull',
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
      pulling: (one) => {
        if (one) progress.push(one)
      },
      fetch: fetchPort,
      changed: () => {},
      failed: () => {},
      covers: async () => false,
    })
    let fixture: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
    try {
      if (host) {
        vi.stubGlobal('window', {
          indexedDB: new IDBFactory(),
          setTimeout,
          clearTimeout,
          setInterval,
          clearInterval,
        })
        fixture = await nativeTokenFixture(
          app,
          encodeAccessToken({ v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope }),
          fetchPort
        )
      } else await runtime.sync()
      for (const item of files)
        expect(await app.vault.adapter.read(item.path)).toBe(new TextDecoder().decode(bytes))
      for (const item of directories)
        expect(await app.vault.adapter.stat(item.path)).toMatchObject({ type: 'folder' })
      expect(await app.vault.adapter.read('Existing/section-0/local.md')).toBe('untouched')
      expect(
        requests
          .filter((url) => url.pathname === '/v2/manifest')
          .map((url) => url.searchParams.get('next'))
      ).toEqual([null, '1000'])
      if (!host)
        expect(progress.at(-1)).toEqual({
          stage: 'Receiving files',
          completed: items.length,
          total: items.length,
        })
      expect(scans.mock.calls.length).toBeLessThanOrEqual(2)
    } finally {
      await fixture?.host.close()
      await runtime.disconnect()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  },
  20000
)
