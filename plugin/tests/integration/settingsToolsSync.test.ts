/**
 * The settings tools and this device's sync connection.
 *
 * The connection left `data.json` for the vault's local storage, and with it the `AbeleConfig`
 * object the tools walk — so without a table of its own an agent that could point this device
 * at a server before could no longer even read where it syncs. The fields it could write stay
 * writable (Anton's "no restriction"), but through `SyncService.updateConnection`, so the https
 * rule, the keychain-name rule and the token's own server hold for the agent exactly as they
 * hold for the Sync tab. What the bookkeeping owns — where the token was minted, the revokes
 * still waiting — is not reachable at all.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PLAIN_HTTP_REFUSED } from '@abele/sync-protocol'
import {
  createReadSettingsTool,
  createWriteSettingsTool,
  describeSettingsWrite,
} from '@/ai/tools/SettingsTools'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { emptyConnection } from '@/sync/connection'
import { SyncService } from '@/sync/SyncService'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const read = createReadSettingsTool()
const write = createWriteSettingsTool()

async function answer(tool: typeof read, params: Record<string, unknown>): Promise<string> {
  const result = await tool.execute('call-1', params)
  return result.content.map((part) => ('text' in part ? part.text : '')).join('')
}

const OLD = 'https://old.example.com'
const TOKEN_ID = 'abele-sync-device-abc123'

let app: FakeApp
let saved: number

/** The connection as a device enrolled on `OLD` holds it; `token` puts its token in the keychain. */
function connected({ token = false } = {}): void {
  SyncService.getInstance().connection.value = {
    ...emptyConnection(),
    serverUrl: OLD,
    enrolledUrl: OLD,
    vaultId: 'v1',
    deviceId: 'd1',
    deviceTokenId: TOKEN_ID,
    deviceName: 'Laptop',
    migrated: true,
  }
  if (token) app.secretStorage.setSecret(TOKEN_ID, 'the-device-token')
}

beforeEach(() => {
  app = useVault([])
  const config = AbeleConfig.getInstance()
  config.sync = { keySignature: null }
  saved = 0
  config.saveSettings = vi.fn(async () => {
    saved++
  })
  connected()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await SyncService.getInstance().destroy()
})

describe('reading where this device syncs', () => {
  it('reads a device field from the connection', async () => {
    expect(await answer(read, { path: 'sync.serverUrl' })).toContain(`"${OLD}"`)
    expect(await answer(read, { path: 'sync.deviceName' })).toContain('"Laptop"')
    expect(await answer(read, { path: 'sync.selective.images' })).toContain('true')
  })

  it('lists the device fields under sync, beside what data.json shares', async () => {
    const whole = await answer(read, { path: 'sync' })

    expect(whole).toContain('keySignature')
    expect(whole).toContain(OLD)
    expect(whole).toContain('selective')
  })

  it('never reaches what the bookkeeping owns', async () => {
    for (const path of ['sync.enrolledUrl', 'sync.pendingRevoke', 'sync.migrated']) {
      expect(await answer(read, { path })).toMatch(/not set|No setting/)
    }
    expect(await answer(read, { path: 'sync' })).not.toContain('enrolledUrl')
  })
})

