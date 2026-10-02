// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
const service = vi.hoisted(() => ({
  connection: { value: { vaultId: '', deviceTokenId: '', pendingRevoke: [] } },
  forget: vi.fn(async () => {}),
  keeper: { read: vi.fn() },
}))
vi.mock('@/sync/SyncService', () => ({ SyncService: { getInstance: () => service } }))
import { prepareFixtureContext, restoreFixtureContext } from '@/testing/fixtureContext'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { buildFakeVault } from '../helpers/fakeVault'
import { readConnection } from '@/sync/connection'
import type { App } from 'obsidian'
describe('phone fixture context isolation', () => {
  it('keeps an inactive original ledger intact rather than restoring a dangling descriptor', async () => {
    const factory = new IDBFactory()
    vi.stubGlobal('indexedDB', factory)
    const original = await IndexedDbStateStore.open(factory, 'abele-sync-sample-original')
    await original.setMeta('sample-preserved', 'original durable bytes')
    await original.setCursor(42)
    original.close()
    const app = buildFakeVault([
      { path: '.abele-sync-ignore', content: 'original ignore' },
      { path: '.abele-script-managed', content: 'original sentinel' },
    ])
    service.keeper.read.mockImplementation(() => {
      service.connection.value = readConnection(app) as any
    })
    const descriptor = { stateId: 'sample-original', vaultId: 'sample-vault' }
    app.saveLocalStorage('abele-sync-ledger', descriptor)
    const workspace = { sample: true }
    ;(app.workspace as any).getLayout = () => workspace
    ;(app.workspace as any).changeLayout = vi.fn(async () => {})
    try {
      expect(await prepareFixtureContext(app as unknown as App, 'SamplePhoneFixture')).toBe(true)
      expect(app.loadLocalStorage('abele-sync-ledger')).toBeNull()
      const unchanged = await IndexedDbStateStore.open(factory, 'abele-sync-sample-original')
      expect(await unchanged.getCursor()).toBe(42)
      unchanged.close()
      await app.vault.adapter.mkdir('SamplePhoneFixture')
      await app.vault.adapter.writeBinary(
        'SamplePhoneFixture/owned.md',
        new TextEncoder().encode('owned').buffer
      )
      await app.vault.adapter.mkdir('SamplePhoneFixture-private')
      await app.vault.adapter.writeBinary(
        'SamplePhoneFixture-private/private.md',
        new TextEncoder().encode('private').buffer
      )
      app.saveLocalStorage('abele-sync-ledger', {
        stateId: 'sample-new',
        vaultId: 'sample-fixture',
      })
      const created = await IndexedDbStateStore.open(factory, 'abele-sync-sample-new')
      created.close()
      expect(await restoreFixtureContext(app as unknown as App)).toEqual({
        restored: true,
        errors: [],
      })
      expect(app.loadLocalStorage('abele-sync-ledger')).toEqual(descriptor)
      expect(await app.vault.adapter.exists('SamplePhoneFixture')).toBe(false)
      expect(await app.vault.adapter.exists('SamplePhoneFixture-private')).toBe(false)
      const restored = await IndexedDbStateStore.open(factory, 'abele-sync-sample-original')
      expect(await restored.getCursor()).toBe(42)
      expect(await restored.getMeta('sample-preserved')).toBe('original durable bytes')
      restored.close()
      expect((await factory.databases()).map((d) => d.name)).not.toContain('abele-sync-sample-new')
      expect(
        new TextDecoder().decode(await app.vault.adapter.readBinary('.abele-sync-ignore'))
      ).toBe('original ignore')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
