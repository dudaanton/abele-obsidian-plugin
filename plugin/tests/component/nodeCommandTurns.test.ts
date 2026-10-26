import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import { expect, it, vi } from 'vitest'
import { chatBlocks } from '@/ai/toolRuns'
import { nodeCardPlacement } from '@/node/cardPlacement'
import NodeDelegations from '@/components/NodeDelegations.vue'
import { nodeManagerFixture } from '@/testing/nodeManagerFixture'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const state = vi.hoisted(() => ({ connection: undefined as unknown }))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    peekConnection: () => undefined,
    getInstance: () => ({
      nodes: ref([{ id: 'sample-node', label: 'Sample node' }]),
      connection: () => state.connection,
    }),
  },
}))

it.each(['pending_approval', 'running', 'outcome_unknown', 'exited'] as const)(
  'keeps %s commands in the appropriate live or folded region',
  (status) => {
    useVault([])
    const card = nodeManagerFixture(status)
    state.connection = {
      state: ref('connected'),
      delegationCards: ref({}),
      managerCards: ref({ 'sample-chat': [card] }),
    }
    const live = mount(NodeDelegations, { props: { parentId: 'sample-chat', commands: 'live' } })
    const folded = mount(NodeDelegations, {
      props: { parentId: 'sample-chat', commands: 'finished' },
    })
    try {
      expect(live.findAll('.abele-node-manager-run')).toHaveLength(status === 'exited' ? 0 : 1)
      expect(folded.findAll('.abele-node-manager-run')).toHaveLength(status === 'exited' ? 1 : 0)
    } finally {
      live.unmount()
      folded.unmount()
    }
  }
)

it.each([false, true])(
  'keeps completed commands in their first turn after stop=%s',
  async (stopped) => {
    useVault([])
    const card = nodeManagerFixture('exited')
    card.operation = 'private-wire-operation'
    state.connection = {
      state: ref('connected'),
      delegationCards: ref({}),
      managerCards: ref({ 'sample-chat': [card] }),
    }
    const messages = ref<ChatMessage[]>([
      { id: 'question-a', role: 'user', content: 'Check the sample project', timestamp: 1 },
      {
        id: 'command-a',
        role: 'tool-call',
        toolName: 'node_command_run',
        toolParams: { operation_id: 'model-alias' },
        toolStatus: 'approved',
        toolResult: JSON.stringify(card.run),
        content: '',
        timestamp: 2,
      },
    ])
    const view = mount(
      defineComponent({
        setup() {
          const placements = computed(() =>
            nodeCardPlacement(chatBlocks(messages.value), messages.value)
          )
          return () =>
            h('div', [
              ...Object.entries(placements.value).map(([id, include]) =>
                h(
                  'section',
                  { 'data-owner': id },
                  h(NodeDelegations, { parentId: 'sample-chat', include })
                )
              ),
              h(
                'footer',
                h(NodeDelegations, {
                  parentId: 'sample-chat',
                  exclude: Object.values(placements.value).flat(),
                })
              ),
            ])
        },
      })
    )
    try {
      expect(view.findAll('[data-owner="command-a"] .abele-node-manager-run')).toHaveLength(1)
      messages.value.push({
        id: 'delegate-a',
        role: 'tool-call',
        toolName: 'node_delegate',
        content: '',
        timestamp: 3,
        toolStatus: stopped ? 'rejected' : 'approved',
        toolResult: stopped ? 'User rejected this action' : 'Sample task finished',
      })
      if (stopped)
        messages.value.push({ id: 'stop-a', role: 'assistant', content: 'Stopped', timestamp: 3 })
      messages.value.push(
        { id: 'question-b', role: 'user', content: 'Read the sample file', timestamp: 4 },
        {
          id: 'read-b',
          role: 'tool-call',
          toolName: 'node_read',
          toolStatus: 'approved',
          toolResult: 'sample',
          content: '',
          timestamp: 5,
        }
      )
      await view.vm.$nextTick()
      expect(view.findAll('[data-owner="command-a"] .abele-node-manager-run')).toHaveLength(1)
      expect(view.findAll('footer .abele-node-manager-run')).toHaveLength(0)
      expect(view.findAll('.abele-node-manager-run')).toHaveLength(1)
    } finally {
      view.unmount()
    }
  }
)
