import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import ProviderSettings from '@/components/settings/ai/ProviderSettings.vue'
import AgentEditorModal from '@/components/settings/ai/AgentEditorModal.vue'
import AiChatSettings from '@/components/AiChatSettings.vue'
import AiScopeManager from '@/components/AiScopeManager.vue'
import AgentOverrideNotice from '@/components/AgentOverrideNotice.vue'
import SecretField from '@/components/settings/SecretField.vue'
import Input from '@/components/obsidian/Input.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { ChatService } from '@/ai/ChatService'
import { ChatInterceptor } from '@/ai/ChatInterceptor'
import { ScriptService } from '@/scripting/ScriptService'
import { collectEntries } from '@/transfer/entries'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'

const screens: VueWrapper[] = []
const stubs = {
  ObsidianModal: { template: '<div><slot /></div>' },
  Dropdown: {
    props: ['modelValue', 'options'],
    emits: ['update:model-value'],
    template: `<select :value="modelValue" @change="$emit('update:model-value', $event.target.value)"><option v-for="o in options" :value="o.value">{{ o.display }}</option></select>`,
  },
  Search: true,
  AiScopeEditor: true,
  ToolModesEditor: true,
}
const open = (component: Parameters<typeof mount>[0], props = {}) => {
  const screen = mount(component, { props, global: { stubs } })
  screens.push(screen)
  return screen
}
const row = (screen: VueWrapper, name: string) =>
  screen.findAllComponents(Setting).find((item) => item.props('name') === name)!

beforeEach(() => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.destroy()
  config.applySettings(undefined)
  config.ai.enabled = true
  config.ai.agents = []
  AgentRegistry.destroy()
  ScriptService.getInstance().scriptList.value = []
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
})
afterEach(() => {
  for (const screen of screens.splice(0)) screen.unmount()
  vi.restoreAllMocks()
})

function seed() {
  const registry = AgentRegistry.getInstance()
  const reviewer = registry.create({ name: 'Sample reviewer', utility: true })
  const agent = registry.create({ name: 'Sample agent', interceptorAgentId: reviewer.id })
  const interceptor = new ChatInterceptor({
    conversationVersion: ref(0),
    messages: ref([]),
    findMessage: () => undefined,
    updateVisibleMessages: () => {},
    save: async () => {},
    defaultInterceptor: () => ({ agentId: reviewer.id, contextDepth: 0 }),
  })
  const overridden = ref(true)
  const clearOverride = vi.fn(() => {
    overridden.value = false
  })
  const session = fakeChatSession({
    overrides: {
      agent: shallowRef(agent),
      interceptor,
      activeModelId: ref('sample-model'),
      activeProviderId: ref('sample-provider'),
      isOverridden: () => overridden.value,
      permissionMode: ref('allow-edit'),
      scopeResolver: { entries: ref([]), fullVaultAccess: ref(false) },
      customSystemPrompt: ref(''),
      customSystemPromptNotePath: ref(''),
      clearOverride,
      save: vi.fn(async () => {}),
    },
  })
  vi.spyOn(ChatService, 'getInstance').mockReturnValue({
    activeSession: shallowRef(session),
  } as never)
  return { agent, reviewer, interceptor, clearOverride, session }
}

it('keeps agent exclusion, missing scripts, chat inheritance and valid patterns', async () => {
  const { agent, reviewer, interceptor } = seed()
  AgentRegistry.getInstance().update(agent.id, { interceptorScript: 'Missing sample' })
  const editor = open(AgentEditorModal, { agentId: agent.id })
  const options = row(editor, 'Interceptor').findComponent(Dropdown).props('options')
  expect(options.map((o: { value: string }) => o.value)).toEqual([
    '',
    reviewer.id,
    'script:Missing sample',
  ])
  expect(options.at(-1).display).toBe('Script: Missing sample · missing')
  const chat = open(AiChatSettings)
  const picker = row(chat, 'Interceptor').find('select')
  expect((picker.element as HTMLSelectElement).value).toBe(':agent')
  await picker.setValue(reviewer.id)
  expect(interceptor.followsAgent).toBe(false)
  const pattern = row(chat, 'Only messages matching').findComponent(Input)
  await pattern.vm.$emit('update:model-value', '^sample')
  await pattern.vm.$emit('update:model-value', '[')
  expect(interceptor.pattern.value).toBe('^sample')
  expect(chat.find('.mod-warning').text()).toContain('Not saved:')
  await picker.setValue(':agent')
  expect(interceptor.followsAgent).toBe(true)
})

it('uses the same interceptor field descriptions in the agent and chat editors', () => {
  const { agent } = seed()
  const editor = open(AgentEditorModal, { agentId: agent.id })
  const chat = open(AiChatSettings)
  for (const name of ['Only messages matching', 'Reply only', 'Interceptor context']) {
    expect(row(chat, name).props('desc')).toBe(row(editor, name).props('desc'))
  }
})

it('uses the clearer permission labels with unchanged stored values on both screens', async () => {
  const { agent } = seed()
  const editor = open(AgentEditorModal, { agentId: agent.id })
  await editor
    .findAll('.abele-tabs__tab')
    .find((tab) => tab.text() === 'Access')!
    .trigger('click')
  const scope = open(AiScopeManager)
  const expected = [
    { value: 'confirm-all', display: 'Ask before every change' },
    { value: 'allow-edit', display: 'Edit files without asking' },
    { value: 'allow-all', display: 'Everything without asking' },
  ]
  expect(row(editor, 'Permission mode').findComponent(Dropdown).props('options')).toEqual(expected)
  expect(row(scope, 'Permission mode').findComponent(Dropdown).props('options')).toEqual(expected)
})

