import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { sha256 } from '@abele/sync-sdk/core'
import { ExchangeTrace } from '@/sync/exchangeTrace'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { desktopFsPort } from '../helpers/desktopRequire'
import { withDesktopFs } from '../helpers/fakeDesktopFs'
import { buildFakeVault } from '../helpers/fakeVault'
import { nativeTokenFixture } from '../helpers/nativeTokenFixture'
import { assertSmallPullBounds } from '../helpers/smallPullBounds'

it('keeps a production-host file pull with implicit folders within the bridge bound', async () => {
  const app = buildFakeVault([])
  withDesktopFs(app)
  const scope = { kind: 'folder' as const, id: 'sample-root', path: 'Container/Shared' }
  const bytes = new TextEncoder().encode('sample bytes')
  const sha = await sha256(bytes)
  await app.vault.adapter.mkdir(scope.path)
  const events: { operation: string; paths?: readonly string[] }[] = []
  let capturing = false
  let evidence: ReturnType<ExchangeTrace['snapshot']>['firstSync']['pulls'] | undefined
  const begin = ExchangeTrace.prototype.beginPull
  const record = ExchangeTrace.prototype.record
  vi.spyOn(ExchangeTrace.prototype, 'record').mockImplementation(function (
    this: ExchangeTrace,
    operation,
    started,
    outcome,
    paths
  ) {
    if (capturing) events.push({ operation, paths: paths && [...paths] })
    return record.call(this, operation, started, outcome, paths)
  })
  vi.spyOn(ExchangeTrace.prototype, 'beginPull').mockImplementation(function (
    this: ExchangeTrace,
    size,
    path,
    prefetchedRequests
  ) {
    const finish = begin.call(this, size, path, prefetchedRequests)
    capturing = true
    return (complete) => {
      finish(complete)
      capturing = false
      evidence = this.snapshot().firstSync.pulls
    }
  })
  const encoded = encodeAccessToken({
    v: 1,
    address: 'https://sync.example.invalid',
    key: 'a'.repeat(43),
    scope,
  })
  const item = {
    file_id: 'sample-file',
    version_id: 'sample-version',
    path: scope.path + '/Notes/sample.md',
    kind: 'note',
    sha,
    size: bytes.length,
    mtime: 1000,
  }
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: 'sample-token',
        space_id: 'sample-space',
        scope,
        status: 'active',
        limits: { max_file_bytes: 1000000, quota_bytes: null },
      })
    if (url.pathname === '/v2/manifest') {
      // Earlier deliveries can leave owned staging warm while file parents are still absent.
      const id = TokenConnectionRegistry.open(app).records()[0].id
      await app.vault.adapter.mkdir('.abele-sync/connections/' + id + '/writes')
      return Response.json({ items: [item], cursor: 1, next: null })
    }
    if (url.pathname === '/v2/changes') return Response.json({ items: [], cursor: 1, next: null })
    if (url.pathname === '/v2/commit') {
      const ops = JSON.parse(String(init?.body)).ops as { op: string; path: string }[]
      return Response.json({
        cursor: 1,
        results: ops.map((op, i) => ({
          status: 'applied',
          file_id: 'directory-' + i,
          version_id: 'directory-version-' + i,
          path: op.path,
          mtime: 1000,
          seq: 1,
          sha: '0'.repeat(64),
          size: 0,
        })),
      })
    }
    if (url.pathname.endsWith('/content'))
      return new Response(bytes.slice(), {
        status: 206,
        headers: { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` },
      })
    throw new Error('Unexpected request: ' + url.pathname)
  }
  const factory = new IDBFactory()
  vi.stubGlobal('window', {
    indexedDB: factory,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  })
  desktopFsPort(Reflect.get(app.vault.adapter, 'fsPromises'))
  let fixture: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  try {
    fixture = await nativeTokenFixture(app, encoded, transport, factory)
    console.log('[implicit folder pull]', JSON.stringify({ evidence, events }))
    expect(evidence!.small.count).toBe(1)
    assertSmallPullBounds(evidence!.small.max)
    expect(await app.vault.adapter.read(item.path)).toBe('sample bytes')
  } finally {
    await fixture?.host.close()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
