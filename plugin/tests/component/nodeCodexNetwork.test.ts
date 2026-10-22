import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import NodeCodexNetworkRefusal from '@/components/NodeCodexNetworkRefusal.vue'
import { codexProjectNetwork } from '@/node/codexNetwork'
import NodeMessageTree from '@/components/NodeMessageTree.vue'
import { useVault } from '../helpers/testEnv'

const f = vi.hoisted(() => ({ connection: undefined as any }))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      nodes: ref([{ id: 'sample-registration', expectedNodeId: 'sample-node' }]),
      connection: () => f.connection,
    }),
  },
}))
afterEach(() => vi.restoreAllMocks())
function fixture(owner = true) {
  const project = {
    project_id: 'sample-project',
    root_path: '/sample/project',
    codex_network_enabled: false,
  }
  const client = {
    channel: { channel: { welcome: { methods: owner ? ['project.codex_permissions'] : [] } } },
    getProject: vi.fn(async () => ({ ...project })),
    setProjectCodexPermissions: vi.fn(async (_id: string, enabled: boolean) => ({
      ...project,
      codex_network_enabled: enabled,
    })),
  }
  f.connection = { state: ref('connected'), client }
  return client
}
it('enables network through the same project controller and replaces the action with retry guidance', async () => {
  const client = fixture()
  const wrapper = mount(NodeCodexNetworkRefusal, {
    props: { nodeId: 'sample-node', projectId: 'sample-project' },
  })
  await flushPromises()
  expect(wrapper.text()).toContain('Network is off for Codex in project.')
  expect(wrapper.find('.abele-status-dot_orange').exists()).toBe(true)
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(client.setProjectCodexPermissions).toHaveBeenCalledWith('sample-project', true)
  expect(codexProjectNetwork(client as never, 'sample-project').enabled.value).toBe(true)
  expect(wrapper.text()).toContain('Network is on. Ask the agent to try again.')
  expect(wrapper.find('button').exists()).toBe(false)
  expect(wrapper.find('.abele-status-dot_faint').exists()).toBe(true)
  wrapper.unmount()
})
it('gives a non-owner the exact project-menu path without an action', async () => {
  fixture(false)
  const wrapper = mount(NodeCodexNetworkRefusal, {
    props: { nodeId: 'sample-node', projectId: 'sample-project' },
  })
  await flushPromises()
  expect(wrapper.text()).toContain(
    'Only the node’s owner can turn it on: the project menu → Network for Codex.'
  )
  expect(wrapper.find('button').exists()).toBe(false)
  wrapper.unmount()
})
it('refreshes negotiated permission after reconnecting an initially offline node', async () => {
  const client = fixture(false)
  f.connection.state.value = 'offline'
  const wrapper = mount(NodeCodexNetworkRefusal, {
    props: { nodeId: 'sample-node', projectId: 'sample-project' },
  })
  await flushPromises()
  client.channel.channel.welcome.methods.push('project.codex_permissions')
  f.connection.state.value = 'connected'
  await flushPromises()
  expect(wrapper.text()).toContain('Network is off for Codex in project.')
  expect(wrapper.find('button').exists()).toBe(true)
  wrapper.unmount()
})
it('keeps a failed setting change actionable and disables it while offline', async () => {
  const client = fixture()
  client.setProjectCodexPermissions.mockRejectedValueOnce(new Error('disconnected'))
  const wrapper = mount(NodeCodexNetworkRefusal, {
    props: { nodeId: 'sample-node', projectId: 'sample-project' },
  })
  await flushPromises()
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(wrapper.find('button').exists()).toBe(true)
  expect(codexProjectNetwork(client as never, 'sample-project').enabled.value).toBe(false)
  f.connection.state.value = 'offline'
  await flushPromises()
  expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

it('keeps a refusal visible on a folded tool run and retains the original tool details', async () => {
  useVault([])
  fixture()
  const raw = 'Network is disabled: package installs require the project network switch.'
  const wrapper = mount(NodeMessageTree, {
    props: {
      messages: [
        {
          id: 'sample-call',
          role: 'tool-call',
          toolName: 'Bash',
          toolParams: { command: 'npm ci' },
          toolStatus: 'error',
          content: '',
          toolResult: raw,
          timestamp: 0,
        },
      ],
      children: {},
      openResource: () => {},
      target: {
        registrationId: 'sample-registration',
        nodeId: 'sample-node',
        projectId: 'sample-project',
        kind: 'worktree',
        id: 'sample-worktree',
      },
    },
  })
  await flushPromises()
  expect(wrapper.find('[data-codex-network-refusal]').exists()).toBe(true)
  expect(wrapper.text()).not.toContain(raw)
  await wrapper.get('.abele-chat-run > .tree-item-self').trigger('click')
  await flushPromises()
  expect(wrapper.findAll('[data-codex-network-refusal]')).toHaveLength(1)
  await wrapper.get('.abele-chat-msg__icon').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-find-part="result"]').text()).toBe(raw)
  wrapper.unmount()
})
