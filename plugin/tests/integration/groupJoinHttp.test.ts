// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { scopedApiServer } from '../helpers/scopedApiServer'
import { GroupJoinHttp } from '@/sync/scoped/groupJoinHttp'
import { SyncClient, sha256 } from '@abele/sync-core'
let s: Awaited<ReturnType<typeof scopedApiServer>> | undefined
afterEach(async () => {
  await s?.close()
  s = undefined
})
async function setup() {
  const root = process.env.ABELE_GROUP_API_FIXTURE
  if (!root) throw new Error('Explicit group API archive required')
  s = await scopedApiServer({
    root,
    commit: 'f927e62bb41817cd3cf0180e80f989e8c166ff1d',
    group: true,
  })
  const owner = await s.account('sample-owner@example.com'),
    recipient = await s.account('sample-recipient@example.com'),
    { vaultId } = await s.vault(owner.accountToken),
    { deviceToken } = await s.device(owner.accountToken, vaultId)
  const personal = new SyncClient({
      baseUrl: 'http://127.0.0.1',
      fetch: s.fetch,
      token: deviceToken,
    }).forVault(vaultId),
    bytes = new TextEncoder().encode('Sample root'),
    sha = await sha256(bytes)
  await personal.putBlob(sha, bytes)
  const result = await personal.commit([
    { op: 'create', path: 'Scattered/root.md', sha, size: bytes.length, mtime: 1 },
  ])
  const row = result.results[0] as any
  const grant = await s.fetch('http://127.0.0.1/v1/vaults/' + vaultId + '/grants/groups', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + owner.accountToken, 'content-type': 'application/json' },
    body: JSON.stringify({
      label: 'Sample group',
      root_file_id: row.file_id,
      expected_root_version: row.version_id,
      role: 'editor',
    }),
  })
  expect(grant.status).toBe(200)
  const g = await grant.json()
  const invitation = await s.fetch(
    'http://127.0.0.1/v1/vaults/' + vaultId + '/grants/groups/' + g.id + '/invitations',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + owner.accountToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        role: 'editor',
        intended_account_id: recipient.accountId,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      }),
    }
  )
  expect(invitation.status).toBe(200)
  return {
    recipient,
    invitation: (await invitation.json()).invitation_token as string,
    grantId: g.id,
    owner,
    vaultId,
  }
}
describe('reviewed group invitation/account HTTP integration', () => {
  it('accepts/discovers only scoped membership, recovers exact installation attempt and creates no personal member/device', async () => {
    const f = await setup(),
      port = new GroupJoinHttp({
        baseUrl: 'http://127.0.0.1',
        fetch: s!.fetch,
        enabled: () => true,
      }),
      account = await port.login('http://127.0.0.1', 'sample-recipient@example.com', 'pw')
    const first = await port.accept('http://127.0.0.1', account, f.invitation),
      replayed = await port.accept('http://127.0.0.1', account, f.invitation)
    expect(replayed).toEqual(first)
    expect((await port.discover('http://127.0.0.1', account))[0]).toMatchObject({
      grantId: f.grantId,
      memberId: first.memberId,
    })
    const request = {
        grantId: f.grantId,
        attemptId: 'sample-attempt',
        name: 'Sample recipient',
        platform: 'desktop' as const,
        role: 'editor' as const,
      },
      installed = await port.enrol('http://127.0.0.1', account, request)
    expect(await port.enrol('http://127.0.0.1', account, request)).toEqual(installed)
    expect(installed.token).toMatch(/^absi_/)
    expect(
      await s!.db
        .selectFrom('devices')
        .select('id')
        .where('account_id', '=', f.recipient.accountId)
        .execute()
    ).toEqual([])
    expect(
      await s!.db
        .selectFrom('vault_members')
        .select('vault_id')
        .where('account_id', '=', f.recipient.accountId)
        .execute()
    ).toEqual([])
  })
  it('keeps the original production management/discovery fence closed', async () => {
    await setup()
    const port = new GroupJoinHttp({
        baseUrl: 'http://127.0.0.1',
        fetch: s!.closedFetch,
        enabled: () => true,
      }),
      account = await port.login('http://127.0.0.1', 'sample-recipient@example.com', 'pw')
    await expect(port.discover('http://127.0.0.1', account)).rejects.toMatchObject({
      code: 'scoped_unavailable',
      status: 503,
    })
  })
})
