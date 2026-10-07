import { describe, it, expect, vi } from 'vitest'
import { MemoryStateStore } from '@abele/sync-core'
import { ExistingPrivateConfirmation } from '@/sync/publication/existingPrivateConfirmation'
import {
  PublicationDecisionStore,
  type ExistingPublicationObservation,
} from '@/sync/publication/publicationDecision'
import type { OwnerAdd } from '@/sync/sharing/sponsoredAssets'
const binding = {
  localVault: 'sample-local',
  issuer: 'https://sync.example',
  vaultId: 'sample-vault',
  principal: 'sample-device',
  facet: 'personal' as const,
  grantId: null,
}
function setup() {
  const meta = new MemoryStateStore(),
    store = new PublicationDecisionStore(meta)
  let observation: ExistingPublicationObservation = {
    binding,
    target: {
      fileId: 'private-id',
      versionId: 'private-v1',
      sha: 'a'.repeat(64),
      path: 'Assets/private.png',
      eligible: true,
    },
    sponsor: {
      fileId: 'note-id',
      versionId: 'note-v1',
      path: 'Shared/note.md',
      admissionGeneration: 1,
      intrinsic: true,
      inScope: true,
    },
    audience: {
      grantId: 'sample-grant',
      label: 'Sample audience',
      active: true,
      alreadyShared: false,
      revision: 0,
      withdrawalGeneration: 0,
    },
    linked: true,
  }
  const requests: OwnerAdd[] = [],
    applied = new Set<string>()
  let loseReply = false,
    held = true
  const port = {
    observe: vi.fn(async () => structuredClone(observation)),
    held: () => held,
    add: vi.fn(async (request: OwnerAdd) => {
      expect(
        (
          await store.getExisting(
            (await coordinator.questions())[0]?.exposureKey ??
              (await store.existing(binding))[0].exposureKey
          )
        )?.request
      ).toEqual(request)
      requests.push(structuredClone(request))
      applied.add(request.intentId)
      observation.audience.alreadyShared = true
      observation.audience.revision = 1
      if (loseReply) {
        loseReply = false
        throw new Error('reply lost')
      }
    }),
  }
  const make = () => new ExistingPrivateConfirmation(store, binding, ['sample-grant'], port)
  const coordinator = make(),
    candidates = [
      { sponsorId: 'note-id', targetId: 'private-id', targetPath: 'Assets/private.png' },
    ]
  return {
    store,
    port,
    coordinator,
    candidates,
    make,
    requests,
    applied,
    observation,
    loseReply: () => {
      loseReply = true
    },
    loseWriter: () => {
      held = false
    },
    change: (o: ExistingPublicationObservation) => {
      observation = o
    },
  }
}
describe('existing-private confirmation coordinator', () => {
  it('retains local link introductions until a second owner device discovers its shared audiences', async () => {
    const s = setup(),
      grants: string[] = []
    const coordinator = new ExistingPrivateConfirmation(s.store, binding, grants, s.port)
    const remaining = await coordinator.refresh(s.candidates)
    expect(remaining).toEqual(s.candidates)
    expect(s.port.observe).not.toHaveBeenCalled()
    grants.push('sample-grant')
    await coordinator.refresh(remaining)
    expect(await coordinator.questions()).toHaveLength(1)
    expect(s.port.add).not.toHaveBeenCalled()
  })
  it('pending and decline do not publish or hold the personal upload lane', async () => {
    const s = setup()
    await s.coordinator.refresh(s.candidates)
    const [q] = await s.coordinator.questions()
    expect(q.observation.audience.label).toBe('Sample audience')
    expect(s.port.add).not.toHaveBeenCalled()
    // The separate personal ledger settles both files while the question stays pending.
    const personal = new MemoryStateStore()
    await personal.transaction(async () => {
      for (const [path, id] of [
        ['Assets/private.png', 'private-id'],
        ['Notes/ordinary.md', 'ordinary-id'],
      ])
        await personal.put({
          path,
          wirePath: path,
          fileId: id,
          versionId: 'personal-v2',
          sha: 'b'.repeat(64),
          size: 1,
          mtime: 2,
        })
    })
    expect((await personal.get('Assets/private.png'))?.versionId).toBe('personal-v2')
    expect((await personal.get('Notes/ordinary.md'))?.versionId).toBe('personal-v2')
    expect(await s.coordinator.questions()).toHaveLength(1)
    expect(await s.coordinator.answer(q, false)).toBe(true)
    await s.make().refresh(s.candidates)
    expect(await s.make().questions()).toEqual([])
    expect(s.port.add).not.toHaveBeenCalled()
  })
  it('publishes once after yes, persisting the exact request first', async () => {
    const s = setup()
    await s.coordinator.refresh(s.candidates)
    const [q] = await s.coordinator.questions()
    expect(await s.coordinator.answer(q, true)).toBe(true)
    await s.coordinator.refresh(s.candidates)
    expect(await s.coordinator.answer(q, true)).toBe(false)
    expect(s.requests).toHaveLength(1)
    expect(s.requests[0]).toMatchObject({
      reason: 'confirmed-existing',
      decisionDeviceId: binding.principal,
      target: { fileId: 'private-id' },
    })
  })
  it('an ordinary sponsor resave does not require another question when the link remains', async () => {
    const s = setup()
    await s.coordinator.refresh(s.candidates)
    const [q] = await s.coordinator.questions()
    s.observation.sponsor.versionId = 'note-v2'
    expect(await s.coordinator.answer(q, true)).toBe(true)
    expect(s.requests[0].sponsors[0].versionId).toBe('note-v2')
  })
  it('reopens and retries the exact stable intent after a lost successful reply', async () => {
    const s = setup()
    await s.coordinator.refresh(s.candidates)
    const [q] = await s.coordinator.questions()
    s.loseReply()
    await expect(s.coordinator.answer(q, true)).rejects.toThrow('reply lost')
    await s.make().refresh([])
    expect(s.requests).toHaveLength(2)
    expect(s.requests[1]).toEqual(s.requests[0])
    expect(s.applied.size).toBe(1)
    expect((await s.store.existing(binding))[0].completed).toBe(true)
  })
  it.each(['link', 'identity', 'version', 'withdrawal', 'writer'])(
    'rejects a stale answer after %s changed',
    async (change) => {
      const s = setup()
      await s.coordinator.refresh(s.candidates)
      const [q] = await s.coordinator.questions()
      if (change === 'link') s.observation.linked = false
      if (change === 'identity') s.observation.target.fileId = 'recreated-id'
      if (change === 'version') s.observation.target.versionId = 'private-v2'
      if (change === 'withdrawal') s.observation.audience.withdrawalGeneration++
      if (change === 'writer') s.loseWriter()
      expect(await s.coordinator.answer(q, true)).toBe(false)
      expect(s.port.add).not.toHaveBeenCalled()
    }
  )
  it.each(['link', 'version', 'withdrawal'])(
    'never replays an approval after %s changes, even with a lost reply',
    async (change) => {
      const s = setup()
      await s.coordinator.refresh(s.candidates)
      const [q] = await s.coordinator.questions()
      s.loseReply()
      await expect(s.coordinator.answer(q, true)).rejects.toThrow('reply lost')
      if (change === 'link') s.observation.linked = false
      if (change === 'version') s.observation.target.versionId = 'private-v2'
      if (change === 'withdrawal') s.observation.audience.withdrawalGeneration++
      await s.make().refresh([])
      expect(s.requests).toHaveLength(1)
      expect((await s.store.existing(binding))[0].completed).toBe(true)
    }
  )
  it('refreshes pending dialog freshness for an explicit review without forgetting the decision identity', async () => {
    const s = setup()
    await s.coordinator.refresh(s.candidates)
    const [old] = await s.coordinator.questions()
    s.observation.target.versionId = 'private-v2'
    await s.coordinator.refresh([])
    const [fresh] = await s.coordinator.questions()
    expect(fresh.exposureKey).toBe(old.exposureKey)
    expect(fresh.fingerprint).not.toBe(old.fingerprint)
    expect(await s.coordinator.answer(old, true)).toBe(false)
    expect(await s.coordinator.answer(fresh, true)).toBe(true)
  })
  it('consumes durable questions and known non-audiences, retaining only unavailable observations', async () => {
    const s = setup()
    s.port.observe.mockResolvedValueOnce(undefined as any)
    expect(await s.coordinator.refresh(s.candidates)).toEqual(s.candidates)
    s.port.observe.mockResolvedValueOnce(null as any)
    expect(await s.coordinator.refresh(s.candidates)).toEqual([])
    expect(await s.coordinator.refresh(s.candidates)).toEqual([])
    expect(await s.coordinator.questions()).toHaveLength(1)
  })
  it('rechecks after approval persistence and before transport', async () => {
    const s = setup()
    await s.coordinator.refresh(s.candidates)
    const [q] = await s.coordinator.questions()
    const remember = s.store.rememberExisting.bind(s.store)
    vi.spyOn(s.store, 'rememberExisting').mockImplementation(async (d) => {
      await remember(d)
      if (d.state === 'approved') s.observation.linked = false
    })
    await s.coordinator.answer(q, true)
    expect(s.port.add).not.toHaveBeenCalled()
  })
})
