import { IDBFactory } from 'fake-indexeddb'
import { TokenUi } from '@/sync/tokenUi'
import { TokenEngines } from '@/sync/tokenEngines'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { openDeviceReviews } from '@/sync/openDeviceReviews'
import { expect, it, vi } from 'vitest'
import { MemoryStateStore, sha256 } from '@abele/sync-core'
import { encodeAccessToken } from '@abele/sync-protocol'
import type { App } from 'obsidian'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { buildFakeVault } from '../helpers/fakeVault'

it.each([
  { host: false, reconnect: false, count: 1003 },
  { host: true, reconnect: false, count: 1003 },
  { host: true, reconnect: true, count: 3 },
])(
  'pulls a pre-token folder snapshot across pages into a populated vault without a directory scan per item (host=$host, reconnect=$reconnect)',
  async ({ host, reconnect, count }) => {
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
    const files = Array.from({ length: count }, (_, i) => ({
      file_id: 'file-' + i,
      version_id: 'version-' + i,
      path: scope.path + '/section-' + (i % 12) + '/sample-' + i + (i % 7 === 0 ? '.bin' : '.md'),
      kind: i % 7 === 0 ? 'attachment' : 'note',
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
    const code = {
      ...files[0],
      file_id: 'incoming-code',
      version_id: 'code-version',
      path: scope.path + '/section-0/sample.js.js',
      kind: 'attachment',
    }
    const items = [...directories, code, ...files]
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
      if (url.pathname === '/v2/commit') {
        const ops = JSON.parse(String(init?.body)).ops as { op: string; path: string }[]
        return Response.json({
          cursor: 1100,
          results: ops.map((op) => {
            expect(op.op).toBe('mkdir')
            const directory = directories.find((one) => one.path === op.path)!
            expect(directory).toBeDefined()
            return {
              status: 'applied',
              file_id: directory.file_id,
              version_id: directory.version_id,
              path: directory.path,
              mtime: directory.mtime,
              seq: 1100,
              sha: '0'.repeat(64),
              size: 0,
            }
          }),
        })
      }
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
      throw new Error('Unexpected request: ' + url.pathname + ' ' + String(init?.body))
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
    const reviews = {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    }
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
      reviews,
      pulling: (one) => {
        if (one) progress.push(one)
      },
      fetch: fetchPort,
      changed: () => {},
      failed: () => {},
      covers: async () => false,
    })
    let fixture: Awaited<ReturnType<typeof productionHost>> | undefined
    try {
      if (host) {
        vi.stubGlobal('window', {
          indexedDB: new IDBFactory(),
          setTimeout,
          clearTimeout,
          setInterval,
          clearInterval,
        })
        fixture = await productionHost(
          app,
          encodeAccessToken({ v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope }),
          fetchPort
        )
      } else await runtime.sync()
      expect(await app.vault.adapter.exists(code.path)).toBe(false)
      const activeReviews = fixture?.ui.reviews ?? reviews
      const [candidate] = await activeReviews.executables.pending()
      expect(candidate).toMatchObject({ path: code.path, kind: 'attachment' })
      for (const item of files)
        expect(await app.vault.adapter.read(item.path)).toBe(new TextDecoder().decode(bytes))
      for (const item of directories)
        expect(await app.vault.adapter.stat(item.path)).toMatchObject({ type: 'folder' })
      expect(await app.vault.adapter.read('Existing/section-0/local.md')).toBe('untouched')
      expect(
        requests
          .filter((url) => url.pathname === '/v2/manifest')
          .map((url) => url.searchParams.get('next'))
      ).toEqual(count > 1000 ? [null, '1000'] : [null])
      if (!host)
        expect(progress.at(-1)).toEqual({
          stage: 'Receiving files',
          completed: items.length,
          total: items.length,
        })
      expect(scans.mock.calls.length).toBeLessThanOrEqual(2)
      if (fixture && reconnect) {
        const firstScans = scans.mock.calls.length
        await fixture.ui.disconnect(fixture.id)
        expect(await activeReviews.executables.pending()).toEqual([])
        expect(fixture.ui.candidates.value).toEqual([])
        for (const item of files)
          expect(await app.vault.adapter.read(item.path)).toBe(new TextDecoder().decode(bytes))
        await fixture.ui.connect(
          encodeAccessToken({ v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope })
        )
        const next = fixture.ui.registry.records()[0].id
        expect(next).not.toBe(fixture.id)
        await fixture.ui.sync(next)
        const [fresh] = await activeReviews.executables.pending()
        expect(fresh.source.id).toBe(next)
        expect(fresh.id).not.toBe(candidate.id)
        await expect(fixture.ui.approve(candidate)).rejects.toThrow()
        await fixture.ui.approve(fresh)
        expect(scans.mock.calls.length - firstScans).toBeLessThanOrEqual(2)
      } else if (fixture) await fixture.ui.approve(candidate)
      else await activeReviews.executables.approve([candidate.id], runtime)
      expect(await app.vault.adapter.read(code.path)).toBe(new TextDecoder().decode(bytes))
    } finally {
      await fixture?.close()
      await runtime.disconnect()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  },
  20000
)

async function productionHost(
  app: ReturnType<typeof buildFakeVault>,
  token: string,
  transport: typeof fetch
) {
  const factory = new IDBFactory()
  const reviews = await openDeviceReviews(factory, 'sample-device')
  const keys = new Map<string, string>()
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, value: string) => {
      keys.set(id, value)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const registry = TokenConnectionRegistry.open(app)
  const ui = new TokenUi(registry, secrets, transport, reviews)
  const host = new TokenEngines(app as unknown as App, ui, secrets.get, {
    indexedDB: factory,
    fetch: transport,
    fallbackMs: 60000,
    pollMs: 60000,
    WebSocket: class {
      constructor() {
        throw new Error('No fixture socket')
      }
    } as never,
  })
  try {
    host.start()
    await ui.connect(token)
    const id = registry.records()[0].id
    await ui.sync(id)
    return {
      ui,
      host,
      id,
      close: async () => {
        await host.close()
        reviews.close()
      },
    }
  } catch (error) {
    await host.close()
    reviews.close()
    throw error
  }
}
