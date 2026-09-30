// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import * as obsidianExternal from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService } from '@/sync/SyncService'
import { createPluginSecrets } from '@/secrets/host'
import { setSecrets } from '@/secrets/SecretStore'
import type AbelePlugin from '@/main'
import { buildFakeVault } from '../helpers/fakeVault'
import { syncServer } from '../helpers/syncServer'

vi.mock('@/ai/tools', () => ({ codeToolDescriptions: () => ({}) }))

describe('a real sync service from a fresh bundle', () => {
  it('opens no second ledger until an old commit answer and teardown have finished', async () => {
    Object.assign(globalThis, { window: globalThis, document: { visibilityState: 'visible' } })
    const server = await syncServer()
    const app = buildFakeVault([{ path: 'Existing.md', content: 'existing', mtime: 1000 }])
    const plugin = {
      manifest: { id: 'abele' },
      registerDomEvent: () => undefined,
      loadData: async () => ({}),
      saveData: async () => undefined,
      onExternalSettingsChange: async () => undefined,
    } as unknown as AbelePlugin
    const idb = new IDBFactory()
    AbeleConfig.getInstance().init(plugin)
    AbeleConfig.getInstance().applySettings(undefined)
    setSecrets(createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin))
    const email = 'reload@example.com'
    const { accountToken } = await server.account(email)
    const { vaultId } = await server.vault(accountToken, 'Sample')
    let release!: () => void
    let entered!: () => void
    const answered = new Promise<void>((resolve) => {
      entered = resolve
    })
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    let armed = false
    const deps = {
      indexedDB: idb,
      WebSocket: server.WebSocket,
      fallbackMs: 60_000,
      pollMs: 60_000,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await server.fetch(input, init)
        if (
          armed &&
          String(input).endsWith('/commit') &&
          String(init?.body).includes('Pending.md')
        ) {
          entered()
          await hold
        }
        return response
      },
    }
    let old = SyncService.getInstance()
    let fresh: SyncService | undefined
    try {
      old.init(app as unknown as App, plugin, deps)
      await old.connect(server.BASE_URL, email, server.TEST_PASSWORD)
      await old.chooseVault(vaultId, 'Sample device')
      await old.syncNow()
      armed = true
      await app.vault.adapter.writeBinary(
        'Pending.md',
        new TextEncoder().encode('pending').buffer as ArrayBuffer,
        { mtime: 2000 }
      )
      const writing = old.syncNow()
      await answered
      const stopping = old.destroy()
      vi.resetModules()
      // Obsidian is an external module shared by plugin loads, unlike the plugin bundle.
      vi.doMock('obsidian', () => obsidianExternal)
      const next = await import('@/sync/SyncService')
      const nextSecrets = await import('@/secrets/SecretStore')
      const nextHost = await import('@/secrets/host')
      const nextConfig = await import('@/services/AbeleConfig')
      nextConfig.AbeleConfig.getInstance().init(plugin)
      nextConfig.AbeleConfig.getInstance().applySettings(undefined)
      nextSecrets.setSecrets(
        nextHost.createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin)
      )
      const opening = vi.spyOn(idb, 'open')
      fresh = next.SyncService.getInstance()
      fresh.init(app as unknown as App, plugin, { ...deps, fetch: server.fetch.bind(server) })
      // Drain event-loop turns, not a guessed startup duration. The old commit is still held.
      await new Promise<void>((resolve) => setImmediate(resolve))
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(opening).not.toHaveBeenCalled()
      release()
      await Promise.all([writing, stopping])
      await fresh.syncNow()
      expect(opening).toHaveBeenCalled()
      expect(await app.vault.adapter.exists('Pending.md')).toBe(true)
      await fresh.destroy()
      nextSecrets.setSecrets(null)
    } finally {
      release()
      await fresh?.destroy()
      await old.destroy()
      setSecrets(null)
      await server.close()
      vi.restoreAllMocks()
      vi.doUnmock('obsidian')
    }
  })
})
