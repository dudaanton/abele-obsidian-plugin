import { afterEach, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStateStore } from '@abele/sync-core'
import { AbeleConfig } from '@/services/AbeleConfig'
import { PluginSharing } from '@/sync/pluginSharing'
import { PublicationPrompt } from '@/sync/publicationPrompt'
import { emptyConnection } from '@/sync/connection'
import { bindDeviceToken } from '@/secrets/deviceSecret'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { useVault } from '../helpers/testEnv'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.restoreAllMocks()
})
async function setup(count = 1) {
  const app = useVault([]),
    config = AbeleConfig.getInstance(),
    old = config.sync,
    oldAi = config.ai
  config.ai = { scriptsFolder: 'Scripts' } as never
  config.sync = {
    keySignature: null,
    sharing: [{ issuer: 'https://sync.example', vaultId: 'sample-vault', grants: ['old-hint'] }],
  }
  const save = vi.spyOn(config, 'saveSettings').mockResolvedValue()
  const c = {
    ...emptyConnection(),
    serverUrl: 'https://sync.example',
    vaultId: 'sample-vault',
    deviceId: 'sample-owner',
    deviceTokenId: 'abele-sync-device-lifecycle',
  }
  const token = 'absd_' + 'a'.repeat(43)
  setSecrets(null)
  bindDeviceToken(secrets().device, c.deviceTokenId, token, c.serverUrl)
  app.saveLocalStorage('abele-sync-ledger', { stateId: 'sample-local', vaultId: c.vaultId })
  const folders = Array.from({ length: count }, (_, i) => ({
    id: `folder-${i}`,
    vault_id: c.vaultId,
    label: `Sample folder ${i}`,
    selector_kind: 'folder',
    folder_prefix: `Shared-${i}/`,
    root_file_id: null,
    role: 'editor',
    state: 'active',
    acl_revision: 3,
    publication_revision: 0,
    scope_revision: 1,
    revoked_at: null,
    expires_at: null,
  }))
  const fetcher = vi.fn(
    async (url: any) =>
      new Response(
        JSON.stringify(
          String(url).endsWith('/auth/login')
            ? {
                account_token: 'abst_' + 'b'.repeat(43),
                expires_at: new Date(Date.now() + 60000).toISOString(),
              }
            : String(url).endsWith('/grants/groups')
              ? []
              : folders
        )
      )
  ) as unknown as typeof fetch
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
  let owner = await host.ownerPublication(context)
  save.mockClear()
  cleanup.push(async () => {
    owner.close()
    await host.close()
    config.sync = old
    config.ai = oldAi
  })
  const list = async () => {
    const port = host.ownerManagement()
    const session = await port.authorize('sample-password', 'sample@example.com')
    return port.list(session)
  }
  const reopen = async () => {
    owner.close()
    owner = await host.ownerPublication(context)
  }
  return { host, config, save, list, reopen, folders, fetcher }
}
it('persists the complete overflowing server inventory across restart, without reviving a subset', async () => {
  const s = await setup(17)
  expect(await s.list()).toHaveLength(17)
  const ids = s.folders.map((row) => row.id)
  expect((s.host as any).live.grants).toEqual(ids)
  expect(s.config.sync.sharing![0].grants).toEqual(ids)
  expect(s.host.discoveryWarning.value).toContain('paused')
  await s.reopen()
  expect((s.host as any).live.grants).toEqual(ids)
  expect((s.host as any).live.runtime.options.grants).toEqual([])
  expect(s.host.discoveryWarning.value).toContain('paused')
})
it('retries a failed settings save even when the edited in-memory catalogue is already equal', async () => {
  const s = await setup()
  s.save.mockRejectedValue(new Error('Synthetic settings write failure'))
  await s.list()
  expect(s.save).toHaveBeenCalledTimes(1)
  expect(s.host.discoveryWarning.value).toContain('paused')
  await s.list()
  expect(s.save).toHaveBeenCalledTimes(2)
  expect(s.host.discoveryWarning.value).toContain('paused')
  s.save.mockResolvedValue()
  await s.list()
  expect(s.save).toHaveBeenCalledTimes(3)
  expect(s.host.discoveryWarning.value).toBe('')
  expect(s.host.audiences.value).toEqual(['folder-0'])
})
it('keeps the settings-save obligation durable across an owner restart', async () => {
  const s = await setup()
  s.save.mockRejectedValue(new Error('Synthetic pending settings write'))
  await s.list()
  expect(s.save).toHaveBeenCalledTimes(1)
  await s.reopen()
  expect(s.save).toHaveBeenCalledTimes(2)
  expect(s.host.discoveryWarning.value).toContain('paused')
  s.save.mockResolvedValue()
  await s.list()
  expect(s.save).toHaveBeenCalledTimes(3)
  expect(s.host.discoveryWarning.value).toBe('')
})
it('never replaces a cache with a partial folder-only fetch when the group request fails', async () => {
  const s = await setup()
  const before = JSON.stringify(s.config.sync.sharing)
  const original = vi.mocked(s.fetcher).getMockImplementation()!
  vi.mocked(s.fetcher).mockImplementation(async (url, init) =>
    String(url).endsWith('/grants/groups')
      ? new Response(JSON.stringify({ error: { code: 'request_failed' } }), { status: 503 })
      : original(url, init)
  )
  await expect(s.list()).rejects.toMatchObject({ code: 'request_failed' })
  expect(JSON.stringify(s.config.sync.sharing)).toBe(before)
  expect((s.host as any).live.grants).toEqual(['old-hint'])
})
it('warns on malformed imported groups, preserves the source, and repairs only from a complete server snapshot', async () => {
  const s = await setup()
  const invalid = {
    id: 'bad-group',
    label: 'Sample bad group',
    rootId: 'sample-root',
    role: 'editor',
    revision: 'invalid',
    state: 'active',
  }
  s.config.sync = {
    keySignature: null,
    sharing: [
      {
        issuer: 'https://sync.example',
        vaultId: 'sample-vault',
        grants: ['old-hint'],
        groups: [invalid] as any,
      },
    ],
  }
  await s.reopen()
  expect(s.host.discoveryWarning.value).toMatch(/invalid|damaged|read/)
  expect(s.config.sync.sharing![0].groups).toEqual([invalid])
  expect((s.host as any).live.runtime.options.grants).toEqual([])
  await s.list()
  expect(s.host.discoveryWarning.value).toBe('')
  expect(s.config.sync.sharing![0].grants).toEqual(['folder-0'])
  expect(s.config.sync.sharing![0].groups).toEqual([])
})
