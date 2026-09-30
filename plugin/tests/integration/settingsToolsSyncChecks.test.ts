/**
 * What the agent's writes to this device's connection are held to, past the type check.
 *
 * The Sync tab refuses a cap that is not a positive number, stores the server address the way
 * a sign-in stores it, and never reports a value it did not keep. A write from the agent goes
 * through `SyncService.updateConnection` like the tab's does, so the same rules hold there —
 * and the tool's answer is read back from the connection as saved, not from what was asked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Platform, type App } from 'obsidian'
import { createWriteSettingsTool, describeSettingsWrite } from '@/ai/tools/SettingsTools'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  emptyConnection,
  MOBILE_MAX_FILE_BYTES,
  writeConnection,
  type DeviceConnection,
} from '@/sync/connection'
import { SyncService } from '@/sync/SyncService'
import type AbelePlugin from '@/main'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const write = createWriteSettingsTool()

async function answer(params: Record<string, unknown>): Promise<string> {
  const result = await write.execute('call-1', params)
  return result.content.map((part) => ('text' in part ? part.text : '')).join('')
}

const OLD = 'https://old.example.com'
const TOKEN_ID = 'abele-sync-device-abc123'

let app: FakeApp

const connection = (): DeviceConnection => SyncService.getInstance().connection.value

/** A device enrolled on `OLD`; `token` puts its token in the keychain. */
function connected({ token = false, isMobile = false } = {}): void {
  SyncService.getInstance().connection.value = {
    ...emptyConnection(isMobile),
    serverUrl: OLD,
    enrolledUrl: OLD,
    vaultId: 'v1',
    vaultName: 'Notes',
    deviceId: 'd1',
    deviceTokenId: TOKEN_ID,
    deviceName: 'Laptop',
    migrated: true,
  }
  if (token) {
    app.secretStorage.setSecret(TOKEN_ID, 'the-device-token')
    app.secretStorage.setSecret(
      `${TOKEN_ID}-server`,
      JSON.stringify({ server: OLD, token: 'the-device-token' })
    )
  }
}

beforeEach(() => {
  app = useVault([])
  Platform.isMobile = false
  const config = AbeleConfig.getInstance()
  config.sync = { keySignature: null }
  config.saveSettings = vi.fn(async () => undefined)
  connected()
})

afterEach(async () => {
  vi.restoreAllMocks()
  Platform.isMobile = false
  await SyncService.getInstance().destroy()
})

describe('the server address is stored the way a sign-in stores it', () => {
  it('keeps the enrolled server under another spelling, stored as the sign-in wrote it', async () => {
    connected({ token: true })

    const text = await answer({ path: 'sync.serverUrl', value: ' https://OLD.example.com/ ' })

    expect(connection().serverUrl).toBe(OLD)
    expect(text).toContain(`"${OLD}" → "${OLD}"`)
  })

  it('stores a new address normalised, and the card shows it that way', async () => {
    expect(describeSettingsWrite('sync.serverUrl', 'https://New.Example.com/').after).toBe(
      '"https://new.example.com"'
    )

    const text = await answer({ path: 'sync.serverUrl', value: 'https://New.Example.com/' })

    expect(connection().serverUrl).toBe('https://new.example.com')
    expect(text).toContain('→ "https://new.example.com"')
  })
})

describe('the selective settings are held to the Sync tab rules', () => {
  it('refuses a cap that is not a positive whole number, and changes nothing', async () => {
    for (const value of ['0', '-1', '"lots"', '1.5', '{}', '[]', 'true']) {
      const text = await answer({ path: 'sync.selective.maxFileBytes', value })
      expect(text, value).toMatch(/was not changed|type has to match/)
      expect(connection().selective.maxFileBytes, value).toBeNull()
    }
  })

  it('refuses a bad cap on a phone too', async () => {
    Platform.isMobile = true
    connected({ isMobile: true })

    const text = await answer({ path: 'sync.selective.maxFileBytes', value: '0' })

    expect(text).toContain('was not changed')
    expect(connection().selective.maxFileBytes).toBe(MOBILE_MAX_FILE_BYTES)
  })

  it('takes the cap off a phone with null, as an empty field on the tab does', async () => {
    Platform.isMobile = true
    connected({ isMobile: true })

    const text = await answer({ path: 'sync.selective.maxFileBytes', value: 'null' })

    expect(connection().selective.maxFileBytes).toBeNull()
    expect(text).toContain(`${MOBILE_MAX_FILE_BYTES} → null`)
  })

  it('refuses a folder list with anything but folder names in it', async () => {
    const text = await answer({ path: 'sync.selective.excludedFolders', value: '["a", 5]' })

    expect(text).toContain('was not changed')
    expect(connection().selective.excludedFolders).toEqual([])
  })

  it('refuses a switch that is not true or false, and settings missing some', async () => {
    const kind = await answer({ path: 'sync.selective.settings.main', value: '"no"' })
    const block = await answer({ path: 'sync.selective.settings', value: '{}' })
    const extra = await answer({ path: 'sync.selective.surprise', value: 'true' })

    expect(kind).toMatch(/was not changed|type/)
    expect(block).toContain('was not changed')
    expect(extra).toMatch(/was not changed|not a setting|not a valid field path/)
    expect(connection().selective.settings.main).toBe(true)
    expect(connection().selective).not.toHaveProperty('surprise')
  })

  it('reports what was stored', async () => {
    const text = await answer({ path: 'sync.selective.maxFileBytes', value: '1000' })

    expect(text).toBe('sync.selective.maxFileBytes: null → 1000')
    expect(connection().selective.maxFileBytes).toBe(1000)
  })
})

describe('the warning when the address is emptied', () => {
  it('says the device stops syncing and the token stays valid until Disconnect', () => {
    const view = describeSettingsWrite('sync.serverUrl', '""')

    expect(view.warning).toContain('Stops this device syncing')
    expect(view.warning).toContain('stays valid on old.example.com until Disconnect')
    expect(view.warning).not.toContain('will be sent')
  })
})

describe('a vault changed under the connection', () => {
  it('forgets the old vault name, so nothing names a vault this device left', async () => {
    await answer({ path: 'sync.vaultId', value: '"v2"' })

    expect(connection().vaultId).toBe('v2')
    expect(connection().vaultName).toBe('')
  })
})

describe('a write that leaves sync unable to start', () => {
  const plugin = {
    manifest: { id: 'abele' },
    registerDomEvent: () => undefined,
  } as unknown as AbelePlugin

  /** A state database that will not open: the build fails the way a broken one does. */
  const brokenDatabase = {
    open: () => {
      throw new Error('the state database would not open')
    },
  } as unknown as IDBFactory

  it('says so in the answer, beside what was written', async () => {
    // Filed where `init` reads it: no token yet, so the first reconcile builds nothing.
    writeConnection(app as unknown as App, connection())
    const service = SyncService.getInstance()
    service.init(app as unknown as App, plugin, { indexedDB: brokenDatabase })
    await vi.waitFor(() => expect(service.status.value.state).toBe('disconnected'))
    app.secretStorage.setSecret(TOKEN_ID, 'the-device-token')

    const text = await answer({ path: 'sync.deviceName', value: '"Desk"' })

    expect(service.status.value.state).toBe('error')
    expect(text).toContain('sync.deviceName: "Laptop" → "Desk"')
    expect(text).toContain('sync could not start:')
    expect(text).toContain(service.status.value.lastError ?? '(no error)')
    expect(text).not.toContain('the-device-token')
  })
})
