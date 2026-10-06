// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { scopedApiServer } from '../helpers/scopedApiServer'
import { OwnerFolderHttpPort } from '@/sync/sharing/ownerHttp'
import { SyncClient, sha256 } from '@abele/sync-core'
let s: Awaited<ReturnType<typeof scopedApiServer>> | undefined
afterEach(async () => {
  await s?.close()
  s = undefined
})
describe('strict owner group management HTTP', () => {
  it('creates only an exact owner root preview with a fresh owner session and holds stale root versions', async () => {
    const root = process.env.ABELE_SPONSORED_API_FIXTURE
    if (!root) throw new Error('Explicit reviewed group-owner API archive required')
    s = await scopedApiServer({
      root,
      commit: '5cd9207bdf676cf19097b374c0a623e7909aa25a',
      group: true,
    })
    const owner = await s.account('sample-group-owner@example.com'),
      { vaultId } = await s.vault(owner.accountToken),
      device = await s.device(owner.accountToken, vaultId),
      client = new SyncClient({
        baseUrl: 'http://127.0.0.1',
        fetch: s.fetch,
        token: device.deviceToken,
      }).forVault(vaultId),
      bytes = new TextEncoder().encode('Sample group root'),
      sha = await sha256(bytes)
    await client.putBlob(sha, bytes)
    const first = await client.commit([
        { op: 'create', path: 'Scattered/sample.md', sha, size: bytes.length, mtime: 1 },
      ]),
      item = first.results[0] as any,
      port = new OwnerFolderHttpPort({
        baseUrl: 'http://127.0.0.1',
        vaultId,
        email: 'sample-group-owner@example.com',
        deviceToken: () => device.deviceToken,
        fetch: s.fetch,
        enabled: () => true,
      }),
      session = await port.authorize('pw')
    const grant = await port.createGroup(session, {
      label: 'Sample project',
      rootId: item.file_id,
      rootVersion: item.version_id,
      role: 'editor',
    })
    expect(grant).toMatchObject({
      rootId: item.file_id,
      rootVersion: item.version_id,
      role: 'editor',
      state: 'preparing',
    })
    await expect(
      port.createGroup(session, {
        label: 'Stale root',
        rootId: item.file_id,
        rootVersion: 'not-current',
        role: 'editor',
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await s.db.selectFrom('scope_grants').select('id').execute()).toHaveLength(1)
    const memberBytes = new TextEncoder().encode(
        '---\ngroups: ["[[Scattered/sample]]"]\n---\nsample member'
      ),
      memberSha = await sha256(memberBytes)
    await client.putBlob(memberSha, memberBytes)
    const members = await client.commit([
      {
        op: 'create',
        path: 'Elsewhere/first.md',
        sha: memberSha,
        size: memberBytes.length,
        mtime: 2,
      },
      { op: 'create', path: 'Other/second.md', sha: memberSha, size: memberBytes.length, mtime: 2 },
    ])
    await s.prepareGroup(owner.accountToken, vaultId)
    const relation = (index: number) => ({
      sourceId: (members.results[index] as any).file_id,
      sourceVersion: (members.results[index] as any).version_id,
      targetId: item.file_id,
      targetVersion: item.version_id,
      tokenKey: 'scattered/sample.md',
      anchor: false,
    })
    const one = await port.approveGroup(session, grant, relation(0))
    expect(one).toMatchObject({ grantId: grant.id, expectedRevision: 0, revision: 1 })
    const two = await port.approveGroup(session, { ...grant, revision: one.revision }, relation(1))
    expect(two).toMatchObject({ grantId: grant.id, expectedRevision: 1, revision: 2 })
    expect(
      (
        await s.db
          .selectFrom('scope_grants')
          .select('acl_revision')
          .where('id', '=', grant.id)
          .executeTakeFirstOrThrow()
      ).acl_revision
    ).toBe(2)
  })
})
