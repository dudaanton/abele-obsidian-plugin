/**
 * The store wired to the plugin: which ids count as the plugin's secrets, where the store is
 * kept in the settings, and where Syncthing's conflict copies are found.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Plugin } from 'obsidian'
import { CONFLICT_COPY, pluginSecretIds, pluginStoreHost } from '@/secrets/host'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { DEFAULT_TRANSCRIPTION } from '@/ai/transcription'
import { DEFAULT_GITHUB_SETTINGS, GITHUB_TOKEN_KEY_ID } from '@/github/settings'

beforeEach(() => {
  const config = AbeleConfig.getInstance()
  config.applySettings(undefined)
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    braveSearchApiKey: 'abele-brave-search',
    secrets: [{ name: 'Weather', keyId: 'abele-secret-1' }],
    providers: [
      { id: 'p', name: 'P', baseUrl: 'http://x', apiKeyId: 'abele-provider-p', models: [] },
    ],
    imageProviders: [
      {
        id: 'i',
        name: 'I',
        apiType: 'openai',
        endpoint: '',
        apiKeyId: 'abele-img-i',
        models: [],
      },
    ],
  }
  config.github = { ...DEFAULT_GITHUB_SETTINGS, keyId: GITHUB_TOKEN_KEY_ID }
})

describe('the plugin’s secrets', () => {
  it('are every keychain id the settings point at', () => {
    expect(pluginSecretIds().sort()).toEqual(
      [
        'abele-brave-search',
        'abele-secret-1',
        'abele-provider-p',
        'abele-img-i',
        GITHUB_TOKEN_KEY_ID,
        DEFAULT_TRANSCRIPTION.apiKeyId,
      ].sort()
    )
  })
})

describe('the settings file', () => {
  it('carries the store through a load and a save untouched', () => {
    const config = AbeleConfig.getInstance()
    const store = { format: 'abele-secrets', v: 1, id: 'abc' }
    config.applySettings({ refreshDelay: 300, secretStore: store })
    expect(config.exportSettings().secretStore).toEqual(store)

    config.applySettings({ refreshDelay: 300 })
    expect('secretStore' in config.exportSettings()).toBe(false)
  })

  it('is where the host reads the store from and writes it to', async () => {
    const config = AbeleConfig.getInstance()
    const saveSettings = vi.spyOn(config, 'saveSettings').mockResolvedValue()
    const host = pluginStoreHost(fakePlugin({}))

    await host.write({ id: 'x' } as never)
    expect(host.read()).toEqual({ id: 'x' })
    await host.write(null)
    expect(host.read()).toBeUndefined()
    expect(saveSettings).toHaveBeenCalledTimes(2)
  })
})

describe('Syncthing’s conflict copies', () => {
  it('are recognised by name, and only those of data.json', () => {
    expect(
      CONFLICT_COPY.test('.obsidian/plugins/abele/data.sync-conflict-20260925-101010-ABCDEF.json')
    ).toBe(true)
    expect(CONFLICT_COPY.test('.obsidian/plugins/abele/data.json')).toBe(false)
    expect(CONFLICT_COPY.test('.obsidian/plugins/abele/book-places.sync-conflict-1.json')).toBe(
      false
    )
  })

  it('give up the store they hold, and anything unreadable is skipped', async () => {
    const dir = '.obsidian/plugins/abele'
    const host = pluginStoreHost(
      fakePlugin({
        [`${dir}/data.json`]: JSON.stringify({ secretStore: { id: 'current' } }),
        [`${dir}/data.sync-conflict-1-2-A.json`]: JSON.stringify({ secretStore: { id: 'a' } }),
        [`${dir}/data.sync-conflict-3-4-B.json`]: '{ not json',
        [`${dir}/data.sync-conflict-5-6-C.json`]: JSON.stringify({ tasksFolder: 'T' }),
      })
    )
    expect(await host.conflictCopies()).toEqual([{ id: 'a' }])
  })
})

function fakePlugin(files: Record<string, string>): Plugin {
  return {
    manifest: { dir: '.obsidian/plugins/abele' },
    app: {
      secretStorage: { getSecret: () => null, setSecret: () => {} },
      vault: {
        configDir: '.obsidian',
        adapter: {
          list: async () => ({ files: Object.keys(files), folders: [] }),
          read: async (path: string) => files[path],
        },
      },
    },
  } as unknown as Plugin
}
