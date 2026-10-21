import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { useVault } from '../helpers/testEnv'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ensureNodeAgents, nodeToolRunners } from '@/node/nodeAgentTools'
import AgentsSettings from '@/components/settings/ai/AgentsSettings.vue'
import AgentEditorModal from '@/components/settings/ai/AgentEditorModal.vue'
import ChatToolModes from '@/components/ChatToolModes.vue'

afterEach(() => vi.restoreAllMocks())
it('lists node agents beside vault agents and opens the shared editor with device state and the same tool controls', async () => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue()
  AgentRegistry.getInstance().create({ name: 'Sample vault agent' })
  const [agent] = ensureNodeAgents('sample-node', 'Sample node', ['claude'])
  const list = mount(AgentsSettings, { global: { stubs: { AgentEditorModal: true } } })
  expect(list.text()).toContain('Sample vault agent')
  expect(list.text()).toContain('Claude Code')
  expect(list.text()).toContain('Sample node')
  expect(list.text().match(/Sample node/g)).toHaveLength(1)
  list.unmount()
  nodeToolRunners['sample-node'] = { state: 'device', device: 'Sample desktop' }
  const editor = mount(AgentEditorModal, {
    props: { agentId: agent.id },
    global: {
      stubs: {
        ObsidianModal: { template: '<div><slot /></div>' },
        ToolModesEditor: true,
        ChatToolModes: true,
        AiScopeEditor: true,
        Dropdown: true,
        Search: true,
      },
    },
  })
  try {
    expect(editor.findAll('.abele-tabs__tab').map((tab) => tab.text())).toEqual(['Basic', 'Access'])
    expect(editor.text()).toContain('Runs in Obsidian on Sample desktop')
    expect(editor.find('.abele-status-dot_green').exists()).toBe(true)
    expect(editor.text()).not.toContain('always available')
    expect(editor.text()).not.toContain('permission mode above')
    expect(editor.text()).not.toContain('Off = unavailable')
    expect(editor.findComponent(ChatToolModes).exists()).toBe(true)
    expect(
      editor
        .findComponent(ChatToolModes)
        .props('registry')
        .some((tool: { name: string }) => tool.name === 'create')
    ).toBe(true)
    nodeToolRunners['sample-node'] = { state: 'none' }
    await editor.vm.$nextTick()
    expect(editor.find('.abele-status-dot_orange').exists()).toBe(true)
  } finally {
    editor.unmount()
    delete nodeToolRunners['sample-node']
  }
})
