import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { NodeService } from '@/node/NodeService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { nodeManagerFixture } from '@/testing/nodeManagerFixture'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'

afterEach(() => vi.restoreAllMocks())

it('keeps approval and progress reachable in a live turn, then folds completion before the answer', async () => {
  useVault([])
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  const card = nodeManagerFixture('pending_approval')
  const messages = ref<ChatMessage[]>([
    { id: 'sample-question', role: 'user', content: 'Check the sample runtime', timestamp: 1 },
    {
      id: 'sample-call',
      role: 'tool-call',
      content: '',
      timestamp: 2,
      toolName: 'node_command_run',
      toolCallId: 'sample-call',
      toolStatus: 'approved',
      nodeCommandOperation: card.operation,
    },
  ])
  const managerCards = ref({ 'sample-parent': [card] })
  const connection = { state: ref('connected'), delegationCards: ref({}), managerCards }
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: ref([{ id: 'sample-node', label: 'Sample node' }]),
    connection: () => connection,
  } as never)
  const session = fakeChatSession({
    kind: 'chat',
    messages,
    overrides: {
      delegationParentId: 'sample-parent',
      isStreaming: ref(true),
    },
  })
  const chats = ChatService.getInstance()
  vi.spyOn(chats, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(chats, 'activeSession', 'get').mockReturnValue({ value: session } as never)
  const view = mount(AiChat)
  try {
    await flushPromises()
    expect(view.findAll('.abele-tool-approval')).toHaveLength(1)
    expect(view.get('.abele-tool-approval').text()).toContain('Allow')
    expect(view.get('.abele-tool-approval').text()).toContain('Deny')
    const commandBranch = messages.value
    messages.value = [
      commandBranch[0],
      { id: 'sample-sibling', role: 'assistant', content: 'Another branch', timestamp: 3 },
    ]
    await flushPromises()
    expect(view.findAll('.abele-node-manager-run')).toHaveLength(0)
    messages.value = commandBranch
    await flushPromises()
    expect(view.findAll('.abele-tool-approval')).toHaveLength(1)
    managerCards.value['sample-parent'][0] = nodeManagerFixture('running')
    await flushPromises()
    expect(view.findAll('.abele-node-manager-run')).toHaveLength(1)
    expect(view.find('[data-manager-stop] button').exists()).toBe(true)
    managerCards.value['sample-parent'][0] = nodeManagerFixture('exited')
    messages.value[1] = {
      ...messages.value[1],
      toolResult: JSON.stringify(managerCards.value['sample-parent'][0].run),
    }
    messages.value.push({
      id: 'sample-answer',
      role: 'assistant',
      content: 'Runtime checked',
      timestamp: 3,
    })
    session.isStreaming.value = false
    await flushPromises()
    expect(view.findAll('.abele-node-manager-run')).toHaveLength(0)
    expect(view.get('[data-run-ids="sample-call"]').classes()).toContain('is-collapsed')
    await view.get('[data-run-ids="sample-call"] > .tree-item-self').trigger('click')
    expect(view.get('[data-run-ids="sample-call"] .abele-node-manager-run').exists()).toBe(true)
  } finally {
    view.unmount()
  }
})
