// @vitest-environment node
import { afterEach, describe, it, expect } from 'vitest'
import { scopedApiServer } from '../helpers/scopedApiServer'
import { SponsoredAssetsHttpPort } from '@/sync/sharing/sponsoredHttp'
import { SyncClient, createScopedClient, sha256 } from '@abele/sync-core'
let s: Awaited<ReturnType<typeof scopedApiServer>> | undefined
afterEach(async () => {
  await s?.close()
  s = undefined
})
async function setup() {
  const root = process.env.ABELE_SPONSORED_API_FIXTURE
  if (!root) throw new Error('Explicit reviewed sponsored API archive required')
  s = await scopedApiServer({
    root,
    commit: 'b5357cff918028e1e58b443ccc22eed0093eb689',
    assets: true,
  })
  const { accountToken } = await s.account('sample-assets@example.com'),
    { vaultId } = await s.vault(accountToken),
    { deviceToken, deviceId } = await s.device(accountToken, vaultId),
    client = new SyncClient({
      baseUrl: 'http://127.0.0.1',
      fetch: s.fetch,
      token: deviceToken,
    }).forVault(vaultId)
  const make = async (path: string, bytes: Uint8Array) => {
    const sha = await sha256(bytes)
    await client.putBlob(sha, bytes)
    const result = await client.commit([{ op: 'create', path, sha, size: bytes.length, mtime: 1 }])
    return result.results[0] as any
  }
  const note = await make('Agents/sample.md', new TextEncoder().encode('sample note')),
    asset = await make('sample-image.png', new Uint8Array([1, 2, 3]))
  const r = await s.fetch('http://127.0.0.1/v1/vaults/' + vaultId + '/grants', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + accountToken, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: 'Agents/', label: 'Sample assets', role: 'editor' }),
  })
  expect(r.status).toBe(201)
  const grant = await r.json()
  await s.prepareFolder(accountToken, vaultId, grant.id)
  const issued = await s.fetch(
    'http://127.0.0.1/v1/vaults/' + vaultId + '/grants/' + grant.id + '/keys',
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + accountToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        attempt_id: 'sample-key-attempt',
        name: 'Sample agent',
        role: 'editor',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      }),
    }
  )
  expect(issued.status).toBe(201)
  const key = await issued.json()
  const owner = new SponsoredAssetsHttpPort({
      baseUrl: 'http://127.0.0.1',
      fetch: s.fetch,
      enabled: () => true,
      context: { facet: 'personal', vaultId, principalId: deviceId, token: () => deviceToken },
    }),
    scoped = new SponsoredAssetsHttpPort({
      baseUrl: 'http://127.0.0.1',
      fetch: s.fetch,
      enabled: () => true,
      context: { facet: 'scoped', vaultId, principalId: key.key_id, token: () => key.key_token },
    })
  return {
    owner,
    scoped,
    note,
    asset,
    vaultId,
    client,
    accountToken,
    deviceId,
    deviceToken,
    grantId: grant.id,
    key,
  }
}
describe('real reviewed sponsored wire and intrinsic-evidence boundary', () => {
  it.fails(
    'BUG: an owner device can read audience labels without a fresh account sign-in',
    async () => {
      const f = await setup()
      const response = await s!.fetch('http://127.0.0.1/v1/vaults/' + f.vaultId + '/grants', {
        headers: { authorization: 'Bearer ' + f.deviceToken },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toContainEqual(
        expect.objectContaining({ id: f.grantId, label: 'Sample assets' })
      )
    }
  )
  it('does not mistake missing extras and missing note proof for binary audience invisibility', async () => {
    const f = await setup(),
      bytes = new Uint8Array([4, 5, 6]),
      sha = await sha256(bytes)
    await f.client.putBlob(sha, bytes)
    const result = await f.client.commit([
      { op: 'create', path: 'Agents/visible-image.png', sha, size: bytes.length, mtime: 1 },
    ])
    const fileId = (result.results[0] as any).file_id
    await s!.prepareFolder(f.accountToken, f.vaultId, f.grantId)
    const scoped = await createScopedClient({
      baseUrl: 'http://127.0.0.1',
      fetch: s!.fetch,
      token: f.key.key_token,
      vaultId: f.vaultId,
      grantId: f.grantId,
      principalId: f.key.key_id,
      principalKind: 'key',
    })
    expect((await scoped.openSnapshot()).items.some((i) => i.file_id === fileId)).toBe(true)
    expect((await f.owner.read(f.grantId)).entries.some((e) => e.target.fileId === fileId)).toBe(
      false
    )
    await expect(f.owner.sponsorProof(f.grantId, fileId)).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    })
  })
  it('adds/replays/withdraws an owner extra through real wire deltas and never re-adds after withdrawal', async () => {
    const f = await setup()
    const generation = await s!.intrinsicGeneration(f.grantId, f.note.file_id)
    const add = {
      grantId: f.grantId,
      expectedRevision: 0,
      withdrawalGeneration: 0,
      intentId: 'sample-add',
      decisionDeviceId: f.deviceId,
      target: {
        fileId: f.asset.file_id,
        versionId: f.asset.version_id,
        sha: f.asset.sha,
        path: f.asset.path,
        eligible: true,
      },
      sponsors: [
        {
          fileId: f.note.file_id,
          versionId: f.note.version_id,
          admissionGeneration: generation,
          inScope: true as const,
          intrinsic: true as const,
        },
      ],
      reason: 'new-local' as const,
    }
    const applied = await f.owner.add(add)
    expect(applied.entries).toHaveLength(1)
    expect(await f.scoped.read(f.grantId)).toMatchObject({
      entries: [{ target: { path: 'sample-image.png' } }],
    })
    const removed = await f.owner.mutate(
      f.grantId,
      {
        kind: 'withdraw',
        fileId: f.asset.file_id,
        expectedGeneration: applied.withdrawalGeneration,
      },
      applied.revision,
      'sample-withdraw'
    )
    expect(removed.entries).toEqual([])
    expect((await f.owner.add(add)).entries).toEqual([])
  })
  it('creates a native flat-root asset with exact principal upload proof and rejects a private occupied path', async () => {
    const f = await setup(),
      client = await createScopedClient({
        baseUrl: 'http://127.0.0.1',
        fetch: s!.fetch,
        token: f.key.key_token,
        vaultId: f.vaultId,
        grantId: f.grantId,
        principalId: f.key.key_id,
        principalKind: 'key',
      })
    const bytes = new Uint8Array([0, 255, 2]),
      sha = await sha256(bytes)
    await client.putBlob(sha, bytes)
    const proof = await f.scoped.proof(f.grantId, sha),
      generation = await s!.intrinsicGeneration(f.grantId, f.note.file_id),
      native = {
        grantId: f.grantId,
        path: 'sample-native.png',
        localCreateHandle: 'sample-native-handle',
        sha,
        eligible: true,
        sponsor: {
          fileId: f.note.file_id,
          versionId: f.note.version_id,
          admissionGeneration: generation,
          inScope: true as const,
          intrinsic: true as const,
        },
        upload: proof,
      }
    const result = await f.scoped.nativeCreate(f.grantId, native)
    expect(await f.scoped.nativeCreate(f.grantId, native)).toEqual(result)
    expect(
      (await f.scoped.read(f.grantId)).entries.some((e) => e.target.path === 'sample-native.png')
    ).toBe(true)
    await client.putBlob(sha, bytes)
    const own = await f.scoped.proof(f.grantId, sha)
    await expect(
      f.scoped.nativeCreate(f.grantId, {
        ...native,
        path: f.asset.path,
        localCreateHandle: 'sample-collision',
        upload: own,
      })
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect(
      (await f.client.manifest(null)).items.find((i) => i.path === f.asset.path)?.file_id
    ).toBe(f.asset.file_id)
  })
  it('documents that no current read surface supplies a first intrinsic sponsor admission generation', async () => {
    const f = await setup()
    expect((await f.owner.read(f.grantId)).entries).toEqual([])
    const scoped = await createScopedClient({
        baseUrl: 'http://127.0.0.1',
        fetch: s!.fetch,
        token: f.key.key_token,
        vaultId: f.vaultId,
        grantId: f.grantId,
        principalId: f.key.key_id,
        principalKind: 'key',
      }),
      state = await scoped.state(),
      snapshot = await scoped.openSnapshot()
    expect(JSON.stringify({ state, snapshot })).not.toMatch(
      /admissionGeneration|admission_generation/
    )
    expect(snapshot.items.some((i: any) => i.file_id === f.note.file_id)).toBe(true)
    await f.client.commit([
      {
        op: 'move',
        file_id: f.note.file_id,
        base_version_id: f.note.version_id,
        to_path: 'Other/private.md',
      },
    ])
    await f.client.commit([
      {
        op: 'move',
        file_id: f.note.file_id,
        base_version_id: (await f.client.manifest(null)).items.find(
          (i) => i.file_id === f.note.file_id
        )!.version_id,
        to_path: 'Agents/sample.md',
      },
    ])
    await s!.prepareFolder(f.accountToken, f.vaultId, f.grantId)
    const generation = await s!.intrinsicGeneration(f.grantId, f.note.file_id)
    expect(generation).toBeGreaterThan(1)
    const current = (await f.client.manifest(null)).items.find((i) => i.file_id === f.note.file_id)!
    await expect(
      f.owner.add({
        grantId: f.grantId,
        expectedRevision: 0,
        withdrawalGeneration: 0,
        intentId: 'sample-guessed-generation',
        decisionDeviceId: f.deviceId,
        target: {
          fileId: f.asset.file_id,
          versionId: f.asset.version_id,
          sha: f.asset.sha,
          path: f.asset.path,
          eligible: true,
        },
        sponsors: [
          {
            fileId: current.file_id,
            versionId: current.version_id,
            admissionGeneration: 1,
            inScope: true,
            intrinsic: true,
          },
        ],
        reason: 'new-local',
      })
    ).rejects.toMatchObject({ code: 'conflict', status: 409 })
  })
})
