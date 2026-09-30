// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ConnectionKeeper } from '@/sync/connectionKeeper'
import { CONNECTION_KEY } from '@/sync/connection'
import { LEDGER_KEY } from '@/sync/ledgerId'
import { createPluginSecrets } from '@/secrets/host'
import { setSecrets } from '@/secrets/SecretStore'
import type AbelePlugin from '@/main'
import { buildFakeVault } from '../helpers/fakeVault'

vi.mock('@/ai/tools', () => ({ codeToolDescriptions: () => ({}) }))

describe('the complete startup migration order', () => {
  it('keeps legacy data through chat-index migration and a refused connection save, then retries after a restart', async () => {
    Object.assign(globalThis, { window: globalThis, document: { visibilityState: 'visible' } })
    const path = '.obsidian/plugins/abele/data.json'
    const identity = {
      serverUrl: 'https://sample.example',
      vaultId: 'v1',
      deviceId: 'd1',
      deviceTokenId: 'abele-sync-device-sample',
    }
    const initial = {
      tasksFolder: 'Work',
      sync: identity,
      ai: {
        chatHistory: [{ path: 'Sample.abchat', title: 'Sample', created: '2026-01-01T00:00:00Z' }],
      },
    }
    const app = buildFakeVault([{ path, content: JSON.stringify(initial), mtime: 1000 }])
    app.saveLocalStorage(LEDGER_KEY, { stateId: 'sample-state', vaultId: 'v1' })
    app.secretStorage.setSecret(identity.deviceTokenId, 'absd_sample')
    let writes = 0
    const plugin = {
      app,
      manifest: { id: 'abele', dir: '.obsidian/plugins/abele' },
      syncAiFeatures: () => undefined,
      loadData: async () =>
        JSON.parse(new TextDecoder().decode(await app.vault.adapter.readBinary(path))),
      saveData: async (data: unknown) => {
        writes++
        await app.vault.adapter.writeBinary(
          path,
          new TextEncoder().encode(JSON.stringify(data)).buffer as ArrayBuffer
        )
      },
    } as unknown as AbelePlugin
    setSecrets(createPluginSecrets(plugin))
    const store = app.saveLocalStorage.bind(app)
    app.saveLocalStorage = (key, value) => {
      if (key === CONNECTION_KEY) throw new Error('storage unavailable')
      store(key, value)
    }
    try {
      const config = AbeleConfig.getInstance()
      config.init(plugin)
      await config.loadSettings()
      expect(await app.vault.adapter.exists('.obsidian/plugins/abele/chat-index.json')).toBe(true)
      expect(writes).toBe(0)
      await new ConnectionKeeper(() => undefined).open(app as unknown as App)
      await config.saveSettings()
      expect(writes).toBe(0)
      expect((await plugin.loadData()).sync).toMatchObject(identity)
      app.saveLocalStorage = store
      config.init(plugin)
      await config.loadSettings()
      await new ConnectionKeeper(() => undefined).open(app as unknown as App)
      expect(app.loadLocalStorage(CONNECTION_KEY)).toMatchObject(identity)
      expect((await plugin.loadData()).sync).not.toHaveProperty('deviceTokenId')
      expect(writes).toBeGreaterThan(0)
    } finally {
      setSecrets(null)
    }
  })
})
