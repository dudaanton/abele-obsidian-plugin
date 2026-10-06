// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scopedApiServer } from '../helpers/scopedApiServer'
import { SponsoredAssetsHttpPort } from '@/sync/sharing/sponsoredHttp'
import { SyncClient, sha256 } from '@abele/sync-core'
import { SCOPED_VERSION_HEADER } from '@abele/sync-protocol'
const currentCommit = '5cd9207bdf676cf19097b374c0a623e7909aa25a'
function sponsoredPaths(vault: string, grant: string, note: string) {
  const owner = '/v1/vaults/' + vault + '/grants/' + grant + '/assets',
    scoped = '/v1/scoped/vaults/' + vault + '/grants/' + grant
  return [
    { method: 'GET', path: owner },
    { method: 'GET', path: owner + '/visibility/' + note },
    { method: 'GET', path: owner + '/sponsors/' + note + '/proof' },
    { method: 'POST', path: owner + '/add' },
    { method: 'POST', path: owner + '/mutate' },
    { method: 'GET', path: scoped + '/assets' },
    { method: 'GET', path: scoped + '/assets/sponsors/' + note + '/proof' },
    { method: 'GET', path: scoped + '/uploads/' + 'a'.repeat(64) + '/proof' },
    { method: 'POST', path: scoped + '/assets/native' },
  ]
}
async function assertSponsoredDenied(
  fetcher: typeof fetch,
  cases: ReturnType<typeof sponsoredPaths>,
  token: string,
  status: number
) {
  for (const route of cases) {
    const response = await fetcher('http://127.0.0.1' + route.path, {
      method: route.method,
      headers: {
        authorization: 'Bearer ' + token,
        ...(route.path.startsWith('/v1/scoped/') ? { [SCOPED_VERSION_HEADER]: '4' } : {}),
        ...(route.method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(route.method === 'POST' ? { body: '{}' } : {}),
    })
    if (response.status !== status)
      throw new Error(
        'Sponsored route availability guard: ' +
          route.method +
          ' ' +
          route.path +
          ' expected ' +
          status +
          ' got ' +
          response.status
      )
  }
}
async function realOwnerContext(s: Awaited<ReturnType<typeof scopedApiServer>>) {
  const owner = await s.account('sample-route-owner@example.com'),
    { vaultId } = await s.vault(owner.accountToken, 'Sample route isolation'),
    device = await s.device(owner.accountToken, vaultId),
    client = new SyncClient({
      baseUrl: 'http://127.0.0.1',
      fetch: s.fetch,
      token: device.deviceToken,
    }).forVault(vaultId),
    bytes = new TextEncoder().encode('sample intrinsic note'),
    sha = await sha256(bytes)
  await client.putBlob(sha, bytes)
  const result = await client.commit([
      { op: 'create', path: 'SharedSample/note.md', sha, size: bytes.length, mtime: 1 },
    ]),
    note = result.results[0] as any,
    response = await s.fetch('http://127.0.0.1/v1/vaults/' + vaultId + '/grants', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + owner.accountToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        label: 'Sample scoped grant',
        prefix: 'SharedSample/',
        role: 'editor',
      }),
    })
  expect(response.status).toBe(201)
  const grant = await response.json()
  await s.prepareFolder(owner.accountToken, vaultId, grant.id)
  return {
    owner,
    vaultId,
    device,
    note,
    grant,
    cases: sponsoredPaths(vaultId, grant.id, note.file_id),
  }
}
let server: Awaited<ReturnType<typeof scopedApiServer>> | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})
describe('reviewed server sponsored surface availability', () => {
  it('does not invent an extras API behind the existing owner-management fence', async () => {
    server = await scopedApiServer()
    const { accountToken } = await server.account('sample-availability@example.com'),
      { vaultId } = await server.vault(accountToken, 'Sample availability')
    const port = new SponsoredAssetsHttpPort({
      baseUrl: 'http://127.0.0.1',
      fetch: server.fetch,
      enabled: () => true,
    })
    await expect(port.read('sample-grant')).rejects.toMatchObject({
      code: 'sponsored_api_unavailable',
    })
    await expect(
      port.mutate(
        'sample-grant',
        { kind: 'withdraw', fileId: 'sample-file', expectedGeneration: 0 },
        0,
        'sample-intent'
      )
    ).rejects.toMatchObject({ code: 'sponsored_api_unavailable' })
    const path = '/v1/vaults/' + vaultId + '/grants/sample-grant/extras'
    const fenced = await server.closedFetch('http://127.0.0.1' + path, {
      headers: { authorization: 'Bearer ' + accountToken },
    })
    expect(fenced.status).toBe(503)
    const withoutEarlyFence = await server.fetch('http://127.0.0.1' + path, {
      headers: { authorization: 'Bearer ' + accountToken },
    })
    expect(withoutEarlyFence.status).toBe(404)
    const root = process.env.ABELE_SCOPED_API_FIXTURE!
    const context = await realOwnerContext(server)
    await assertSponsoredDenied(server.closedFetch, context.cases, context.device.deviceToken, 503)
    await assertSponsoredDenied(server.fetch, context.cases, context.device.deviceToken, 404)
    const schema = readFileSync(join(root, 'packages/protocol/src/scopedCommits.ts'), 'utf8')
    expect(schema).not.toContain('native_asset')
    expect(schema).not.toContain('sponsors')
  })
  it('the runtime guard detects accidental actual sponsored registration and an absent production fence', async () => {
    const root = process.env.ABELE_SCOPED_API_FIXTURE!
    server = await scopedApiServer({ root, commit: currentCommit, assets: true })
    const context = await realOwnerContext(server)
    await expect(
      assertSponsoredDenied(server.fetch, context.cases, context.device.deviceToken, 404)
    ).rejects.toThrow(/availability guard.*expected 404 got 200/)
    await expect(
      assertSponsoredDenied(server.fetch, context.cases, context.device.deviceToken, 503)
    ).rejects.toThrow(/availability guard.*expected 503 got 200/)
    await assertSponsoredDenied(server.closedFetch, context.cases, context.device.deviceToken, 503)
  })
})
