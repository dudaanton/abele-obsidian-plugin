import { mount, flushPromises } from '@vue/test-utils'
import { shallowRef, ref } from 'vue'
import { expect, it, vi } from 'vitest'
import AiChatSetup from '@/components/AiChatSetup.vue'
import Button from '@/components/obsidian/Button.vue'
const mock = vi.hoisted(() => ({ active: undefined as unknown }))
vi.mock('@/ai/ChatService', () => ({
  ChatService: { getInstance: () => ({ activeSession: mock.active }) },
}))
it('keeps the save button when access changed during the pending save', async () => {
  let complete!: () => void
  const session = {
    id: 'sample-chat',
    agent: ref({ id: 'sample-agent', name: 'Sample helper' }),
    chatTitle: ref('Sample chat'),
    overrides: ref({ scope: [] as unknown[] }),
    toolModes: ref({}),
    permissionMode: ref('confirm-all'),
    scopeResolver: { entries: ref([]), fullVaultAccess: ref(false) },
    effectiveNodeScope: [],
    saveAccessAsAgentDefault: () => new Promise<void>((resolve) => (complete = resolve)),
  }
  mock.active = shallowRef(session)
  const view = mount(AiChatSetup, {
    global: {
      stubs: {
        ObsidianModal: { template: '<div><slot/><slot name="footer"/></div>' },
        Tabs: true,
        AiScopeManager: true,
        AiPermissions: true,
        AiChatSettings: true,
      },
    },
  })
  view.findComponent(Button).vm.$emit('click')
  session.overrides.value.scope = [{ type: 'folder', path: 'Other examples' }]
  await flushPromises()
  complete()
  await flushPromises()
  expect(view.find('.abele-chat-setup__saved').exists()).toBe(false)
  expect(view.text()).toContain('Save as')
  view.unmount()
})

it('shows inherited permission mode with the saved default state', async () => {
  const agent = ref({
    id: 'sample-agent',
    name: 'Sample helper',
    permissionMode: 'confirm-all',
    scope: [] as { type: string; path: string }[],
    fullVaultAccess: false,
  })
  const session = {
    id: 'sample-chat',
    agent,
    chatTitle: ref('Sample chat'),
    overrides: ref({ permissionMode: 'allow-all', scope: [{ type: 'folder', path: 'Samples' }] }),
    toolModes: ref({}),
    permissionMode: ref('allow-all'),
    scopeResolver: {
      entries: ref([{ type: 'folder', path: 'Samples' }]),
      fullVaultAccess: ref(false),
    },
    effectiveNodeScope: [],
    isOverridden: (key: string) => ['scope', 'permissionMode'].includes(key),
    saveAccessAsAgentDefault: async () => {
      agent.value.permissionMode = session.permissionMode.value
      agent.value.scope = session.scopeResolver.entries.value
    },
  }
  mock.active = shallowRef(session)
  const view = mount(AiChatSetup, {
    global: {
      stubs: {
        ObsidianModal: { template: '<div><slot/><slot name="footer"/></div>' },
        Tabs: true,
        AiScopeEditor: true,
        AiNodeScopeEditor: true,
        AiPermissions: true,
        AiChatSettings: true,
      },
    },
  })
  expect(view.text()).toContain('Overridden for this chat.')
  view.findComponent(Button).vm.$emit('click')
  await flushPromises()
  expect(view.text()).toContain('Saved as')
  expect(view.text()).toContain("Permission mode comes from this chat's agent.")
  expect(view.text()).not.toContain('Overridden for this chat.')
  view.unmount()
})
