import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  existingPublicationQuestion,
  answerExistingPublication,
} from '@/sync/publication/publicationDecision'
import { openLinkSnapshots, type SnapshotDescriptor } from '@/sync/publication/snapshotDatabase'
const binding = {
  localVault: 'sample-local',
  issuer: 'https://sync.example',
  vaultId: 'sample-vault',
  principal: 'sample-device',
  facet: 'personal' as const,
  grantId: null,
}
function resources() {
  let descriptor: SnapshotDescriptor | null = null,
    sentinel = false
  return {
    loadDescriptor: () => descriptor,
    saveDescriptor: (v: SnapshotDescriptor) => {
      descriptor = v
    },
    hasSentinel: async () => sentinel,
    writeSentinel: async () => {
      sentinel = true
    },
    eraseDescriptor: () => {
      descriptor = null
    },
    eraseSentinel: () => {
      sentinel = false
    },
  }
}
describe('snapshot database recovery sentinel', () => {
  it('retains pending, decline and approval records across reopen in the separate publication database', async () => {
    const port = resources(),
      factory = new IDBFactory(),
      first = await openLinkSnapshots(factory, port, binding, () => true)
    const observation = {
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
        inScope: true,
        intrinsic: true,
      },
      audience: {
        grantId: 'audience-one',
        label: 'Sample audience',
        active: true,
        alreadyShared: false,
        revision: 0,
        withdrawalGeneration: 0,
      },
      linked: true,
    }
    const q = (await existingPublicationQuestion(observation))!
    await first.decisions.rememberExisting({ ...q, state: 'pending' })
    first.close()
    const next = await openLinkSnapshots(factory, port, binding, () => true)
    try {
      expect(await next.decisions.existing(binding)).toMatchObject([
        { state: 'pending', exposureKey: q.exposureKey },
      ])
      await next.decisions.rememberExisting(
        (await answerExistingPublication(q, observation, false))!
      )
      expect(
        await existingPublicationQuestion(
          observation,
          await next.decisions.getExisting(q.exposureKey)
        )
      ).toBeNull()
      const secondAudience = {
        ...observation,
        audience: { ...observation.audience, grantId: 'audience-two' },
      }
      const second = (await existingPublicationQuestion(secondAudience))!
      await next.decisions.rememberExisting(
        (await answerExistingPublication(second, secondAudience, true))!
      )
      expect(await next.decisions.existing(binding)).toMatchObject([
        { state: 'declined' },
        { state: 'approved' },
      ])
    } finally {
      next.close()
    }
  })
  it('never bootstraps an empty database when the existing device descriptor survives', async () => {
    const port = resources(),
      factory = new IDBFactory(),
      first = await openLinkSnapshots(factory, port, binding, () => true)
    const name = first.databaseName
    first.close()
    await new Promise<void>((resolve, reject) => {
      const r = factory.deleteDatabase(name)
      r.onsuccess = () => resolve()
      r.onerror = () => reject(r.error)
    })
    await expect(openLinkSnapshots(factory, port, binding, () => true)).rejects.toThrow(
      /recovery required/
    )
  })
  it('refuses a lost external sentinel even when descriptor and database survive', async () => {
    const port = resources(),
      factory = new IDBFactory(),
      first = await openLinkSnapshots(factory, port, binding, () => true)
    first.close()
    port.eraseSentinel()
    await expect(openLinkSnapshots(factory, port, binding, () => true)).rejects.toThrow(
      /recovery required/
    )
  })
  it('refuses missing descriptor with surviving sentinel and connection changes', async () => {
    const port = resources(),
      factory = new IDBFactory(),
      first = await openLinkSnapshots(factory, port, binding, () => true)
    first.close()
    await expect(
      openLinkSnapshots(factory, port, { ...binding, issuer: 'https://other.example' }, () => true)
    ).rejects.toThrow(/binding/)
    port.eraseDescriptor()
    await expect(openLinkSnapshots(factory, port, binding, () => true)).rejects.toThrow(
      /recovery required/
    )
  })
  it('reopens the same durable identity and retains unknown rather than granting an empty baseline', async () => {
    const port = resources(),
      factory = new IDBFactory(),
      first = await openLinkSnapshots(factory, port, binding, () => true)
    await first.snapshots.invalidate('sample-note', 'unintegrated pull')
    first.close()
    const next = await openLinkSnapshots(factory, port, binding, () => true)
    try {
      expect(await next.snapshots.get('sample-note')).toMatchObject({
        kind: 'unknown',
        reason: 'unintegrated pull',
      })
    } finally {
      next.close()
    }
  })
})
