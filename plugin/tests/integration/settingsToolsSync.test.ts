import { tokenSettingsFixture } from '../helpers/tokenSettingsFixture'
import { tokenUi } from '@/sync/tokenUi'
/**
 * Device-local sync fields remain accessible through settings tools after moving out of
 * data.json. Writes go through the sync service so URL, keychain and token-origin checks
 * match the settings screen. Internal migration and revocation bookkeeping stays private.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Platform } from 'obsidian'
import { PLAIN_HTTP_REFUSED } from '@abele/sync-sdk/protocol'
import {
  createReadSettingsTool,
  createWriteSettingsTool,
  describeSettingsWrite,
} from '@/ai/tools/SettingsTools'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const read = createReadSettingsTool()
const write = createWriteSettingsTool()

async function answer(tool: typeof read, params: Record<string, unknown>): Promise<string> {
  const result = await tool.execute('call-1', params)
  return result.content.map((part) => ('text' in part ? part.text : '')).join('')
}

const OLD = 'https://old.example.com'

let app: FakeApp

let saved: number

let fixture: ReturnType<typeof tokenSettingsFixture>
function connected({ token = false, isMobile = false } = {}): void {
  Platform.isMobile = isMobile
  fixture = tokenSettingsFixture(app)
  if (token) fixture.bind()
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
  tokenUi.value = null
  vi.restoreAllMocks()
})

describe('reading where this device syncs', () => {
  it('reads a device field from the connection', async () => {
    expect(await answer(read, { path: fixture.path('address') })).toContain(`"${OLD}"`)
    expect(await answer(read, { path: fixture.path('selective.images') })).toContain('true')
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
  it('cannot retarget a live token or expose its credentials and ledger through settings', async () => {
    const token = fixture
    token.bind()
    const before = token.registry.records()
    const reconcile = vi.fn(async () => {})
    token.ui.connectionsChanged = reconcile
    const result = await answer(write, {
      path: token.path('address'),
      value: 'https://other.example.com',
    })
    expect(result).toContain('was not changed')
    expect(token.registry.records()).toEqual(before)
    expect(reconcile).not.toHaveBeenCalled()
    const view = await answer(read, { path: 'sync.connections' })
    expect(view).toContain(OLD)
    for (const field of ['secretReference', 'ledgerId', 'pending', 'key']) {
      expect(view).not.toContain(`"${field}"`)
      expect(await answer(read, { path: token.path(field) })).toBe(
        `"${token.path(field)}" is not a valid field path.`
      )
    }
    expect(view).not.toContain('a'.repeat(43))
    expect(saved).toBe(0)
  })

  it('refuses plain http to another machine with the https rule', async () => {
    const text = await answer(write, { path: fixture.path('address'), value: 'http://192.168.1.5' })

    expect(text).toContain(PLAIN_HTTP_REFUSED)
    expect(fixture.registry.records()[0].address).toBe(OLD)
  })

  it('writes an https address through updateConnection, not data.json, and reconciles', async () => {
    const token = fixture
    const reconcile = vi.fn(async () => {})
    token.ui.connectionsChanged = reconcile
    const update = vi.spyOn(token.ui, 'updateConnection')
    const text = await answer(write, {
      path: token.path('address'),
      value: 'https://new.example.com',
    })
    expect(update).toHaveBeenCalledWith(token.id, { address: 'https://new.example.com' })
    expect(reconcile).toHaveBeenCalledOnce()
    expect(token.registry.records()[0].address).toBe('https://new.example.com')
    expect(text).toContain(`"${OLD}" → "https://new.example.com"`)
    expect(saved).toBe(0)
  })

  it('returns the refusal when the token would leave the server that minted it', async () => {
    connected({ token: true })

    const text = await answer(write, {
      path: fixture.path('address'),
      value: 'https://new.example.com',
    })

    expect(text).toContain('original server')
    expect(fixture.registry.records()[0].address).toBe(OLD)
  })

  it('refuses a keychain name without the device prefix', async () => {
    const text = await answer(write, { path: 'sync.deviceTokenId', value: 'my-key' })

    expect(text).toMatch(/not a setting|No setting|not a valid field path/)
    expect(fixture.keys.size).toBe(0)
  })

  it('pauses this device and changes its cap on the connection', async () => {
    await answer(write, { path: fixture.path('paused'), value: 'true' })
    await answer(write, { path: fixture.path('selective.maxFileBytes'), value: '1000' })

    const connection = fixture.registry.records()[0]
    expect(connection.paused).toBe(true)
    expect(connection.selective.maxFileBytes).toBe(1000)
    expect(saved).toBe(0)
  })

  it('takes a kind of file off this device on the connection, leaving the rest', async () => {
    await answer(write, { path: fixture.path('selective.images'), value: 'false' })

    const selective = fixture.registry.records()[0].selective
    expect(selective.images).toBe(false)
    expect(selective.audio).toBe(true)
    expect(saved).toBe(0)
  })

  it('still checks the type of a device field', async () => {
    const text = await answer(write, { path: fixture.path('paused'), value: '"yes"' })

    expect(text).toContain('type')
    expect(fixture.registry.records()[0].paused).toBe(false)
  })

  it('does not write what the bookkeeping owns, or the whole block at once', async () => {
    for (const path of ['sync.enrolledUrl', 'sync.pendingRevoke', 'sync.migrated']) {
      expect(await answer(write, { path, value: '"x"' })).toMatch(/not a setting|No setting/)
    }
    expect(await answer(write, { path: 'sync', value: '{}' })).toContain('one field')
    expect(fixture.registry.records()[0].address).toBe(OLD)
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
    const view = describeSettingsWrite(fixture.path('address'), 'https://new.example.com')

    expect(view.before).toBe(`"${OLD}"`)
    expect(view.after).toBe('"https://new.example.com"')
    expect(view.warning).toContain('original server')
    expect(view.warning).toContain('Use a new token')
    expect(view.deviceOnly).toBe(true)
  })

  it('says only this device for a switch that moves no token', () => {
    for (const path of [
      fixture.path('paused'),
      fixture.path('selective.maxFileBytes'),
      fixture.path('selective.images'),
    ]) {
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
    AbeleConfig.getInstance().fireflyToken = 'the stored firefly token'
    const view = describeSettingsWrite('fireflyToken', '"a new token"')

    expect(view.before).toBe('"<hidden>"')
    expect(view.after).toBe('"<hidden>"')
    expect(JSON.stringify(view)).not.toContain('the stored firefly token')
    expect(JSON.stringify(view)).not.toContain('a new token')
  })
})