describe('changing where this device syncs', () => {
  it('refuses plain http to another machine with the https rule', async () => {
    const text = await answer(write, { path: 'sync.serverUrl', value: 'http://192.168.1.5' })

    expect(text).toContain(PLAIN_HTTP_REFUSED)
    expect(SyncService.getInstance().connection.value.serverUrl).toBe(OLD)
  })

  it('writes an https address through updateConnection, not data.json', async () => {
    const service = SyncService.getInstance()
    const update = vi.spyOn(service, 'updateConnection')

    const text = await answer(write, { path: 'sync.serverUrl', value: 'https://new.example.com' })

    expect(update).toHaveBeenCalledWith({ serverUrl: 'https://new.example.com' })
    expect(service.connection.value.serverUrl).toBe('https://new.example.com')
    expect(text).toContain(`"${OLD}" → "https://new.example.com"`)
    expect(saved).toBe(0)
  })

  it('returns the refusal when the token would leave the server that minted it', async () => {
    connected({ token: true })

    const text = await answer(write, { path: 'sync.serverUrl', value: 'https://new.example.com' })

    expect(text).toContain(`enrolled on ${OLD}`)
    expect(SyncService.getInstance().connection.value.serverUrl).toBe(OLD)
  })

  it('refuses a keychain name without the device prefix', async () => {
    const text = await answer(write, { path: 'sync.deviceTokenId', value: 'my-key' })

    expect(text).toContain('abele-sync-device-')
    expect(SyncService.getInstance().connection.value.deviceTokenId).toBe(TOKEN_ID)
  })

  it('pauses this device and changes its cap on the connection', async () => {
    await answer(write, { path: 'sync.paused', value: 'true' })
    await answer(write, { path: 'sync.selective.maxFileBytes', value: '1000' })

    const connection = SyncService.getInstance().connection.value
    expect(connection.paused).toBe(true)
    expect(connection.selective.maxFileBytes).toBe(1000)
    expect(saved).toBe(0)
  })

  it('takes a kind of file off this device on the connection, leaving the rest', async () => {
    await answer(write, { path: 'sync.selective.images', value: 'false' })

    const selective = SyncService.getInstance().connection.value.selective
    expect(selective.images).toBe(false)
    expect(selective.audio).toBe(true)
    expect(saved).toBe(0)
  })

  it('still checks the type of a device field', async () => {
    const text = await answer(write, { path: 'sync.paused', value: '"yes"' })

    expect(text).toContain('type')
    expect(SyncService.getInstance().connection.value.paused).toBe(false)
  })

  it('does not write what the bookkeeping owns, or the whole block at once', async () => {
    for (const path of ['sync.enrolledUrl', 'sync.pendingRevoke', 'sync.migrated']) {
      expect(await answer(write, { path, value: '"x"' })).toMatch(/not a setting|No setting/)
    }
    expect(await answer(write, { path: 'sync', value: '{}' })).toContain('one field')
    expect(SyncService.getInstance().connection.value.enrolledUrl).toBe(OLD)
  })

  it('keeps the shared keySignature in data.json', async () => {
    const text = await answer(write, {
      path: 'sync.keySignature',
      value: '{"property":"secret","value":"yes"}',
    })

    expect(text).toContain('→')
    expect(AbeleConfig.getInstance().sync.keySignature).toEqual({
      property: 'secret',
      value: 'yes',
    })
    expect(saved).toBe(1)
  })
})

describe('what a write would do, as the approval card says it', () => {
  it('warns that a new server address moves the token, naming where', () => {
    const view = describeSettingsWrite('sync.serverUrl', 'https://new.example.com')

    expect(view.before).toBe(`"${OLD}"`)
    expect(view.after).toBe('"https://new.example.com"')
    expect(view.warning).toContain('Changes where this device syncs')
    expect(view.warning).toContain('new.example.com')
    expect(view.deviceOnly).toBe(true)
  })

  it('names the current server for a field that moves the token elsewhere', () => {
    for (const path of ['sync.vaultId', 'sync.deviceId', 'sync.deviceTokenId']) {
      expect(describeSettingsWrite(path, '"x"').warning).toContain('old.example.com')
    }
  })

  it('says only this device for a switch that moves no token', () => {
    for (const path of ['sync.paused', 'sync.selective.maxFileBytes', 'sync.selective.images']) {
      const view = describeSettingsWrite(path, 'false')
      expect(view.warning).toBeNull()
      expect(view.deviceOnly).toBe(true)
    }
  })

  it('shows a plain before and after for any other setting', () => {
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, chatFolder: 'AI/Chats' }
    const view = describeSettingsWrite('ai.chatFolder', 'Chats')

    expect(view).toMatchObject({
      path: 'ai.chatFolder',
      before: '"AI/Chats"',
      after: '"Chats"',
      warning: null,
      deviceOnly: false,
    })
  })

  it('never shows a secret on either side', () => {
    const view = describeSettingsWrite('fireflyToken', '"a new token"')

    expect(view.before).not.toContain('a real')
    expect(view.after).toBe('"<hidden>"')
  })
})
