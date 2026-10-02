import { describe, expect, it, vi } from 'vitest'
import { SponsoredAssetService } from '@/sync/sharing/sponsoredAssets'
const owner = {
  facet: 'device' as const,
  principalId: 'sample-owner',
  localDeviceId: 'sample-owner',
  owner: true,
}
const sponsor = {
  fileId: 'sample-note',
  versionId: 'sample-note-v1',
  admissionGeneration: 1,
  inScope: true,
  intrinsic: true,
}
function setup() {
  let view = {
    grantId: 'sample-grant',
    revision: 1,
    withdrawalGeneration: 0,
    active: true,
    role: 'editor' as const,
    entries: [] as any[],
  }
  const port = {
    read: vi.fn(async () => view),
    mutate: vi.fn(async (_id: string, delta: any, revision: number, intentId: string) => {
      view = {
        ...view,
        revision: revision + 1,
        entries: delta.kind === 'add' ? [...view.entries, delta.entry] : [],
      }
      return view
    }),
    nativeCreate: vi.fn(async (_g: string, _request: any) => ({
      fileId: 'sample-native',
      versionId: 'sample-native-v1',
    })),
  }
  return {
    port,
    service: new SponsoredAssetService(port, () => true),
    change: (v: Partial<typeof view>) => {
      view = { ...view, ...v }
    },
  }
}
const request = () => ({
  grantId: 'sample-grant',
  expectedRevision: 1,
  withdrawalGeneration: 0,
  intentId: 'sample-intent',
  decisionDeviceId: 'sample-owner',
  target: {
    fileId: 'sample-asset',
    versionId: 'sample-asset-v1',
    sha: 'a'.repeat(64),
    path: 'Assets/sample.png',
    eligible: true,
  },
  sponsors: [sponsor],
  reason: 'confirmed-existing' as const,
})
describe('fenced sponsored extras and native creation', () => {
  it('is disabled by default without any network access', async () => {
    const { port } = setup()
    const service = new SponsoredAssetService(port)
    await expect(service.add(owner, request())).rejects.toThrow(/disabled/)
    expect(port.read).not.toHaveBeenCalled()
  })
  it('requires the owner device and independently in-scope intrinsic sponsors', async () => {
    const { service, port } = setup()
    await expect(
      service.add({ ...owner, facet: 'scoped', owner: false }, request())
    ).rejects.toThrow(/owner/)
    const r = request()
    r.decisionDeviceId = 'other-device'
    await expect(service.add(owner, r)).rejects.toThrow(/device/)
    r.decisionDeviceId = 'sample-owner'
    r.sponsors[0] = { ...sponsor, intrinsic: false }
    await expect(service.add(owner, r)).rejects.toThrow(/sponsor/)
    expect(port.mutate).not.toHaveBeenCalled()
  })
  it('sends only CAS delta with the same durable intent, never replaces another whole list', async () => {
    const { service, port } = setup()
    await service.add(owner, request())
    expect(port.mutate).toHaveBeenCalledWith(
      'sample-grant',
      expect.objectContaining({ kind: 'add' }),
      1,
      'sample-intent'
    )
  })
  it('holds stale CAS and withdrawal rather than re-adding from an old approval', async () => {
    const { service, change, port } = setup()
    change({ revision: 2 })
    await expect(service.add(owner, request())).rejects.toThrow(/revision/)
    change({ revision: 1, withdrawalGeneration: 1 })
    await expect(service.add(owner, request())).rejects.toThrow(/withdrawal/)
    expect(port.mutate).not.toHaveBeenCalled()
  })
  it('withdraws the last sponsor only on explicit complete admission transition, not partial inventory', async () => {
    const { service, port } = setup()
    await service.add(owner, request())
    await expect(
      service.departure(owner, 'sample-grant', 'sample-note', 2, false, 'depart')
    ).rejects.toThrow(/complete/)
    await service.departure(owner, 'sample-grant', 'sample-note', 2, true, 'depart')
    expect(port.mutate.mock.calls[1][1]).toMatchObject({
      kind: 'remove-sponsor',
      sponsorId: 'sample-note',
      withdrawWhenEmpty: true,
    })
  })
  it('native outside-prefix create requires editor and its own current principal upload proof, never known private SHA', async () => {
    const { service, port } = setup()
    const scoped = {
      facet: 'scoped' as const,
      principalId: 'sample-key',
      grantId: 'sample-grant',
      role: 'editor' as const,
    }
    const r = {
      grantId: 'sample-grant',
      path: 'Attachments/new.png',
      localCreateHandle: 'sample-create',
      sha: 'b'.repeat(64),
      eligible: true,
      sponsor,
      upload: {
        principalId: 'sample-key',
        grantId: 'sample-grant',
        sha: 'b'.repeat(64),
        entitlementId: 'sample-upload',
      },
    }
    expect(await service.createNative(scoped, r)).toEqual({
      fileId: 'sample-native',
      versionId: 'sample-native-v1',
    })
    r.upload.principalId = 'foreign-key'
    await expect(service.createNative(scoped, r)).rejects.toThrow(/upload/)
    expect(port.nativeCreate).toHaveBeenCalledTimes(1)
  })
  it('never exposes a hidden occupant or adopts bytes after a native collision', async () => {
    const { service, port } = setup()
    port.nativeCreate.mockRejectedValue(new Error('occupied hidden private title'))
    await expect(
      service.createNative(
        { facet: 'scoped', principalId: 'sample-key', grantId: 'sample-grant', role: 'editor' },
        {
          grantId: 'sample-grant',
          path: 'Attachments/new.png',
          localCreateHandle: 'sample-create',
          sha: 'b'.repeat(64),
          eligible: true,
          sponsor,
          upload: {
            principalId: 'sample-key',
            grantId: 'sample-grant',
            sha: 'b'.repeat(64),
            entitlementId: 'sample-upload',
          },
        }
      )
    ).rejects.toThrow('Destination unavailable; local work retained')
  })
})
