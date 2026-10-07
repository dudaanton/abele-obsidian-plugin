import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { shallowRef, computed } from 'vue'
import { MemoryStateStore } from '@abele/sync-core'
import { SyncService } from '@/sync/SyncService'
import { PluginSharing } from '@/sync/pluginSharing'
import { PublicationPrompt } from '@/sync/publicationPrompt'
import { emptyConnection } from '@/sync/connection'
import { bindDeviceToken } from '@/secrets/deviceSecret'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

it('waits for the sync queue before revalidating links, including an owner with no local audiences yet', async () => {
  useVault([])
  const sync = SyncService.getInstance(),
    old = sync.sharing.value
  const refreshPublication = vi.fn(async () => {})
  sync.sharing.value = { ownerReady: true, audiences: shallowRef([]), refreshPublication } as any
  let release!: () => void
  const transaction = (sync as any).serialise(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  const refresh = sync.refreshSharing()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(refreshPublication).not.toHaveBeenCalled()
  release()
  try {
    await transaction
    await refresh
    expect(refreshPublication).toHaveBeenCalledOnce()
  } finally {
    sync.sharing.value = old
  }
})

it('keeps an unavailable sharing refresh after a settings reload in the deferred-work lane', async () => {
  useVault([])
  const sync = SyncService.getInstance(),
    old = sync.sharing.value
  const reconcile = vi.spyOn((sync as any).runner, 'reconcile').mockResolvedValue(undefined)
  const note = vi.spyOn(sync, 'note').mockImplementation(() => {})
  sync.sharing.value = {
    scope: shallowRef(null),
    ownerReady: true,
    refreshPublication: vi
      .fn()
      .mockRejectedValue(new Error('Synthetic sharing transport unavailable')),
  } as any
  try {
    sync.onSettingsSaved()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(note).toHaveBeenCalledWith(expect.stringContaining('sharing is waiting'))
  } finally {
    sync.sharing.value = old
    reconcile.mockRestore()
    note.mockRestore()
  }
})

it.each(['overflow', 'settings write', 'stored hints'] as const)(
  'keeps personal owner startup available when optional discovery has a %s failure',
  async (failure) => {
    const app = useVault([])
    setSecrets(null)
    const config = AbeleConfig.getInstance(),
      previous = config.sync,
      oldAi = config.ai
    config.ai = { scriptsFolder: 'Scripts' } as never
    const save = vi.spyOn(config, 'saveSettings').mockResolvedValue()
    const c = {
      ...emptyConnection(),
      serverUrl: 'https://sync.example',
      vaultId: 'sample-vault',
      deviceId: 'sample-owner',
      deviceTokenId: 'abele-sync-device-sample00',
    }
    const token = 'absd_' + 'a'.repeat(43)
    bindDeviceToken(secrets().device, c.deviceTokenId, token, c.serverUrl)
    app.saveLocalStorage('abele-sync-ledger', { stateId: 'sample-local', vaultId: c.vaultId })
    const local = Array.from({ length: 9 }, (_, i) => `local-share-${i}`)
    const imported = Array.from({ length: 8 }, (_, i) => `incoming-share-${i}`)
    config.sync = {
      keySignature: null,
      sharing: [{ issuer: c.serverUrl, vaultId: c.vaultId, grants: local }],
    }
    const fetcher = vi.fn() as unknown as typeof fetch
    const sync = {
      connection: shallowRef(c),
      publicationPrompt: new PublicationPrompt(() => false),
      refreshSharing: vi.fn(async () => {}),
      scopedStatus: vi.fn(),
    }
    const host = new PluginSharing(app as any, sync as any, {
      indexedDB: new IDBFactory(),
      fetch: fetcher,
    })
    const context = {
      app: app as any,
      state: new MemoryStateStore(),
      client: { commitRaw: vi.fn() } as any,
      connection: c,
      token,
      fetch: fetcher,
      held: () => true,
    }
    let owner: Awaited<ReturnType<typeof host.ownerPublication>> | undefined
    try {
      owner = await host.ownerPublication(context)
      if (failure === 'stored hints')
        await (host as any).live.resources.meta.setMeta(
          'owner-publication-audiences-v1',
          '{invalid optional hints'
        )
      owner.close()
      config.sync = {
        keySignature: null,
        sharing: [
          {
            issuer: c.serverUrl,
            vaultId: c.vaultId,
            grants: failure === 'overflow' ? imported : [],
          },
        ],
      }
      if (failure === 'settings write')
        save.mockRejectedValue(new Error('Synthetic optional settings failure'))
      owner = await host.ownerPublication(context)
      expect(host.ownerReady).toBe(true)
      expect(host.ownerManagement()).toBeDefined()
      expect(host.discoveryWarning.value).toContain('Personal sync continues')
      expect((host as any).live.runtime.options.grants).toEqual([])
      expect((host as any).live.grants).toEqual(failure === 'stored hints' ? [] : local)
      if (failure === 'overflow') expect(config.sync.sharing[0].grants).toEqual(imported)
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      owner?.close()
      await host.close()
      config.sync = previous
      config.ai = oldAi
      save.mockRestore()
    }
  }
)

it('imports sharing onto a second owner device at startup and after a settings reload', async () => {
  const app = useVault([])
  setSecrets(null)
  const config = AbeleConfig.getInstance(),
    old = config.sync,
    oldAi = config.ai
  config.ai = { scriptsFolder: 'Scripts' } as never
  const save = vi.spyOn(config, 'saveSettings').mockResolvedValue()
  const connection = {
    ...emptyConnection(),
    serverUrl: 'https://sync.example',
    vaultId: 'sample-vault',
    deviceId: 'second-owner',
    deviceTokenId: 'abele-sync-device-sample00',
  }
  app.saveLocalStorage('abele-sync-ledger', {
    stateId: 'sample-local',
    vaultId: connection.vaultId,
  })
  const token = 'absd_' + 'a'.repeat(43)
  bindDeviceToken(secrets().device, connection.deviceTokenId, token, connection.serverUrl)
  config.sync = {
    keySignature: null,
    sharing: [
      { issuer: connection.serverUrl, vaultId: connection.vaultId, grants: ['sample-group'] },
    ],
  }
  const sync = {
    connection: shallowRef(connection),
    publicationPrompt: new PublicationPrompt(() => false),
    refreshSharing: vi.fn(async () => {}),
    scopedStatus: vi.fn(),
  }
  const fetcher = vi.fn() as unknown as typeof fetch
  const host = new PluginSharing(app as any, sync as any, {
    indexedDB: new IDBFactory(),
    fetch: fetcher,
  })
  sync.refreshSharing.mockImplementation(async () => host.refreshPublication())
  const state = new MemoryStateStore()
  const management = computed(() => {
    try {
      return host.ownerManagement()
    } catch {
      return undefined
    }
  })
  expect(management.value).toBeUndefined()
  let owner: Awaited<ReturnType<typeof host.ownerPublication>> | undefined
  try {
    owner = await host.ownerPublication({
      app: app as any,
      state,
      client: { commitRaw: vi.fn() } as any,
      connection,
      token,
      fetch: fetcher,
      held: () => true,
    })
    expect(host.audiences.value).toEqual(['sample-group'])
    expect(management.value).toBeDefined()
    expect(host.ownerManagement()).toBe(management.value)
    config.sync = {
      keySignature: null,
      sharing: [
        {
          issuer: connection.serverUrl,
          vaultId: connection.vaultId,
          grants: ['sample-group', 'sample-folder'],
        },
        { issuer: connection.serverUrl, vaultId: 'another-vault', grants: ['not-this-vault'] },
      ],
    }
    await host.refreshPublication()
    expect(host.audiences.value).toEqual(['sample-group', 'sample-folder'])
    expect(fetcher).not.toHaveBeenCalled() // catalogue is discovery, never publication consent
    const runtime = (host as any).live.runtime
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const transaction = state.transaction(async () => {
      entered()
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    await started
    runtime.options.linksChanged()
    runtime.options.linksChanged()
    await new Promise((resolve) => setTimeout(resolve, 0))
    try {
      expect(sync.refreshSharing).not.toHaveBeenCalled()
    } finally {
      release()
      await transaction
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sync.refreshSharing).toHaveBeenCalledOnce()
    await sync.refreshSharing.mock.results[0].value
    const rows = Array.from({ length: 17 }, (_, index) => ({
      id: `sample-share-${index}`,
      label: `Sample folder ${index}`,
      vault_id: connection.vaultId,
      selector_kind: 'folder',
      folder_prefix: `Shared-${index}/`,
      root_file_id: null,
      revoked_at: null,
      role: 'editor',
      acl_revision: 1,
      state: 'active',
    }))
    vi.mocked(fetcher).mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/v1/auth/login')
              ? {
                  account_token: 'abst_' + 'b'.repeat(43),
                  expires_at: new Date(Date.now() + 120000).toISOString(),
                }
              : rows
          )
        )
    )
    const manager = host.ownerManagement()
    const account = await manager.authorize('invented-password', 'sample@example.com')
    expect(await manager.list(account)).toHaveLength(17)
    expect(host.audiences.value.length).toBeLessThanOrEqual(16)
    expect((host as any).live.grants).toContain('sample-group')
    expect(config.sync.sharing[0].grants).toContain('sample-group')
    manager.close()
  } finally {
    owner?.close()
    await host.close()
    config.sync = old
    config.ai = oldAi
    save.mockRestore()
  }
})
