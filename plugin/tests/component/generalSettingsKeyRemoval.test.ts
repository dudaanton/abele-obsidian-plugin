import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import Icon from '@/components/obsidian/Icon.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

let screen: ReturnType<typeof mount> | null = null
afterEach(() => {
  screen?.unmount()
  screen = null
  vi.restoreAllMocks()
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
