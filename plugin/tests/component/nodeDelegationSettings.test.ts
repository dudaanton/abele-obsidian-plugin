import { mount, flushPromises } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import { expect, it, vi } from 'vitest'
import NodesSettings from '@/components/settings/NodesSettings.vue'
const f = vi.hoisted(() => ({ nodes: undefined as unknown, chats: undefined as unknown }))
vi.mock('@/node/NodeService', () => ({ NodeService: { getInstance: () => f.nodes } }))
vi.mock('@/ai/ChatService', () => ({ ChatService: { getInstance: () => f.chats } }))
it('owner approval prepares only the chosen parent, not unrelated chats that may have changed on disk', async () => {
  const current = {
    id: 'current-tab',
    chatTitle: ref('Sample parent'),
    currentChatFile: ref({ path: 'sample-parent.abchat' }),
    delegationParentId: '',
    ensureDelegationParentId: vi.fn(async () => {
      current.delegationParentId = 'sample-parent'
    }),
  }
  const unrelated = {
    id: 'unrelated-tab',
    currentChatFile: ref({ path: 'sample-unrelated.abchat' }),
    ensureDelegationParentId: vi.fn(async () => {
      throw Error('Unrelated chat changed elsewhere')
    }),
  }
  f.chats = {
    activeSession: shallowRef(current),
    tabOrder: ref(['unrelated-tab', 'current-tab']),
    getSession: (id: string) => (id === 'current-tab' ? current : unrelated),
  }
  f.nodes = {
    nodes: ref([
      {
        id: 'sample-node',
        label: 'Sample node',
        url: 'http://127.0.0.1:7777',
        expectedNodeId: 'sample-node',
      },
    ]),
    connection: () => ({
      state: ref('connected'),
      error: ref(''),
      connect: async () => {},
      delegation: {},
    }),
  }
  const wrapper = mount(NodesSettings, {
    global: {
      stubs: { NodeDelegationGrantsDialog: { template: '<div data-grants>Owner grants</div>' } },
    },
  })
  try {
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Delegation grants')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-grants]').exists()).toBe(true)
    expect(current.ensureDelegationParentId).toHaveBeenCalledTimes(1)
    expect(unrelated.ensureDelegationParentId).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})
