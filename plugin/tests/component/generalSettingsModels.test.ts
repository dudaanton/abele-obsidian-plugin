import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { OpenAIClient } from '@/ai/client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

let screen: ReturnType<typeof mount> | null = null
afterEach(() => {
  screen?.unmount()
  screen = null
  vi.restoreAllMocks()
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
