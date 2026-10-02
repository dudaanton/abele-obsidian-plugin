import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
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
