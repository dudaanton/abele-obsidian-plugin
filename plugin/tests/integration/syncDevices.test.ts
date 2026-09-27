// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Platform, type App } from 'obsidian'
import type { VaultClient } from '@abele/sync-core'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService } from '@/sync/SyncService'
import { setSecrets } from '@/secrets/SecretStore'
import { createPluginSecrets } from '@/secrets/host'
import type AbelePlugin from '@/main'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'
import { syncServer, type SyncServer } from '../helpers/syncServer'

/**
 * The devices on this vault, as the Sync tab lists them: every live device of this account on
 * the vault, this one included, and revoking another of them with this device's own token — no
 * password asked. This device itself is never revoked from the list; it leaves by Disconnect.
 * A real server runs in this process, as in `syncHeldDeletes.test.ts`.
 */

const EMAIL = 'device@test.io'
const PATIENCE_MS = 10_000

let server: SyncServer
let app: FakeApp
let service: SyncService
let laptop: VaultClient
let laptopId: string

const plugin = {
  manifest: { id: 'abele' },
  registerDomEvent: () => undefined,
  loadData: () => Promise.resolve({}),
  saveData: () => Promise.resolve(),
  syncAiFeatures: () => undefined,
  onExternalSettingsChange: () => Promise.resolve(),
} as unknown as AbelePlugin

beforeAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>
  globals.window ??= globalThis
  globals.document ??= { visibilityState: 'visible' }
})

async function waitFor(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const until = Date.now() + PATIENCE_MS
  while (Date.now() < until) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`gave up waiting for ${what}; the status was ${service.status.value.state}`)
}

beforeEach(async () => {
  server = await syncServer()
  Platform.isMobile = false
  AbeleConfig.getInstance().init(plugin)
  AbeleConfig.getInstance().applySettings(undefined)
  app = buildFakeVault([{ path: 'Note.md', content: 'a note', mtime: 1000, ctime: 1000 }])
  setSecrets(createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin))
  const { accountToken } = await server.account(EMAIL)
  const { vaultId } = await server.vault(accountToken, 'Home')
  const enrolled = await server.device(accountToken, vaultId, 'Laptop')
  laptop = server.clientFor(enrolled.deviceToken, vaultId)
  laptopId = enrolled.deviceId

  service = SyncService.getInstance()
  service.init(app as unknown as App, plugin, {
    fetch: (input, init) => server.fetch(input, init),
    WebSocket: server.WebSocket,
    indexedDB: new IDBFactory(),
    fallbackMs: 60_000,
    pollMs: 60_000,
  })
  await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
  await service.chooseVault(vaultId, 'Desktop')
  await waitFor('the first sync', () => service.status.value.state === 'idle')
})

afterEach(async () => {
  await service.destroy()
  await server.close()
  setSecrets(null)
})

describe('the devices on this vault', () => {
  it('are listed with this device’s token, this device among them', async () => {
    const devices = await service.listDevices()

    expect(devices?.map((device) => device.name).sort()).toEqual(['Desktop', 'Laptop'])
    const own = devices!.find((device) => device.id === service.connection.value.deviceId)
    expect(own?.name).toBe('Desktop')
    expect(own?.platform).toBe('desktop')
  })

  it('name the device a transfer was made by', async () => {
    await service.enrolSibling('Phone')

    const devices = (await service.listDevices())!
    const phone = devices.find((device) => device.name === 'Phone')
    expect(phone?.enrolled_by).toBe(service.connection.value.deviceId)
  })

  it('lose another device when it is revoked, which stops it syncing', async () => {
    await service.revokeDevice(laptopId)

    const devices = (await service.listDevices())!
    expect(devices.map((device) => device.name)).toEqual(['Desktop'])
    await expect(laptop.manifest(null)).rejects.toThrow()
    // This device goes on syncing.
    await service.syncNow()
    expect(service.status.value.state).toBe('idle')
  })

  it('never revoke this device itself, which leaves by Disconnect', async () => {
    await expect(service.revokeDevice(service.connection.value.deviceId)).rejects.toThrow(
      /Disconnect/
    )

    await service.syncNow()
    expect(service.status.value.state).toBe('idle')
    expect((await service.listDevices())!.map((device) => device.name)).toContain('Desktop')
  })

  it('are not listed on a device that is not connected', async () => {
    await service.disconnect()

    expect(await service.listDevices()).toBeNull()
  })
})
