/**
 * Every feature that needs a key reads it through the one accessor, `secrets()`. The store
 * installed here keeps its keys in a keychain of its own, and the app's keychain is left
 * empty: a feature that still went to the app's keychain directly would find nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { SecretStore, secrets, setSecrets, type Keychain } from '@/secrets/SecretStore'
import { substituteSecrets } from '@/ai/tools/secretUtils'
import { transcriptionOptions } from '@/ai/transcriptionSettings'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { createAgent } from '@/ai/agents/types'
import { githubClient, resetGithubClients } from '@/github/GithubService'
import { GITHUB_TOKEN_KEY_ID, DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { DEFAULT_TRANSCRIPTION } from '@/ai/transcription'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }))

vi.mock('obsidian', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../mocks/obsidian')),
  requestUrl,
}))

let app: FakeApp

async function storeWith(values: Record<string, string>): Promise<SecretStore> {
  const own = new Map<string, string>()
  const keychain: Keychain = {
    getSecret: (id) => own.get(id) ?? null,
    setSecret: (id, value) => void own.set(id, value),
    deleteSecret: (id) => own.delete(id),
  }
  let file: unknown = null
  const store = new SecretStore({
    keychain: () => keychain,
    read: () => file,
    write: async (next) => {
      file = next
    },
    ids: () => [],
    conflictCopies: async () => [],
    now: () => Date.now(),
  })
  await store.enable('passphrase', { iterations: 1000 })
  for (const [id, value] of Object.entries(values)) store.set(id, value)
  await store.flush()
  return store
}

beforeEach(async () => {
  app = useVault([])
  setSecrets(
    await storeWith({
      'abele-secret-weather': 'weather-key',
      [DEFAULT_TRANSCRIPTION.apiKeyId]: 'sk-or-voice',
      'abele-provider-openai': 'sk-provider',
      [GITHUB_TOKEN_KEY_ID]: 'github_pat_store',
      'abele-brave-search': 'BSA-store',
    })
  )
  const config = AbeleConfig.getInstance()
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    secrets: [{ name: 'Weather', keyId: 'abele-secret-weather' }],
    braveSearchApiKey: 'abele-brave-search',
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyId: 'abele-provider-openai',
        models: [
          { id: 'o3', name: 'o3', contextWindow: 1, maxTokens: 1, supportsReasoning: false },
        ],
      },
    ],
    agents: [],
  }
  config.github = { ...DEFAULT_GITHUB_SETTINGS, enabled: true, keyId: GITHUB_TOKEN_KEY_ID }
  resetGithubClients()
})

afterEach(() => setSecrets(null))

describe('features read their keys through the store', () => {
  it('the app keychain really is empty, so nothing below can be reading it', () => {
    expect(app.secretStorage.getSecret('abele-secret-weather')).toBe('')
    expect(secrets().get('abele-secret-weather')).toBe('weather-key')
  })

  it('named keys in scripts and fetch calls', () => {
    expect(substituteSecrets('token=${abele_key:Weather}')).toBe('token=weather-key')
  })

  it('voice input', () => {
    expect(transcriptionOptions().apiKey).toBe('sk-or-voice')
  })

  it('an agent’s model', () => {
    const model = AgentRegistry.getInstance().resolveModel(
      createAgent({ providerId: 'openai', modelId: 'o3' })
    )
    expect(model?.apiKey).toBe('sk-provider')
  })

  it('GitHub', () => {
    expect((githubClient() as unknown as { token: string }).token).toBe('github_pat_store')
  })

  it('web search', async () => {
    const { createWebSearchTool } = await import('@/ai/tools/WebSearchTool')
    requestUrl.mockResolvedValue({ status: 200, json: { web: { results: [] } } })
    await createWebSearchTool().execute('1', { query: 'q' })
    const headers = requestUrl.mock.calls[0][0].headers as Record<string, string>
    expect(headers['X-Subscription-Token']).toBe('BSA-store')
  })
})

/** Reads the source rather than trusting a list of consumers: a new one is caught too. */
describe('the one road to the keychain', () => {
  const root = join(__dirname, '../../src')
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return files(path)
      return /\.(ts|vue)$/.test(name) ? [path] : []
    })

  it('is `secrets()`: nothing outside src/secrets touches Obsidian’s secretStorage', () => {
    const offenders = files(root)
      .filter((path) => !relative(root, path).startsWith('secrets/'))
      .filter((path) => /secretStorage/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path))
    expect(offenders).toEqual([])
  })
})
