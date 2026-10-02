import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Setting from '@/components/obsidian/Setting.vue'
import { OpenAIClient } from '@/ai/client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

let screen: ReturnType<typeof mount> | null = null
afterEach(() => {
  screen?.unmount()
  screen = null
  vi.restoreAllMocks()
})

it('saves the whole provider/model key selected for background work', async () => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.destroy()
  config.applySettings(undefined)
  config.ai.enabled = true
  const model = {
    id: 'sample-model',
    name: 'Sample',
    contextWindow: 1000,
    maxTokens: 100,
    supportsReasoning: false,
  }
  config.ai.providers = ['sample-first', 'sample-second'].map((id) => ({
    id,
    name: id,
    baseUrl: 'https://sample.invalid/v1',
    apiKeyId: '',
    models: [model],
  }))
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  screen = mount(GeneralSettings, {
    global: { stubs: { Input: true, Dropdown: true, Search: true } },
  })
  const setting = screen
    .findAllComponents(Setting)
    .find((item) => item.props('name') === 'Auxiliary Model')!
  await setting
    .findComponent(Dropdown)
    .vm.$emit('update:model-value', 'sample-second::sample-model')
  expect(config.ai.auxiliaryModelId).toBe('sample-second::sample-model')
  expect(setting.findComponent(Dropdown).props('modelValue')).toBe('sample-second::sample-model')
})

it('toggles a fetched model once from its checkbox and once from its label', async () => {
  const app = useVault([])
  const config = AbeleConfig.getInstance()
  config.destroy()
  config.applySettings(undefined)
  config.ai.enabled = true
  config.ai.providers = [
    {
      id: 'sample-provider',
      name: 'Sample',
      baseUrl: 'https://sample.invalid/v1',
      apiKeyId: 'sample-key',
      models: [],
    },
  ]
  app.secretStorage.setSecret('sample-key', 'sample-value')
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  vi.spyOn(OpenAIClient.prototype, 'fetchModels').mockResolvedValue([{ id: 'sample-model' }])
  screen = mount(GeneralSettings, {
    global: { stubs: { Input: true, Dropdown: true, Search: true } },
  })
  await screen
    .findAllComponents(Icon)
    .find((icon) => icon.props('tooltip') === 'Fetch models from API')!
    .vm.$emit('click')
  await flushPromises()
  const row = screen.find('.abele-ai-provider__remote-item')
  expect(row.exists()).toBe(true)
  await row.find('.checkbox-container').trigger('click')
  expect(config.ai.providers[0].models.map((model) => model.id)).toEqual(['sample-model'])
  await row.find('span').trigger('click')
  expect(config.ai.providers[0].models).toEqual([])
})
