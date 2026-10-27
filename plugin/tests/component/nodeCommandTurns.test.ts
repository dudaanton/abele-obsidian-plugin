import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import { expect, it, vi } from 'vitest'
import { chatBlocks } from '@/ai/toolRuns'
import { nodeCardPlacement } from '@/node/cardPlacement'
import NodeDelegations from '@/components/NodeDelegations.vue'
import { nodeManagerFixture } from '@/testing/nodeManagerFixture'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { ResultStore } from '@/ai/resultStore'
import { nodeCommandIdentity } from '@/node/commandIdentity'
import type { AgentToolResult } from '@/ai/client'
import { parseChat, serializeChat } from '@/ai/ChatLog'

const state = vi.hoisted(() => ({ connection: undefined as unknown }))

it.each([false, true])('restores old saved command placement with stored result=%s', (stored) => {
  useVault([])
  const card = nodeManagerFixture('exited')
  card.operation = 'wire-operation'
  card.run.stdout = 'sample output '.repeat(16000)
  // With output first, the preview contains no identity: recovery must use the call ID.
  const { stdout, ...remainingRun } = card.run
  const run = stored ? { stdout, ...remainingRun } : card.run
  const result: AgentToolResult = { content: [{ type: 'text', text: JSON.stringify(run) }] }
  new ResultStore({ messages: () => [] }).keep('node_command_run', 'old-call', result)
  const messages: ChatMessage[] = [
    { id: 'question', role: 'user', content: 'Check sample project', timestamp: 1 },
    {
      id: 'command',
      role: 'tool-call',
      content: '',
      timestamp: 2,
      toolCallId: 'old-call',
      toolName: 'node_command_run',
      toolParams: { operation_id: 'model-alias' },
      toolStatus: 'approved',
      toolResult: result.content[0].text,
    },
    { id: 'answer', role: 'assistant', content: 'Sample checks finished', timestamp: 3 },
  ]
  const parsed = parseChat(
    serializeChat({
      metadata: { type: 'abele-chat', title: 'Sample chat', created: '2023-11-14' },
      messages,
      internalMessages: stored
        ? [
            {
              role: 'toolResult',
              toolCallId: 'old-call',
              toolName: 'node_command_run',
              content: result.content,
              stored: result.stored,
              timestamp: 2,
            },
          ]
        : [],
    })
  )
  const original = nodeCardPlacement(chatBlocks(parsed.messages), parsed.messages)
  expect(original.command).toContain('run:sample-session:sample-command')
  if (stored)
    expect(parsed.messages[1].nodeCommandRun).toEqual({
      session_id: 'sample-session',
      run_id: 'sample-command',
    })
  state.connection = {
    state: ref('connected'),
    delegationCards: ref({}),
    managerCards: ref({ 'sample-chat': [card] }),
  }
  const footer = mount(NodeDelegations, {
    props: { parentId: 'sample-chat', exclude: Object.values(original).flat() },
  })
  try {
    expect(footer.findAll('.abele-node-manager-run')).toHaveLength(0)
  } finally {
    footer.unmount()
  }
  parsed.messages.push(
    { id: 'next-question', role: 'user', content: 'Read sample file', timestamp: 4 },
    {
      id: 'next-read',
      role: 'tool-call',
      toolName: 'node_read',
      toolResult: 'Sample text',
      content: '',
      timestamp: 5,
    },
    { id: 'next-answer', role: 'assistant', content: 'Sample file is ready', timestamp: 6 }
  )
  expect(nodeCardPlacement(chatBlocks(parsed.messages), parsed.messages)).toEqual(original)
})

it.each([1, 2])('anchors %s paged completions before the final answer across reload', (count) => {
  useVault([])
  const messages: ChatMessage[] = []
  const cards = []
  for (let index = 0; index < count; index++) {
    const card = nodeManagerFixture('exited')
    card.run.run_id = `sample-run-${index}`
    card.run.stdout = 'sample output '.repeat(16000)
    cards.push(card)
    const result: AgentToolResult = { content: [{ type: 'text', text: JSON.stringify(card.run) }] }
    new ResultStore({ messages: () => [] }).keep('node_command_run', `call-${index}`, result)
    expect(result.stored).toBeDefined()
    messages.push({
      id: `command-${index}`,
      role: 'tool-call',
      content: '',
      timestamp: index,
      toolName: 'node_command_run',
      toolParams: { operation_id: `alias-${index}` },
      toolStatus: 'approved',
      toolResult: result.content.map((c) => c.text).join(''),
      nodeCommandRun: nodeCommandIdentity('node_command_run', result),
    })
  }
  messages.push({ id: 'answer', role: 'assistant', content: 'Sample final answer', timestamp: 10 })
  state.connection = {
    state: ref('connected'),
    delegationCards: ref({}),
    managerCards: ref({ 'sample-chat': cards }),
  }
  for (const history of [messages, JSON.parse(JSON.stringify(messages)) as ChatMessage[]]) {
    const placement = nodeCardPlacement(chatBlocks(history), history)
    for (let index = 0; index < count; index++)
      expect(placement['command-0']).toContain(`run:sample-session:sample-run-${index}`)
    expect(placement.answer).toBeUndefined()
    const view = mount(
      defineComponent({
        setup: () => () =>
          h('div', [
            h(
              'section',
              h(NodeDelegations, {
                parentId: 'sample-chat',
                include: Object.values(placement).flat(),
                commands: 'finished',
              })
            ),
            h('p', 'Sample final answer'),
            h(
              'footer',
              h(NodeDelegations, {
                parentId: 'sample-chat',
                exclude: Object.values(placement).flat(),
              })
            ),
          ]),
      })
    )
    try {
      expect(view.findAll('footer .abele-node-manager-run')).toHaveLength(0)
      expect(view.findAll('section .abele-node-manager-run')).toHaveLength(count)
    } finally {
      view.unmount()
    }
  }
})
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
