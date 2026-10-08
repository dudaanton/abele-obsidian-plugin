// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { buildEngine, type EngineRecipe } from '@/sync/engineBuild'
import { emptyConnection, writeConnection } from '@/sync/connection'
import { writeLedgerId } from '@/sync/ledgerId'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

function recipe() {
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  const app = buildFakeVault([{ path: 'sample.md', content: 'Unsent local content' }])
  writeLedgerId(app, { stateId: 'sample-state', vaultId: 'sample-vault' })
  const fetch = vi.fn()
  const factory = new IDBFactory()
  const input = {
    app: app as unknown as App,
    connection: {
      ...emptyConnection(),
      serverUrl: 'https://sync.example',
      enrolledUrl: 'https://sync.example',
      vaultId: 'sample-vault',
      deviceId: 'sample-device',
    },
    host: {
      connection: () => input.connection,
      token: () => 'sample-token',
      deps: () => ({ indexedDB: factory, fetch, WebSocket: class {} }),
      manifest: () => ({ id: 'abele' }),
      settingsArrived: () => {},
      settingsMeaning: async () => '{}',
    },
    board: { note: vi.fn(), failed: vi.fn() },
    token: 'sample-token',
    ignoreText: null,
    join: null,
    noticed: () => {},
    closedElsewhere: () => {},
  } as unknown as EngineRecipe
  writeConnection(app, input.connection)
  return { app, fetch, factory, input }
}

describe('existing connection with missing ledger', () => {
  it('requires explicit recovery before building any sync or fabricating provenance', async () => {
    const { app, fetch, input } = recipe()
    const result = buildEngine(input)
    try {
      await expect(result).rejects.toThrow(/recovery/i)
      expect(fetch).not.toHaveBeenCalled()
      expect(app.loadLocalStorage('abele-script-provenance')).toBeNull()
      expect(await app.vault.adapter.exists('.abele-script-managed')).toBe(false)
    } finally {
      const built = await result.catch(() => null)
      if (built) {
        await built.engine.stop()
        built.store.close()
      }
    }
  })
})
