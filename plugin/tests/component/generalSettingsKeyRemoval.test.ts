import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import Icon from '@/components/obsidian/Icon.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import Card from '@/components/obsidian/Card.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

let screen: ReturnType<typeof mount> | null = null
afterEach(() => {
  screen?.unmount()
  screen = null
  vi.restoreAllMocks()
})

it('does not carry a removed secret editor or its revealed value onto the next row', async () => {
  const app = useVault([])
  const config = AbeleConfig.getInstance()
  config.destroy()
  config.applySettings(undefined)
  config.ai.enabled = true
  config.ai.secrets = [
    { name: 'Sample first', keyId: 'sample-first-key' },
    { name: 'Sample second', keyId: 'sample-second-key' },
  ]
  app.secretStorage.setSecret('sample-first-key', 'first value')
  app.secretStorage.setSecret('sample-second-key', 'second value')
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  screen = mount(GeneralSettings, {
    global: { stubs: { Input: true, Dropdown: true, Search: true } },
  })
  const card = (title: string) =>
    screen!.findAllComponents(Card).find((item) => item.props('title') === title)!
  await card('Sample first').trigger('click')
  await card('Sample first')
    .findAllComponents(Icon)
    .find((icon) => icon.props('tooltip') === 'Reveal')!
    .vm.$emit('click')
  await card('Sample first')
    .findAllComponents(Icon)
    .find((icon) => icon.props('tooltip') === 'Remove this secret')!
    .vm.$emit('click')
  await screen.findComponent(ConfirmModal).vm.$emit('confirm')
  expect(screen.find('.abele-ai-secret__editor').exists()).toBe(false)
  await card('Sample second').trigger('click')
  expect(card('Sample second').find('input[type="password"]').exists()).toBe(true)
})

it('keeps a key still used by voice input when its image provider is deleted', async () => {
  const app = useVault([])
  const config = AbeleConfig.getInstance()
  config.destroy()
  config.applySettings(undefined)
  config.ai.enabled = true
  config.ai.imageProviders = [
    {
      id: 'sample-image-provider',
      name: 'Sample image provider',
      apiType: 'openai',
      endpoint: '',
      apiKeyId: 'sample-shared-key',
      models: [],
    },
  ]
  config.ai.voice = {
    modelId: 'sample-model',
    endpoint: '',
    apiKeyId: 'sample-shared-key',
    language: '',
  }
  app.secretStorage.setSecret('sample-shared-key', 'sample-value')
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  screen = mount(GeneralSettings, {
    global: { stubs: { Input: true, Dropdown: true, Search: true } },
  })
  await screen
    .findAllComponents(Icon)
    .find((icon) => icon.props('tooltip') === 'Remove this provider and its models')!
    .vm.$emit('click')
  await screen.findComponent(ConfirmModal).vm.$emit('confirm')
  expect(config.ai.imageProviders).toEqual([])
  expect(app.secretStorage.getSecret('sample-shared-key')).toBe('sample-value')
})

it('removes the stored key when an image provider is deleted', async () => {
  const app = useVault([])
  const config = AbeleConfig.getInstance()
  config.destroy()
  config.applySettings(undefined)
  config.ai.enabled = true
  config.ai.imageProviders = [
    {
      id: 'sample-image-provider',
      name: 'Sample image provider',
      apiType: 'openai',
      endpoint: '',
      apiKeyId: 'sample-image-key',
      models: [],
    },
  ]
  app.secretStorage.setSecret('sample-image-key', 'sample-value')
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  screen = mount(GeneralSettings, {
    global: { stubs: { Input: true, Dropdown: true, Search: true } },
  })
  await screen
    .findAllComponents(Icon)
    .find((icon) => icon.props('tooltip') === 'Remove this provider and its models')!
    .vm.$emit('click')
  await screen.findComponent(ConfirmModal).vm.$emit('confirm')
  expect(config.ai.imageProviders).toEqual([])
  expect(app.secretStorage.getSecret('sample-image-key')).toBe('')
})
