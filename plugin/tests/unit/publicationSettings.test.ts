import { describe, expect, it, vi } from 'vitest'
import { PublicationSettingsModel } from '@/sync/sharing/publicationSettings'
const owner = {
  facet: 'device' as const,
  principalId: 'sample-owner',
  localDeviceId: 'sample-owner',
  owner: true,
}
const entry = {
  kind: 'owner-extra' as const,
  target: {
    fileId: 'sample-image',
    versionId: 'sample-v1',
    sha: 'a'.repeat(64),
    path: 'Assets/sample.png',
    eligible: true,
  },
  sponsors: [
    {
      fileId: 'sample-note',
      versionId: 'note-v1',
      admissionGeneration: 1,
      inScope: true,
      intrinsic: true,
    },
  ],
  reason: 'confirmed-existing',
}
function setup() {
  let view = {
    grantId: 'sample-grant',
    revision: 1,
    withdrawalGeneration: 0,
    active: true,
    role: 'editor' as const,
    entries: [entry],
  }
  const port = { load: vi.fn(async () => view), unshare: vi.fn(async () => {}) }
  return {
    port,
    model: new PublicationSettingsModel(owner, port, () => true),
    change: (patch: Partial<typeof view>) => {
      view = { ...view, ...patch }
    },
  }
}
describe('owner publication settings review', () => {
  it('never reads private publication lists for a scoped or disabled context', async () => {
    const { port } = setup()
    const closed = new PublicationSettingsModel(owner, port, () => false)
    await expect(closed.load('sample-grant')).rejects.toThrow(/disabled/)
    const scoped = new PublicationSettingsModel(
      { ...owner, facet: 'scoped', owner: false },
      port,
      () => true
    )
    await expect(scoped.load('sample-grant')).rejects.toThrow(/owner/)
    expect(port.load).not.toHaveBeenCalled()
  })
  it('shows published no-longer-referenced only with complete local evidence and never auto-withdraws', async () => {
    const { model, port } = setup()
    await model.load('sample-grant')
    expect(model.referenceState('sample-image', { complete: false, referencedIds: [] })).toBe(
      'unknown'
    )
    expect(model.referenceState('sample-image', { complete: true, referencedIds: [] })).toBe(
      'no-longer-referenced'
    )
    expect(port.unshare).not.toHaveBeenCalled()
  })
  it('invalidates stale unshare preview instead of replaying across version/revision changes', async () => {
    const { model, port, change } = setup()
    await model.load('sample-grant')
    const review = model.reviewUnshare('sample-image')
    change({ revision: 2 })
    await expect(model.confirmUnshare(review)).rejects.toThrow(/changed/)
    expect(port.unshare).not.toHaveBeenCalled()
  })
  it('uses exact file identity/revision/withdrawal generation and stable intent', async () => {
    const { model, port } = setup()
    await model.load('sample-grant')
    const review = model.reviewUnshare('sample-image')
    await model.confirmUnshare(review)
    expect(port.unshare).toHaveBeenCalledWith({
      grantId: 'sample-grant',
      fileId: 'sample-image',
      revision: 1,
      withdrawalGeneration: 0,
      intentId: review.intentId,
    })
  })
})
