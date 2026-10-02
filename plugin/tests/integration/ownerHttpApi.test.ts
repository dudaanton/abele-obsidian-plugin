// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { scopedApiServer } from '../helpers/scopedApiServer'
import { OwnerFolderHttpPort } from '@/sync/sharing/ownerHttp'
import { FolderSharingFlow } from '@/sync/sharing/folderSharing'
import { SyncClient, sha256 } from '@abele/sync-core'
let server: Awaited<ReturnType<typeof scopedApiServer>> | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})
async function setup() {
  server = await scopedApiServer()
  const { accountToken } = await server.account('sample-owner@example.com')
  const { vaultId } = await server.vault(accountToken, 'Sample folder grant')
  const { deviceToken } = await server.device(accountToken, vaultId, 'Sample owner')
  const client = new SyncClient({
    baseUrl: 'http://127.0.0.1',
    fetch: server.fetch,
    token: deviceToken,
  }).forVault(vaultId)
  const bytes = new TextEncoder().encode('sample note'),
    sha = await sha256(bytes)
  await client.putBlob(sha, bytes)
  await client.commit(
    [{ op: 'create', path: 'Agents/sample.md', sha, size: bytes.length, mtime: 1 }],
    'sample-seed'
  )
  return { vaultId, deviceToken, client }
}
describe('real disposable folder-management HTTP adapters', () => {
  it('uses paged stable personal preview and real owner login/grant/key handlers', async () => {
    const { vaultId, deviceToken } = await setup()
    const api = new OwnerFolderHttpPort({
      baseUrl: 'http://127.0.0.1',
      vaultId,
      email: 'sample-owner@example.com',
      deviceToken: () => deviceToken,
      fetch: server!.fetch,
      enabled: () => true,
    })
    const flow = new FolderSharingFlow(vaultId, api, () => true)
    const p = await flow.review('Agents/', 'editor', 'Sample grant')
    expect(p.files.map((f) => f.path)).toEqual(['Agents/sample.md'])
    expect(p.complete).toBe(true)
    const secret = await flow.confirm('pw')
    expect(secret.token).toMatch(/^absk_/)
    expect(secret.facet).toBe('scoped')
    expect((await server!.db.selectFrom('scope_grants').selectAll().execute()).length).toBe(1)
  })
  it('recovers the exact same machine credential after a successful issue response is lost', async () => {
    const { vaultId, deviceToken } = await setup()
    let dropped = false,
      issued: string | undefined
    const transport: typeof fetch = async (input, init) => {
      const response = await server!.fetch(input, init)
      if (init?.method === 'POST' && String(input).endsWith('/keys') && !dropped) {
        dropped = true
        issued = ((await response.clone().json()) as any).key_token
        throw new Error('Synthetic issue response lost')
      }
      return response
    }
    const api = new OwnerFolderHttpPort({
        baseUrl: 'http://127.0.0.1',
        vaultId,
        email: 'sample-owner@example.com',
        deviceToken: () => deviceToken,
        fetch: transport,
        enabled: () => true,
      }),
      flow = new FolderSharingFlow(vaultId, api, () => true)
    await flow.review('Agents/', 'editor', 'Sample retry grant')
    await expect(flow.confirm('pw')).rejects.toThrow(/response lost/)
    await new Promise((r) => setTimeout(r, 5))
    const result = await flow.confirm('pw')
    expect(result.token).toBe(issued)
    expect(await server!.db.selectFrom('scope_grants').select('id').execute()).toHaveLength(1)
    expect(await server!.db.selectFrom('scope_keys').select('id').execute()).toHaveLength(1)
  })
  it('keeps actual server buildApp management closed even after owner password login', async () => {
    const { vaultId, deviceToken } = await setup()
    const api = new OwnerFolderHttpPort({
      baseUrl: 'http://127.0.0.1',
      vaultId,
      email: 'sample-owner@example.com',
      deviceToken: () => deviceToken,
      fetch: server!.closedFetch,
      enabled: () => true,
    })
    await expect(api.authorize('pw')).rejects.toMatchObject({
      code: 'scoped_unavailable',
      status: 503,
    })
    expect(await server!.db.selectFrom('scope_grants').selectAll().execute()).toEqual([])
  })
  it('does not substitute personal authority on a wrong password or foreign owner', async () => {
    const { vaultId, deviceToken } = await setup()
    const api = new OwnerFolderHttpPort({
      baseUrl: 'http://127.0.0.1',
      vaultId,
      email: 'sample-owner@example.com',
      deviceToken: () => deviceToken,
      fetch: server!.fetch,
      enabled: () => true,
    })
    await expect(api.authorize('invented-wrong-password')).rejects.toMatchObject({ status: 401 })
    await server!.account('sample-foreign@example.com')
    await expect(api.authorize('pw', 'sample-foreign@example.com')).rejects.toMatchObject({
      status: 403,
    })
    expect(await server!.db.selectFrom('scope_grants').selectAll().execute()).toEqual([])
  })
})
