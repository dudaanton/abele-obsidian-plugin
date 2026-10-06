// @vitest-environment node
import { afterEach, it, expect, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ref } from 'vue'
import { SyncService } from '@/sync/SyncService'
import {
  enableOwnerPublicationFixture,
  disableOwnerPublicationFixture,
} from '@/testing/ownerPublicationFixture'
import { buildFakeVault } from '../helpers/fakeVault'
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it.each([true, false])(
  'remote HTTPS fixture activation is restricted to the explicit test-sharing build (%s)',
  async (enabled) => {
    vi.stubGlobal('__ABELE_TEST_SHARING__', enabled)
    vi.stubGlobal('window', { indexedDB: new IDBFactory() })
    const app = buildFakeVault([])
    app.saveLocalStorage('task14-isolated-fixture', { root: 'Agents' })
    const service = {
      connection: ref({
        serverUrl: 'https://stand.example',
        vaultId: 'sample-vault',
        deviceId: 'sample-device',
      }),
      deps: {},
      serialise: async (fn: () => Promise<unknown>) => fn(),
      runner: { teardown: async () => {}, reconcile: async () => {} },
    }
    vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as any)
    if (enabled) {
      expect(await enableOwnerPublicationFixture(app as any, ['sample-grant'])).toBe(true)
      await disableOwnerPublicationFixture(app as any)
    } else
      await expect(enableOwnerPublicationFixture(app as any, ['sample-grant'])).rejects.toThrow(
        /activation.*restricted/
      )
  }
)
