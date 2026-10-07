import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Input from '@/components/obsidian/Input.vue'
import { OpenAIClient } from '@/ai/client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'
import { FakeSettings } from '../helpers/fakeSettings'

let screen: ReturnType<typeof mount> | null = null
afterEach(() => {
  screen?.unmount()
  screen = null
  vi.restoreAllMocks()
  AbeleConfig.getInstance().destroy()
})

it('saves a timeout in seconds, rejects invalid values and follows incoming settings', async () => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.destroy()
  config.applySettings(undefined)
  config.ai.enabled = true
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  screen = mount(GeneralSettings, {
    global: { stubs: { Input: true, Dropdown: true, Search: true } },
  })
  const setting = screen
    .findAllComponents(Setting)
    .find((item) => item.props('name') === 'Request timeout (seconds)')!
  expect(setting).toBeDefined()
  const input = setting.findComponent(Input)
  expect(input.props('modelValue')).toBe('60')
  await input.vm.$emit('update:model-value', '180')
  expect(config.ai.requestTimeoutSeconds).toBe(180)
  for (const value of ['0', '-1', 'Infinity', 'not a number', '3601']) {
    await input.vm.$emit('update:model-value', value)
    expect(config.ai.requestTimeoutSeconds).toBe(180)
  }
  await input.vm.$emit('update:model-value', '')
  expect(config.ai.requestTimeoutSeconds).toBe(60)
  const disk = new FakeSettings()
  config.init(disk as never)
  const incoming = config.exportSettings()
  incoming.ai = { ...incoming.ai!, requestTimeoutSeconds: 240 }
  disk.stored = incoming
  await config.reloadSettings()
  await flushPromises()
  expect(input.props('modelValue')).toBe('240')
})

it('shows invalid global timeout input without saving a different value', async () => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.destroy()
  config.applySettings(undefined)
  config.ai.enabled = true
  const save = vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  screen = mount(GeneralSettings, {
    global: { stubs: { Dropdown: true, Search: true } },
  })
  const setting = screen
    .findAllComponents(Setting)
    .find((item) => item.props('name') === 'Request timeout (seconds)')!
  const input = setting.find('input')
  await input.setValue('500')
  expect(config.ai.requestTimeoutSeconds).toBe(500)
  await flushPromises()
  const calls = save.mock.calls.length
  await input.setValue('5000')
  expect((input.element as HTMLInputElement).value).toBe('5000')
  expect(input.attributes('aria-invalid')).toBe('true')
  expect(setting.find('[role="alert"]').text()).toContain('1–3600')
  expect(config.ai.requestTimeoutSeconds).toBe(500)
  await flushPromises()
  expect(save.mock.calls.length).toBe(calls)
  await input.setValue('300')
  expect(setting.find('[role="alert"]').exists()).toBe(false)
  expect(config.ai.requestTimeoutSeconds).toBe(300)
  await input.setValue('')
  expect(config.ai.requestTimeoutSeconds).toBe(60)
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
  expect(row.find('.checkbox-container').attributes('aria-checked')).toBe('true')
  await row.find('span').trigger('click')
  expect(config.ai.providers[0].models).toEqual([])
  for (const key of [' ', 'Enter']) {
    const control = row.find('.checkbox-container')
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    control.element.dispatchEvent(event)
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(config.ai.providers[0].models.map((model) => model.id)).toEqual(['sample-model'])
    expect(control.attributes('aria-checked')).toBe('true')
    await row.find('span').trigger('click')
    expect(config.ai.providers[0].models).toEqual([])
    expect(control.attributes('aria-checked')).toBe('false')
  }
})
