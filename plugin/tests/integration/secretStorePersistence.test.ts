import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Plugin } from 'obsidian'
import { AbeleConfig, type AbeleSettings } from '@/services/AbeleConfig'
import { SecretStore } from '@/secrets/SecretStore'
import { pluginStoreHost } from '@/secrets/host'
import { deviceKeyId, type SecretStoreFile } from '@/secrets/storeFile'
import { useVault } from '../helpers/testEnv'

afterEach(() => {
  AbeleConfig.getInstance().destroy()
  vi.restoreAllMocks()
})

describe('damaged stores through the actual settings persistence path', () => {
  it.each([false, 0, ''])(
    'keeps damaged value %j and the device key across save and reload',
    async (bad) => {
      const app = useVault([])
      const config = AbeleConfig.getInstance()
      config.applySettings(undefined)
      config.ai.secrets = [{ name: 'Sample store key', keyId: 'sample-store-key' }]
      app.secretStorage.setSecret('sample-store-key', 'invented-value')
      let disk = JSON.stringify(config.exportSettings())
      const plugin = {
        app,
        manifest: { dir: '.obsidian/plugins/abele' },
        loadData: async () => JSON.parse(disk),
        saveData: vi.fn(async (settings: AbeleSettings) => {
          disk = JSON.stringify(settings)
        }),
        syncAiFeatures: vi.fn(),
      }
      config.init(plugin as never)
      const store = new SecretStore(pluginStoreHost(plugin as unknown as Plugin))
      await store.enable('sample-passphrase', { iterations: 1000 })
      const valid = JSON.parse(disk).secretStore as SecretStoreFile
      const slot = deviceKeyId(valid.id)
      const savedKey = app.secretStorage.getSecret(slot)
      expect(savedKey).toBeTruthy()

      // External settings arrive, then an ordinary setting is saved through exportSettings.
      disk = JSON.stringify({ ...JSON.parse(disk), secretStore: bad })
      await config.reloadSettings()
      await store.load()
      expect(store.status.value).toBe('damaged')
      config.mapCoordinatesProperty = 'sample-position'
      await config.saveSettings()
      expect(plugin.saveData).toHaveBeenLastCalledWith(
        expect.objectContaining({ secretStore: bad })
      )
      expect(JSON.parse(disk)).toHaveProperty('secretStore', bad)

      await config.reloadSettings()
      await store.load()
      expect(store.status.value).toBe('damaged')
      expect(app.secretStorage.getSecret(slot)).toBe(savedKey)
      expect(store.get('sample-store-key')).toBe('invented-value')

      // Restoring the valid ciphertext opens with the retained key, without calling unlock.
      disk = JSON.stringify({ ...JSON.parse(disk), secretStore: valid })
      await config.reloadSettings()
      await store.load()
      expect(store.status.value).toBe('unlocked')
      expect(app.secretStorage.getSecret(slot)).toBe(savedKey)
    }
  )

  it.each([undefined, null])('still omits an intentionally absent store: %j', (absent) => {
    const config = AbeleConfig.getInstance()
    config.applySettings({ refreshDelay: 300, secretStore: absent })
    expect(config.exportSettings()).not.toHaveProperty('secretStore')
  })
})
