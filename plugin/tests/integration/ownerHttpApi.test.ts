// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { scopedApiServer } from '../helpers/scopedApiServer'
import { OwnerFolderHttpPort } from '@/sync/sharing/ownerHttp'
import { FolderSharingFlow } from '@/sync/sharing/folderSharing'
import { OwnerGroupRootFlow } from '@/sync/sharing/ownerGroupRoot'
import { SyncClient, sha256 } from '@abele/sync-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawnCollaborationStandServer } from '../e2e/helpers/collaborationStandHarness'
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
  it('starts unchanged deployment server modules and uses actual owner-authenticated preparation routes', async () => {
    const scratch = fileURLToPath(new URL('../../../.scratch/', import.meta.url))
    mkdirSync(scratch, { recursive: true })
    const work = mkdtempSync(join(scratch, 'stand-harness-smoke-'))
    let stand: Awaited<ReturnType<typeof spawnCollaborationStandServer>> | undefined
    try {
      stand = await spawnCollaborationStandServer(
        process.env.ABELE_SCOPED_API_FIXTURE!,
        '80bc7c666ac54cc186696ebdaaccd2d9e7a735ba',
        work
      )
      const caps = await (await globalThis.fetch(stand.url + '/v1/capabilities')).json()
      expect(caps.scoped.enabled).toBe(true)
      expect(caps.scoped.modes).toMatchObject({ folder: true, group: true })
      await expect(
        stand.prepare('invented-invalid-token', 'sample-vault', 'sample-grant')
      ).rejects.toThrow('preparation refused: 401')
      await expect(stand.prepareGroup('invented-invalid-token', 'sample-vault')).rejects.toThrow(
        'preparation refused: 401'
      )
      expect(
        (await globalThis.fetch(stand.url + '/__disposable/prepare', { method: 'POST' })).status
      ).toBe(404)
    } finally {
      await stand?.stop()
      rmSync(work, { recursive: true, force: true })
    }
  }, 45000)
  it('prepares production groups from committed server evidence and retains explicit unavailable recovery', async () => {
    server = await scopedApiServer({
      root: process.env.ABELE_SCOPED_API_FIXTURE!,
      commit: '80bc7c666ac54cc186696ebdaaccd2d9e7a735ba',
      group: true,
    })
    const { accountToken } = await server.account('sample-group-owner@example.com')
    const { vaultId } = await server.vault(accountToken, 'Sample evidence vault')
    const { deviceToken } = await server.device(accountToken, vaultId, 'Sample evidence device')
    const client = new SyncClient({
      baseUrl: 'http://127.0.0.1',
      fetch: server.fetch,
      token: deviceToken,
    }).forVault(vaultId)
    for (const [path, text] of [
      ['Notes/sample-root.md', 'Sample root'],
      ['Elsewhere/sample-member.md', '---\ngroups: ["[[Notes/sample-root]]"]\n---\nSample member'],
    ]) {
      const bytes = new TextEncoder().encode(text),
        sha = await sha256(bytes)
      await client.putBlob(sha, bytes)
      await client.commit(
        [{ op: 'create', path, sha, size: bytes.length, mtime: 1 }],
        crypto.randomUUID()
      )
    }
    const manifest = await client.manifest()
    const row = manifest.items.find((file) => file.path === 'Notes/sample-root.md')!
    const root = { fileId: row.file_id, versionId: row.version_id, sha: row.sha, path: row.path }
    const requests: { path: string; body: unknown; account: boolean }[] = []
    const port = new OwnerFolderHttpPort({
      baseUrl: 'http://127.0.0.1',
      vaultId,
      deviceToken: () => deviceToken,
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname
        if (path.includes('/grants/groups'))
          requests.push({
            path,
            body: init?.body ? JSON.parse(String(init.body)) : null,
            account:
              new Headers(init?.headers).get('authorization')?.startsWith('Bearer abst_') === true,
          })
        return server!.fetch(input, init)
      },
    })
    const flow = new OwnerGroupRootFlow(
      port,
      async () => root,
      () => true
    )
    try {
      const shown = await flow.review(root.fileId, 'editor', 'Sample evidence group')
      const grant = await flow.confirm(shown, 'pw', 'sample-group-owner@example.com')
      expect(grant.state).toBe('active')
      expect(requests[0]).toEqual({
        path: `/v1/vaults/${vaultId}/grants/groups`,
        account: true,
        body: {
          label: shown.label,
          root_file_id: root.fileId,
          expected_root_version: root.versionId,
          role: 'editor',
        },
      })
      expect(
        await server.intrinsicGeneration(
          grant.id,
          manifest.items.find((file) => file.path === 'Elsewhere/sample-member.md')!.file_id
        )
      ).toBeGreaterThan(0)
      const session = await port.authorize('pw', 'sample-group-owner@example.com')
      await port.prepareGroup(session, grant)
      expect(requests.at(-1)).toEqual({
        path: `/v1/vaults/${vaultId}/grants/groups/prepare`,
        body: null,
        account: true,
      })
      await server.db
        .updateTable('scope_group_progress')
        .set({ status: 'unavailable' })
        .where('vault_id', '=', vaultId)
        .execute()
      const unavailable = await server.fetch(
        `http://127.0.0.1/v1/vaults/${vaultId}/grants/groups/prepare`,
        { method: 'POST', headers: { authorization: 'Bearer ' + accountToken } }
      )
      expect(unavailable.status).toBe(503)
      expect((await unavailable.json()).error).toMatchObject({
        code: 'scope_unavailable',
        message: 'group evidence unavailable; reviewed rebuild required',
      })
      const held = await flow.review(root.fileId, 'reader', 'Sample held group')
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(
          flow.confirm(held, 'pw', 'sample-group-owner@example.com')
        ).rejects.toMatchObject({
          code: 'scope_unavailable',
          status: 503,
          message: 'Sharing API refused request: scope_unavailable',
        })
        expect(
          await server.db
            .selectFrom('scope_grants')
            .select('id')
            .where('vault_id', '=', vaultId)
            .execute()
        ).toHaveLength(2)
      }
    } finally {
      flow.close()
    }
  })

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
    await expect(flow.confirm('pw')).rejects.toMatchObject({
      code: 'network_unavailable',
      status: 0,
    })
    expect(dropped).toBe(true)
    expect(issued).toMatch(/^absk_[A-Za-z0-9_-]{43}$/)
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
