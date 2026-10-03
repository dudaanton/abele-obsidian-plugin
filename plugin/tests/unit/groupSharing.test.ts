import { describe, it, expect, vi } from 'vitest'
import { GroupSharingFlow, InitialAssetBatch, type GroupPreview } from '@/sync/sharing/groupSharing'
const preview: GroupPreview = {
  root: {
    fileId: 'sample-root',
    versionId: 'root-v1',
    sha: 'a'.repeat(64),
    path: 'Scattered/root.md',
    eligible: true,
  },
  generation: 'sample-certified',
  complete: true,
  certified: true,
  notes: [
    {
      fileId: 'sample-member',
      versionId: 'member-v1',
      sha: 'b'.repeat(64),
      path: 'Elsewhere/member.md',
      eligible: true,
    },
  ],
  anchors: [
    {
      fileId: 'sample-anchor',
      versionId: 'anchor-v1',
      sha: 'c'.repeat(64),
      path: 'Another/subgroup.md',
      eligible: true,
    },
  ],
  relations: [
    {
      sourceId: 'sample-member',
      sourceVersion: 'member-v1',
      targetId: 'sample-root',
      targetVersion: 'root-v1',
      tokenKey: '[[Scattered/root]]',
      anchor: false,
    },
  ],
  uncertain: [],
}
function setup() {
  const port = {
    preview: vi.fn(async () => structuredClone(preview)),
    authorize: vi.fn(async () => ({
      facet: 'account' as const,
      ownerVaultId: 'sample-vault',
      authenticatedAt: 1000,
      expiresAt: 99999,
    })),
    create: vi.fn(async () => ({
      id: 'sample-grant',
      rootId: 'sample-root',
      rootVersion: 'root-v1',
      role: 'editor' as const,
      revision: 0,
      state: 'preparing',
    })),
    approve: vi.fn(async () => {}),
    certified: vi.fn(async () => true),
  }
  return {
    port,
    flow: new GroupSharingFlow(
      'sample-vault',
      port,
      () => true,
      () => 2000
    ),
  }
}
describe('disabled owner group wizard exact previews', () => {
  it('default fence makes no preview or management request', async () => {
    const s = setup()
    await expect(
      new GroupSharingFlow('sample-vault', s.port).review('sample-root', 'editor', 'Sample group')
    ).rejects.toThrow(/disabled/)
    expect(s.port.preview).not.toHaveBeenCalled()
  })
  it('creates only the reviewed stable root and explicit relations; it does not remap scattered paths', async () => {
    const s = setup(),
      shown = await s.flow.review('sample-root', 'editor', 'Sample group')
    const grant = await s.flow.confirm(shown, 'invented-password')
    expect(s.port.create).toHaveBeenCalledWith(expect.anything(), {
      label: 'Sample group',
      rootId: 'sample-root',
      rootVersion: 'root-v1',
      role: 'editor',
    })
    expect(grant.state).toBe('preparing')
    expect(s.port.approve).not.toHaveBeenCalled()
    await s.flow.approveRelations(shown)
    expect(s.port.approve).toHaveBeenCalledWith(expect.anything(), grant, preview.relations[0])
  })
  it('stale root/version, uncertified scope, uncertain anchor or closed review never creates authority', async () => {
    const s = setup(),
      shown = await s.flow.review('sample-root', 'editor', 'Sample group')
    s.port.preview.mockResolvedValue({
      ...preview,
      root: { ...preview.root, versionId: 'new-root' },
    })
    await expect(s.flow.confirm(shown, 'invented-password')).rejects.toThrow(/preview|root/)
    expect(s.port.create).not.toHaveBeenCalled()
    s.port.preview.mockResolvedValue({ ...preview, certified: false })
    await expect(s.flow.review('sample-root', 'editor', 'Sample')).rejects.toThrow(/certified/)
    s.port.preview.mockResolvedValue(preview)
    const fresh = await s.flow.review('sample-root', 'editor', 'Fresh')
    s.flow.close()
    await expect(s.flow.confirm(fresh, 'invented-password')).rejects.toThrow(/review/)
    expect(s.port.create).not.toHaveBeenCalled()
  })
  it('late old preview cannot replace the new audience/root confirmation', async () => {
    const s = setup()
    let finish!: (p: GroupPreview) => void
    s.port.preview.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r
        })
    )
    const pending = s.flow.review('sample-root', 'editor', 'Old').catch((e) => e)
    s.flow.close()
    const shown = await s.flow.review('sample-root', 'editor', 'New')
    finish(preview)
    expect(await pending).toBeInstanceOf(Error)
    await s.flow.confirm(shown, 'invented-password')
    expect(s.port.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ label: 'New' })
    )
  })
})
const entry = {
  target: {
    fileId: 'sample-image',
    versionId: 'image-v1',
    sha: 'd'.repeat(64),
    path: 'Flat/sample.png',
    eligible: true,
  },
  sponsors: [
    {
      fileId: 'sample-member',
      versionId: 'member-v1',
      admissionGeneration: 1,
      inScope: true as const,
      intrinsic: true as const,
    },
  ],
  reason: 'initial-batch' as const,
}
function batch() {
  const data = new Map<string, string>(),
    meta = {
      getMeta: (k: string) => data.get(k) ?? null,
      setMeta: (k: string, v: string | null) => {
        if (v === null) data.delete(k)
        else data.set(k, v)
      },
    },
    view = {
      grantId: 'sample-grant',
      revision: 0,
      withdrawalGeneration: 0,
      active: true,
      role: 'editor' as const,
      entries: [],
    },
    port = {
      view: vi.fn(async () => view),
      target: vi.fn(async () => entry.target),
      sponsors: vi.fn(async () => entry.sponsors),
      lookup: vi.fn(async () => false),
      add: vi.fn(async () => ({ ...view, revision: 1 })),
    }
  return {
    data,
    meta,
    port,
    flow: new InitialAssetBatch(
      meta,
      { vaultId: 'sample-vault', principal: 'sample-owner' },
      port,
      () => true
    ),
  }
}
describe('explicit reviewed existing-image batch', () => {
  it('lists exact multiple audiences and revalidates identities before any add', async () => {
    const s = batch(),
      r = await s.flow.review([entry], ['sample-grant'])
    await s.flow.confirm(r)
    expect(s.port.add).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'initial-batch',
        decisionDeviceId: 'sample-owner',
        target: entry.target,
        sponsors: entry.sponsors,
      })
    )
    expect(s.data.size).toBeGreaterThan(0)
  })
  it('target replacement or withdrawal while open invalidates the entire reviewed batch before mutation', async () => {
    const s = batch(),
      r = await s.flow.review([entry], ['sample-grant'])
    s.port.target.mockResolvedValue({ ...entry.target, versionId: 'replacement' })
    await expect(s.flow.confirm(r)).rejects.toThrow(/changed/)
    expect(s.port.add).not.toHaveBeenCalled()
  })
  it('recovers a lost initial-batch reply using the persisted exact request without a new review decision', async () => {
    const s = batch(),
      r = await s.flow.review([entry], ['sample-grant'])
    s.port.add.mockRejectedValueOnce(new Error('Synthetic lost response'))
    await expect(s.flow.confirm(r)).rejects.toThrow(/lost/)
    const request = structuredClone(s.port.add.mock.calls[0][0]),
      recovered = new InitialAssetBatch(
        s.meta,
        { vaultId: 'sample-vault', principal: 'sample-owner' },
        s.port,
        () => true
      ),
      shown = await recovered.resume(r.id)
    await recovered.confirm(shown)
    expect(s.port.add.mock.calls[1][0]).toEqual(request)
    s.port.add.mockClear()
    await recovered.confirm(shown)
    expect(s.port.add).not.toHaveBeenCalled()
  })
  it('two targets in one audience use current CAS and a lost response retries the same exact id/body', async () => {
    const s = batch(),
      second = {
        ...entry,
        target: { ...entry.target, fileId: 'second-image', path: 'Flat/second.png' },
      },
      r = await s.flow.review([entry, second], ['sample-grant'])
    s.port.target.mockImplementation(async (id) =>
      id === entry.target.fileId ? entry.target : second.target
    )
    let rev = 0
    s.port.view.mockImplementation(async () => ({
      grantId: 'sample-grant',
      revision: rev,
      withdrawalGeneration: 0,
      active: true,
      role: 'editor',
      entries: [],
    }))
    s.port.add.mockImplementation(async (req) => {
      expect(req.expectedRevision).toBe(rev)
      rev++
      return {
        grantId: 'sample-grant',
        revision: rev,
        withdrawalGeneration: 0,
        active: true,
        role: 'editor',
        entries: [],
      }
    })
    await s.flow.confirm(r)
    expect(s.port.add.mock.calls.map(([r]) => r.expectedRevision)).toEqual([0, 1])
  })
})
