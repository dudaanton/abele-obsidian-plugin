import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { OpenAIClient } from '@/ai/client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'
import { initializeDestinations } from '@/secrets/destinations'

let screen: ReturnType<typeof mount> | undefined
afterEach(() => {
  screen?.unmount()
  screen = undefined
  vi.restoreAllMocks()
  AbeleConfig.getInstance().destroy()
})

it('saves and clears independent native client-name rows beside each connection and uses the name for listing', async () => {
  const app = useVault([])
  const config = AbeleConfig.getInstance()
  config.destroy()
  config.applySettings(undefined)
  config.ai.enabled = true
  config.ai.providers = ['sample-first', 'sample-second'].map((id) => ({
    id,
    name: id,
    baseUrl: 'https://sample.invalid/v1',
    apiKeyId: 'sample-slot',
    models: [],
  }))
  config.ai.imageProviders = [
    {
      id: 'sample-image',
      name: 'Sample image',
      apiType: 'openai',
      endpoint: '',
      apiKeyId: '',
      models: [],
    },
  ]
  app.secretStorage.setSecret('sample-slot', 'sample-key')
  initializeDestinations(config)
  const save = vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  const fetch = vi.spyOn(OpenAIClient.prototype, 'fetchModels').mockResolvedValue([])
  screen = mount(GeneralSettings, { global: { stubs: { Dropdown: true, Search: true } } })
  const rows = screen
    .findAllComponents(Setting)
    .filter((row) => row.props('name') === 'Client name')
  expect(rows).toHaveLength(4)
  for (const row of rows) {
    expect(row.find('.setting-item-name').text()).toBe('Client name')
    expect(row.props('desc')).toContain('Empty keeps the default')
    expect(row.props('desc')).toContain('Mobile streaming may ignore it')
    expect((row.find('input').element as HTMLInputElement).value).toBe('')
  }
  await rows[0].find('input').setValue('SampleClient/1.0')
  await rows[1].find('input').setValue('SecondClient/1.0')
  await rows[2].find('input').setValue('VoiceClient/1.0')
  await rows[3].find('input').setValue('ImageClient/1.0')
  await flushPromises()
  expect(config.ai.providers.map((p) => p.clientName)).toEqual([
    'SampleClient/1.0',
    'SecondClient/1.0',
  ])
  expect(config.ai.voice.clientName).toBe('VoiceClient/1.0')
  expect(config.ai.imageProviders[0].clientName).toBe('ImageClient/1.0')
  expect(save).toHaveBeenCalled()
  expect(config.ai.providers[0].apiKeyId).toBe('sample-slot')
  expect(app.secretStorage.getSecret('sample-slot')).toBe('sample-key')
  await screen
    .findAllComponents(Icon)
    .find((icon) => icon.props('tooltip') === 'Fetch models from API')!
    .vm.$emit('click')
  await flushPromises()
  expect(fetch).toHaveBeenCalledWith('https://sample.invalid/v1', 'sample-key', 'SampleClient/1.0')
  await rows[0].find('input').setValue('')
  expect(config.ai.providers[0].clientName).toBe('')
  expect(config.ai.providers[1].clientName).toBe('SecondClient/1.0')
})