it('uses the shared override notice for models and resets both model fields', async () => {
  const { clearOverride, session } = seed()
  const chat = open(AiChatSettings)
  const notice = chat.findComponent(AgentOverrideNotice)
  expect(notice.exists()).toBe(true)
  expect(notice.text()).toContain('Overridden for this chat.')
  await notice
    .findAllComponents(Icon)
    .find((icon) => icon.props('icon') === 'undo-2')!
    .vm.$emit('click')
  expect(clearOverride.mock.calls.map((call) => call[0])).toEqual(['modelId', 'providerId'])
  expect(session.save).toHaveBeenCalledOnce()
})

it('edits named secrets through the existing key editor and keeps their transfer identity', async () => {
  const config = AbeleConfig.getInstance()
  config.ai.secrets = [
    {
      id: 'sample-secret',
      name: 'Sample key',
      keyId: 'sample-key',
      allowedOrigins: ['https://sample.invalid'],
    },
  ]
  const general = open(GeneralSettings)
  await general
    .findAll('.abele-card')
    .find((card) => card.text().includes('Sample key'))!
    .trigger('click')
  const field = general.find('.abele-ai-secret__editor').findComponent(SecretField)
  expect(field.exists()).toBe(true)
  await field.vm.$emit('update:model-value', 'sample-value')
  await field.vm.$emit('save')
  expect(config.ai.secrets[0]).toEqual({
    id: 'sample-secret',
    name: 'Sample key',
    keyId: 'sample-key',
    allowedOrigins: ['https://sample.invalid'],
  })
  expect(
    collectEntries(config.exportSettings()).some((entry) => entry.secretIds?.includes('sample-key'))
  ).toBe(true)
})

it('assembles chat and image provider fields once while preserving endpoints, model keys and secret ids', async () => {
  const config = AbeleConfig.getInstance()
  config.ai.providers = [
    {
      id: 'sample-chat',
      name: 'Sample chat',
      baseUrl: 'https://sample.invalid/v1',
      apiKeyId: 'sample-chat-key',
      models: [],
    },
  ]
  config.ai.imageProviders = [
    {
      id: 'sample-image',
      name: 'Sample image',
      apiType: 'openai',
      endpoint: 'https://sample.invalid/images',
      apiKeyId: 'sample-image-key',
      models: [],
    },
  ]
  const general = open(GeneralSettings, { page: 'models' })
  const providers = general.findAllComponents(ProviderSettings)
  expect(providers).toHaveLength(2)
  for (const provider of providers) {
    // On the list, one row a provider; its fields are in its own window.
    expect(provider.findAllComponents(Input)).toHaveLength(0)
    await provider
      .findAllComponents(Icon)
      .find((icon) => icon.props('tooltip') === 'Change this provider and its models')!
      .trigger('click')
    const names = provider.findAllComponents(Setting).map((item) => item.props('name'))
    expect(names).toContain('API key')
    // The models under a heading of their own in that window.
    expect(
      provider
        .findAllComponents(Setting)
        .find((item) => item.props('heading') && item.props('name') === 'Models')
    ).toBeDefined()
    await row(provider, 'Name')
      .findComponent(Input)
      .vm.$emit('update:model-value', 'Renamed sample')
    await row(provider, 'Client name')
      .findComponent(Input)
      .vm.$emit('update:model-value', 'sample-client')
  }
  expect(config.ai.providers[0]).toMatchObject({
    name: 'Renamed sample',
    clientName: 'sample-client',
    baseUrl: 'https://sample.invalid/v1',
    apiKeyId: 'sample-chat-key',
  })
  expect(config.ai.imageProviders[0]).toMatchObject({
    name: 'Renamed sample',
    clientName: 'sample-client',
    endpoint: 'https://sample.invalid/images',
    apiKeyId: 'sample-image-key',
  })
  const entries = collectEntries(config.exportSettings())
  for (const id of ['sample-chat-key', 'sample-image-key']) {
    expect(entries.some((entry) => entry.secretIds?.includes(id))).toBe(true)
  }
})

it('lists each provider as a row saying whether its key is in and how many models it brings', async () => {
  const app = useVault([])
  const config = AbeleConfig.getInstance()
  config.ai.providers = [
    {
      id: 'sample-keyed',
      name: 'Sample keyed',
      baseUrl: 'https://sample.invalid/v1',
      apiKeyId: 'sample-keyed-key',
      models: [{ id: 'sample-one' }, { id: 'sample-two' }] as never,
    },
    {
      id: 'sample-bare',
      name: 'Sample bare',
      baseUrl: 'https://sample.invalid/v1',
      apiKeyId: 'sample-bare-key',
      models: [],
    },
  ]
  config.ai.imageProviders = []
  app.secretStorage.setSecret('sample-keyed-key', 'sample-value')
  const general = open(GeneralSettings, { page: 'models' })
  const rows = general.findAll('.abele-ai-provider')
  expect(rows.map((r) => r.find('.setting-item-name').text())).toEqual([
    'Sample keyed',
    'Sample bare',
  ])
  const descs = rows.map((r) => r.find('.setting-item-description span'))
  expect(descs[0].text()).toMatch(/^Key saved · 2 models$/)
  expect(descs[0].classes()).not.toContain('mod-warning')
  expect(descs[1].text()).toMatch(/^No key yet/)
  expect(descs[1].classes()).toContain('mod-warning')
  // Added from a row of its own at the end of the list.
  expect(row(general, 'Add another provider')).toBeDefined()
})
