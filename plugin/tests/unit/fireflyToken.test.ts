/**
 * The Firefly III token used to sit in `data.json` in the clear — the one credential the
 * settings held as a value rather than as a keychain id. It moves into the keychain (and so
 * into the synced store) the first time the settings are saved, and leaves the file then.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { FIREFLY_TOKEN_KEY_ID, fireflyToken, setFireflyToken } from '@/secrets/legacy'
import { secrets } from '@/secrets/SecretStore'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let saved: Array<Record<string, unknown>>
let app: FakeApp

function install(stored: unknown) {
  saved = []
  AbeleConfig.getInstance().init({
    loadData: async () => stored,
    saveData: async (data: unknown) => void saved.push(JSON.parse(JSON.stringify(data))),
    syncAiFeatures: vi.fn(),
  } as never)
}

beforeEach(() => {
  app = useVault([])
})

afterEach(() => vi.restoreAllMocks())

describe('a plain Firefly token in the settings file', () => {
  it('moves into the keychain and out of the file at the next save', async () => {
    install({ refreshDelay: 300, fireflyBaseUrl: 'https://ff.example', fireflyToken: 'ff-plain' })
    const config = AbeleConfig.getInstance()
    await config.loadSettings()

    await config.saveSettings()

    expect(app.secretStorage.getSecret(FIREFLY_TOKEN_KEY_ID)).toBe('ff-plain')
    const last = saved[saved.length - 1]
    expect(JSON.stringify(last)).not.toContain('ff-plain')
    expect(last.fireflyBaseUrl).toBe('https://ff.example')
    expect(fireflyToken()).toBe('ff-plain')
  })

  it('is read before it has moved, and stays in the file while the keychain refuses it', async () => {
    install({ refreshDelay: 300, fireflyToken: 'ff-plain' })
    const config = AbeleConfig.getInstance()
    await config.loadSettings()
    expect(fireflyToken()).toBe('ff-plain')

    vi.spyOn(secrets(), 'set').mockImplementation(() => {
      throw new Error('Secure storage is not available.')
    })
    await config.saveSettings()

    expect(saved[saved.length - 1].fireflyToken).toBe('ff-plain')
    expect(fireflyToken()).toBe('ff-plain')
  })

  it('arriving in an old transfer is moved the same way', async () => {
    install({ refreshDelay: 300 })
    const config = AbeleConfig.getInstance()
    await config.loadSettings()

    config.applySettings({ ...config.exportSettings(), fireflyToken: 'ff-from-transfer' })
    await config.saveSettings()

    expect(app.secretStorage.getSecret(FIREFLY_TOKEN_KEY_ID)).toBe('ff-from-transfer')
    expect(JSON.stringify(saved[saved.length - 1])).not.toContain('ff-from-transfer')
  })
})

describe('at startup', () => {
  it('moves a plain token without waiting for a save, and writes the file without it', async () => {
    install({ refreshDelay: 300, fireflyToken: 'ff-plain' })
    const config = AbeleConfig.getInstance()
    await config.loadSettings()
    const before = saved.length

    await config.moveLegacySecrets()

    expect(saved.length).toBe(before + 1)
    expect(JSON.stringify(saved[saved.length - 1])).not.toContain('ff-plain')
    expect(app.secretStorage.getSecret(FIREFLY_TOKEN_KEY_ID)).toBe('ff-plain')

    await config.moveLegacySecrets()
    expect(saved.length).toBe(before + 1)
  })
})

describe('setting the token', () => {
  it('goes to the keychain, never into the settings', async () => {
    install({ refreshDelay: 300 })
    const config = AbeleConfig.getInstance()
    await config.loadSettings()

    setFireflyToken('  ff-new  ')
    await config.saveSettings()

    expect(app.secretStorage.getSecret(FIREFLY_TOKEN_KEY_ID)).toBe('ff-new')
    expect(JSON.stringify(saved[saved.length - 1])).not.toContain('ff-new')
    expect(fireflyToken()).toBe('ff-new')
  })
})
