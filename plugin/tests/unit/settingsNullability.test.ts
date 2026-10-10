import { afterEach, expect, it, vi } from 'vitest'
import { AbeleConfig, type AbeleSettings } from '@/services/AbeleConfig'
import { FakeSettings } from '../helpers/fakeSettings'
import { deferred } from '../helpers/deferred'
import { useVault } from '../helpers/testEnv'

const config = AbeleConfig.getInstance()
afterEach(() => {
  config.destroy()
  vi.restoreAllMocks()
})

it.each([
  {
    legacy: { openRouterApiKey: 'sample-key-id', imageModel: 'sample-image-model' },
    provider: {
      apiType: 'openrouter',
      apiKeyId: 'sample-key-id',
      model: 'sample-image-model',
      size: '1024x1024',
      outputFormat: 'png',
      quality: 'medium',
    },
  },
  {
    legacy: {
      imageGeneration: {
        apiType: 'openai',
        apiKeyId: 'sample-key-id',
        endpoint: 'https://images.example.test',
        model: 'sample-image-model',
        size: '512x512',
        outputFormat: 'jpeg',
        quality: 'high',
      },
    },
    provider: {
      apiType: 'openai',
      apiKeyId: 'sample-key-id',
      model: 'sample-image-model',
      size: '512x512',
      outputFormat: 'jpeg',
      quality: 'high',
    },
  },
])('keeps legacy image provider fields while migrating the settings', ({ legacy, provider }) => {
  // An actual old file lacks the fields required by the current persisted interface.
  config.applySettings({ refreshDelay: 321, ai: legacy } as unknown as AbeleSettings)
  const migrated = config.ai.imageProviders[0]
  expect(migrated).toMatchObject({ apiType: provider.apiType, apiKeyId: provider.apiKeyId })
  expect(migrated.models).toEqual([
    {
      id: provider.model,
      name: provider.model,
      size: provider.size,
      outputFormat: provider.outputFormat,
      quality: provider.quality,
    },
  ])
  expect(config.ai.defaultImageModel).toBe(`migrated-img::${provider.model}`)
})

it('keeps old boolean permission migration separate from the current defaults', () => {
  config.applySettings({
    refreshDelay: 321,
    ai: { allowWebSearch: false, allowFetch: true },
  } as unknown as AbeleSettings)
  expect(config.ai.toolModes.web_search).toBe('ask')
  expect(config.ai.toolModes.fetch).toBe('auto')
})

it('does not start reading settings after unloading during the startup stamp read', async () => {
  useVault([])
  const gate = deferred<{ size: number; mtime: number } | null>()
  const entered = deferred<void>()
  const disk = Object.assign(new FakeSettings({ refreshDelay: 555 }), {
    manifest: { dir: 'sample-plugin' },
    app: {
      vault: {
        adapter: {
          stat: async () => {
            entered.resolve()
            return gate.promise
          },
        },
      },
    },
  })
  const load = vi.spyOn(disk, 'loadData')
  config.init(disk as never)
  const loading = config.loadSettings()
  try {
    await entered.promise
    config.destroy()
    gate.resolve(null)
    await expect(loading).resolves.toBeUndefined()
    expect(load).not.toHaveBeenCalled()
  } finally {
    gate.resolve(null)
    await loading.catch(() => undefined)
  }
})
