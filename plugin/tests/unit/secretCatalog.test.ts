/**
 * The list of keys the plugin knows on this device: what each one is called in words a person
 * recognises, where it is used, whether it is set, and how it stands with the synced store.
 *
 * Values are fake and obviously so; nothing here is a real key.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { AbeleConfig, type AbeleSettings } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { DEFAULT_TRANSCRIPTION } from '@/ai/transcription'
import { DEFAULT_GITHUB_SETTINGS, GITHUB_TOKEN_KEY_ID } from '@/github/settings'
import { FIREFLY_TOKEN_KEY_ID } from '@/secrets/legacy'
import { copyAllText, secretCatalog, type StoreView } from '@/secrets/catalog'
import type { StoreContent } from '@/secrets/SecretStore'
import { createAgent } from '@/ai/agents/types'

let settings: AbeleSettings

beforeEach(() => {
  const config = AbeleConfig.getInstance()
  config.applySettings(undefined)
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    braveSearchApiKey: 'abele-brave-search',
    secrets: [{ name: 'Weather', keyId: 'abele-secret-1' }],
    providers: [
      { id: 'p', name: 'OpenAI', baseUrl: 'http://x', apiKeyId: 'abele-provider-p', models: [] },
      { id: 'q', name: 'Local', baseUrl: 'http://y', apiKeyId: '', models: [] },
    ],
    imageProviders: [
      {
        id: 'i',
        name: 'Pictures',
        apiType: 'openai',
        endpoint: '',
        // Shared with the chat provider: one key, two uses.
        apiKeyId: 'abele-provider-p',
        models: [],
      },
    ],
    agents: [createAgent({ id: 'w', name: 'Writer', providerId: 'p', modelId: 'm' })],
    mcpServers: [
      {
        id: 'mc',
        name: 'Context',
        url: 'https://mcp.example/mcp',
        enabled: true,
        keyId: 'abele-mcp-mc',
        headers: {},
        tools: [],
      },
    ],
  }
  config.github = { ...DEFAULT_GITHUB_SETTINGS, keyId: GITHUB_TOKEN_KEY_ID }
  settings = config.exportSettings()
})

const view = (
  values: Record<string, string>,
  status: StoreView['status'] = 'off',
  contents: StoreContent[] | null = null
): StoreView => ({ status, contents, has: (id) => !!values[id] })

describe('the keys the plugin knows', () => {
  it('is every key the settings point at, once each, named for what it is', () => {
    const rows = secretCatalog(settings, view({}))
    const ids = rows.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(
      [
        'abele-brave-search',
        'abele-secret-1',
        'abele-provider-p',
        GITHUB_TOKEN_KEY_ID,
        DEFAULT_TRANSCRIPTION.apiKeyId,
        FIREFLY_TOKEN_KEY_ID,
        'abele-mcp-mc',
      ].sort()
    )

    const by = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(by['abele-provider-p'].name).toBe('OpenAI')
    expect(by['abele-provider-p'].uses).toEqual([
      'AI provider · OpenAI',
      'Image provider · Pictures',
      'Agent · Writer',
    ])
    expect(by['abele-secret-1'].name).toBe('Weather')
    expect(by['abele-secret-1'].uses).toEqual(['Stored key · Weather'])
    expect(by['abele-brave-search'].name).toBe('Brave Search')
    expect(by[GITHUB_TOKEN_KEY_ID].name).toBe('GitHub')
    expect(by[FIREFLY_TOKEN_KEY_ID].name).toBe('Firefly III')
    expect(by[DEFAULT_TRANSCRIPTION.apiKeyId].name).toBe('Voice input')
    expect(by[DEFAULT_TRANSCRIPTION.apiKeyId].uses).toEqual(['Voice input'])
    expect(by[FIREFLY_TOKEN_KEY_ID].uses).toEqual(['Finance · Firefly III'])
    expect(by['abele-mcp-mc'].name).toBe('Context')
    expect(by['abele-mcp-mc'].uses).toEqual(['MCP server · Context'])
  })

  it('says which are set, and with the store off, that they live on this device', () => {
    const rows = secretCatalog(settings, view({ 'abele-provider-p': 'fake-p' }))
    const by = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(by['abele-provider-p']).toMatchObject({ set: true, state: 'device' })
    expect(by['abele-secret-1']).toMatchObject({ set: false, state: 'unset' })
  })

  it('with the store open, tells synced keys from keys out of step and keys not in it', () => {
    const contents: StoreContent[] = [
      { id: 'abele-provider-p', at: 5000, removed: false, inKeychain: 'same' },
      { id: 'abele-secret-1', at: 6000, removed: false, inKeychain: 'different' },
      { id: GITHUB_TOKEN_KEY_ID, at: 7000, removed: false, inKeychain: 'missing' },
      // In the store and used by nothing in these settings: another device's, or left over.
      { id: 'abele-provider-gone', at: 8000, removed: false, inKeychain: 'same' },
      { id: 'abele-provider-deleted', at: 9000, removed: true, inKeychain: 'missing' },
    ]
    const values = {
      'abele-provider-p': 'x',
      'abele-secret-1': 'x',
      [GITHUB_TOKEN_KEY_ID]: 'x',
      'abele-brave-search': 'x',
      'abele-provider-gone': 'x',
    }
    const rows = secretCatalog(settings, view(values, 'unlocked', contents))
    const by = Object.fromEntries(rows.map((r) => [r.id, r]))

    expect(by['abele-provider-p']).toMatchObject({ state: 'synced', at: 5000 })
    expect(by['abele-secret-1'].state).toBe('differs')
    expect(by[GITHUB_TOKEN_KEY_ID].state).toBe('store-only')
    expect(by['abele-brave-search']).toMatchObject({ state: 'not-synced', at: null })
    expect(by['abele-provider-gone']).toMatchObject({
      name: 'abele-provider-gone',
      unused: true,
      state: 'synced',
    })
    expect(by['abele-provider-deleted']).toBeUndefined()
    // The ones the settings use come first, in the settings' order.
    expect(rows[rows.length - 1].id).toBe('abele-provider-gone')
  })

  it('with the store locked, cannot say how a key stands with it', () => {
    const rows = secretCatalog(settings, view({ 'abele-provider-p': 'x' }, 'locked'))
    expect(rows.find((r) => r.id === 'abele-provider-p')!.state).toBe('locked')
    expect(rows.find((r) => r.id === 'abele-secret-1')!.state).toBe('unset')
  })
})

describe('copying all of them', () => {
  it('is one line per set key, its name and keychain id, then the value', () => {
    const values: Record<string, string> = {
      'abele-provider-p': 'fake-p',
      'abele-secret-1': 'fake-weather',
    }
    const rows = secretCatalog(settings, view(values))
    expect(copyAllText(rows, (id) => values[id] ?? '')).toBe(
      'OpenAI (abele-provider-p) = fake-p\nWeather (abele-secret-1) = fake-weather'
    )
  })
})
