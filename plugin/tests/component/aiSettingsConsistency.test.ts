import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
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
    conversationVersion: ref(0), messages: ref([]), findMessage: () => undefined,
    updateVisibleMessages: () => {}, save: async () => {},
    defaultInterceptor: () => ({ agentId: reviewer.id, contextDepth: 0 }),
  })
  const overridden = ref(true)
  const clearOverride = vi.fn(() => { overridden.value = false })
  const session = fakeChatSession({ overrides: {
    agent: shallowRef(agent), interceptor, activeModelId: ref('sample-model'),
    activeProviderId: ref('sample-provider'), isOverridden: () => overridden.value,
    permissionMode: ref('allow-edit'),
    scopeResolver: { entries: ref([]), fullVaultAccess: ref(false) },
    customSystemPrompt: ref(''), customSystemPromptNotePath: ref(''),
    clearOverride, save: vi.fn(async () => {}),
  } })
  vi.spyOn(ChatService, 'getInstance').mockReturnValue({ activeSession: shallowRef(session) } as never)
  return { agent, reviewer, interceptor, clearOverride, session }
}

it('keeps agent exclusion, missing scripts, chat inheritance and valid patterns', async () => {
  const { agent, reviewer, interceptor } = seed()
  AgentRegistry.getInstance().update(agent.id, { interceptorScript: 'Missing sample' })
  const editor = open(AgentEditorModal, { agentId: agent.id })
  const options = row(editor, 'Interceptor').findComponent(Dropdown).props('options')
  expect(options.map((o: { value: string }) => o.value)).toEqual(['', reviewer.id, 'script:Missing sample'])
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
  await editor.findAll('.abele-tabs__tab').find((tab) => tab.text() === 'Access')!.trigger('click')
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
  await notice.findAllComponents(Icon).find((icon) => icon.props('icon') === 'undo-2')!.vm.$emit('click')
  expect(clearOverride.mock.calls.map((call) => call[0])).toEqual(['modelId', 'providerId'])
  expect(session.save).toHaveBeenCalledOnce()
})

it('edits named secrets through the existing key editor and keeps their transfer identity', async () => {
  const config = AbeleConfig.getInstance()
  config.ai.secrets = [{ id: 'sample-secret', name: 'Sample key', keyId: 'sample-key', allowedOrigins: ['https://sample.invalid'] }]
  const general = open(GeneralSettings)
  await general.findAll('.abele-card').find((card) => card.text().includes('Sample key'))!.trigger('click')
  const field = general.find('.abele-ai-secret__editor').findComponent(SecretField)
  expect(field.exists()).toBe(true)
  await field.vm.$emit('update:model-value', 'sample-value')
  await field.vm.$emit('save')
  expect(config.ai.secrets[0]).toEqual({ id: 'sample-secret', name: 'Sample key', keyId: 'sample-key', allowedOrigins: ['https://sample.invalid'] })
  expect(collectEntries(config.exportSettings()).some((entry) => entry.secretIds?.includes('sample-key'))).toBe(true)
})
