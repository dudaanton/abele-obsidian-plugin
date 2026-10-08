// @vitest-environment node
import { afterEach, describe, it, expect } from 'vitest'
import { scopedApiServer } from '../helpers/scopedApiServer'
import { SponsoredAssetsHttpPort } from '@/sync/sharing/sponsoredHttp'
import { SyncClient, createScopedClient, sha256, MemoryStateStore } from '@abele/sync-core'
import { ExistingPrivateConfirmation } from '@/sync/publication/existingPrivateConfirmation'
import { PublicationDecisionStore } from '@/sync/publication/publicationDecision'
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
    commit: 'f927e62bb41817cd3cf0180e80f989e8c166ff1d',
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
  it('keeps actual personal commits moving while pending and replays one consented operation after a lost reply', async () => {
    const f = await setup(),
      source = '[[sample-image.png]]',
      bytes = new TextEncoder().encode(source),
      sha = await sha256(bytes)
    await f.client.putBlob(sha, bytes)
    await f.client.commit([
      {
        op: 'modify',
        file_id: f.note.file_id,
        base_version_id: f.note.version_id,
        sha,
        size: bytes.length,
        mtime: 2,
      },
    ])
    const binding = {
      localVault: 'sample-local',
      issuer: 'http://127.0.0.1',
      vaultId: f.vaultId,
      principal: f.deviceId,
      facet: 'personal' as const,
      grantId: null,
    }
    const store = new PublicationDecisionStore(new MemoryStateStore())
    let lose = true
    const requests: unknown[] = []
    const port = {
      held: () => true,
      observe: async () => {
        const items = (await f.client.manifest(null)).items
        const target = items.find((i) => i.file_id === f.asset.file_id)!,
          note = items.find((i) => i.file_id === f.note.file_id)!
        const view = await f.owner.visibility(f.grantId, target.file_id),
          sponsor = await f.owner.sponsorProof(f.grantId, note.file_id)
        return {
          binding,
          target: {
            fileId: target.file_id,
            versionId: target.version_id,
            sha: target.sha!,
            path: target.path,
            eligible: true,
          },
          sponsor: { ...sponsor, path: note.path },
          audience: {
            grantId: f.grantId,
            label: view.label,
            active: true,
            alreadyShared: view.visible,
            revision: view.revision,
            withdrawalGeneration: view.withdrawalGeneration,
          },
          linked: new TextDecoder().decode(await f.client.getBlob(note.sha!)).includes(source),
        }
      },
      add: async (request: Parameters<typeof f.owner.add>[0]) => {
        requests.push(structuredClone(request))
        const result = await f.owner.add(request)
        if (lose) {
          lose = false
          throw new Error('Successful add reply lost')
        }
        return result
      },
    }
    const make = () => new ExistingPrivateConfirmation(store, binding, [f.grantId], port),
      coordinator = make()
    await coordinator.refresh([
      { sponsorId: f.note.file_id, targetId: f.asset.file_id, targetPath: f.asset.path },
    ])
    const [question] = await coordinator.questions()
    const ordinary = new TextEncoder().encode('ordinary personal work'),
      ordinarySha = await sha256(ordinary)
    await f.client.putBlob(ordinarySha, ordinary)
    await f.client.commit([
      {
        op: 'create',
        path: 'Private/ordinary.md',
        sha: ordinarySha,
        size: ordinary.length,
        mtime: 3,
      },
      {
        op: 'modify',
        file_id: f.asset.file_id,
        base_version_id: f.asset.version_id,
        sha: ordinarySha,
        size: ordinary.length,
        mtime: 3,
      },
    ])
    expect(
      (await f.client.manifest(null)).items.some((i) => i.path === 'Private/ordinary.md')
    ).toBe(true)
    expect((await f.owner.visibility(f.grantId, f.asset.file_id)).visible).toBe(false)
    expect(requests).toHaveLength(0)
    expect(await coordinator.answer(question, true)).toBe(false)
    await coordinator.refresh([])
    const [fresh] = await coordinator.questions()
    await expect(coordinator.answer(fresh, true)).rejects.toThrow('Successful add reply lost')
    await make().refresh([])
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(
      (await f.owner.read(f.grantId)).entries.filter((e) => e.target.fileId === f.asset.file_id)
    ).toHaveLength(1)
  })
  it('an owner device can read audience labels and target visibility without a fresh account sign-in', async () => {
    const f = await setup()
    expect(await f.owner.visibility(f.grantId, f.asset.file_id)).toMatchObject({
      grantId: f.grantId,
      label: 'Sample assets',
      targetFileId: f.asset.file_id,
      visible: false,
      targetVersionId: null,
    })
  })
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
    expect(await f.owner.visibility(f.grantId, fileId)).toMatchObject({
      visible: true,
      targetFileId: fileId,
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
