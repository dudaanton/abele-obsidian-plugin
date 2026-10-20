import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, ref, shallowRef } from 'vue'
import AiChat from '@/components/AiChat.vue'
import ChatToolRun from '@/components/ChatToolRun.vue'
import ChatQuestionCard from '@/components/ChatQuestionCard.vue'
import { ChatService } from '@/ai/ChatService'
import { AgentsService } from '@/agents/AgentsService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'

const calls = (): ChatMessage[] => [
  { id: 'sample-question', role: 'user', content: 'Find a sample page', timestamp: 1 },
  {
    id: 'sample-read',
    role: 'tool-call',
    content: '',
    toolName: 'read',
    toolStatus: 'approved',
    toolResult: 'Sample page content',
    timestamp: 2,
  },
]
let view: VueWrapper | undefined
beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
})
afterEach(() => {
  view?.unmount()
  view = undefined
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
const render = async (
  active: ReturnType<typeof fakeChatSession> | ReturnType<typeof shallowRef>
) => {
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue(
    ('value' in active ? computed(() => active.value) : { value: active }) as never
  )
  view = mount(AiChat, { attachTo: document.body })
  await flushPromises()
  return view
}

describe('conversation presentation', () => {
  it('unfolds live calls and folds them when they settle, unless the reader chose otherwise', async () => {
    const messages = ref(calls())
    messages.value[1].toolResult = undefined
    const chat = await render(fakeChatSession({ kind: 'chat', messages }))
    expect(chat.findComponent(ChatToolRun).props('open')).toBe(true)
    messages.value[1].toolResult = 'Sample finished'
    await flushPromises()
    expect(chat.findComponent(ChatToolRun).props('open')).toBe(false)
    await chat.find('.abele-chat-run > .tree-item-self').trigger('click')
    expect(chat.findComponent(ChatToolRun).props('open')).toBe(true)
  })
  it('does not carry disclosure choices into another conversation that reuses a message id', async () => {
    const active = shallowRef(fakeChatSession({ kind: 'chat', messages: ref(calls()) }))
    const chat = await render(active)
    await chat.find('.abele-chat-run > .tree-item-self').trigger('click')
    expect(chat.findComponent(ChatToolRun).props('open')).toBe(true)
    active.value = fakeChatSession({
      kind: 'chat',
      messages: ref(calls()),
      overrides: { id: 'second-sample-session' },
    })
    await flushPromises()
    expect(chat.findComponent(ChatToolRun).props('open')).toBe(false)
  })
  it('keeps a thought open while it is written and folds it once the answer starts', async () => {
    const messages = ref<ChatMessage[]>([
      { id: 'sample-ask', role: 'user', content: 'Summarise the sample page', timestamp: 1 },
    ])
    const session = fakeChatSession({ kind: 'chat', messages })
    session.isStreaming.value = true
    session.streamingThinking.value = 'Reading the sample page first'
    const chat = await render(session)
    const folded = () => chat.find('.abele-chat-thinking').classes('is-collapsed')
    expect(folded()).toBe(false)
    // The answer streams after the thought: the thought is written, so it folds.
    session.streamingContent.value = 'The sample page'
    await flushPromises()
    expect(folded()).toBe(true)
    // The turn ends: the session moves the thought onto the answer it belongs to.
    messages.value = [
      ...messages.value,
      {
        id: 'sample-answer',
        role: 'assistant',
        content: 'The sample page lists three items.',
        thinking: 'Reading the sample page first',
        timestamp: 2,
      },
    ]
    session.streamingThinking.value = ''
    session.streamingContent.value = ''
    session.isStreaming.value = false
    await flushPromises()
    expect(chat.findAll('.abele-chat-thinking')).toHaveLength(1)
    expect(folded()).toBe(true)
    expect(chat.find('.abele-chat-thinking .tree-item-inner').text()).toBe('Thought')
  })
  it('opens a thought a node agent is still writing and folds it once the next step comes', async () => {
    // Node agents stream their reasoning into the message list rather than a side buffer.
    const messages = ref<ChatMessage[]>([
      { id: 'sample-ask', role: 'user', content: 'Check the sample source', timestamp: 1 },
      {
        id: 'sample-thought',
        role: 'assistant',
        content: '',
        thinking: 'Checking the sample',
        timestamp: 2,
      },
    ])
    const session = fakeChatSession({ kind: 'chat', messages })
    session.isStreaming.value = true
    const chat = await render(session)
    const thought = () => chat.find('[data-message-id="sample-thought"] .abele-chat-thinking')
    expect(thought().classes('is-collapsed')).toBe(false)
    expect(thought().find('.tree-item-inner').text()).toBe('Thinking')
    // A tool call follows while the turn goes on: the thought is done.
    messages.value = [
      ...messages.value,
      {
        id: 'sample-read',
        role: 'tool-call',
        content: '',
        toolName: 'read',
        toolStatus: 'approved',
        timestamp: 3,
      },
    ]
    await flushPromises()
    expect(thought().classes('is-collapsed')).toBe(true)
    expect(thought().find('.tree-item-inner').text()).toBe('Thought')
    // The same thought gaining its answer text is done as well.
    messages.value = [messages.value[0], { ...messages.value[1], content: 'Done.' }]
    await flushPromises()
    expect(thought().classes('is-collapsed')).toBe(true)
  })
  it('opens a reopened conversation with every thought folded', async () => {
    const chat = await render(
      fakeChatSession({
        kind: 'chat',
        messages: ref<ChatMessage[]>([
          { id: 'sample-ask', role: 'user', content: 'Summarise the sample page', timestamp: 1 },
          {
            id: 'sample-answer',
            role: 'assistant',
            content: 'The sample page lists three items.',
            thinking: 'Reading the sample page first',
            timestamp: 2,
          },
        ]),
      })
    )
    expect(chat.find('.abele-chat-thinking').classes('is-collapsed')).toBe(true)
  })
  it('keeps a written thought folded but at hand while the tools it led to run', async () => {
    const messages = ref(calls())
    messages.value.splice(1, 0, {
      id: 'sample-thought',
      role: 'assistant',
      content: '',
      thinking: 'Checking the sample source',
      timestamp: 2,
    })
    const session = fakeChatSession({
      kind: 'chat',
      messages,
      overrides: { isExecutingTool: ref(true) },
    })
    const chat = await render(session)
    const thought = chat.find('.abele-chat-thinking')
    expect(thought.classes('is-collapsed')).toBe(true)
    await thought.find('.tree-item-self').trigger('click')
    await flushPromises()
    expect(chat.find('.abele-chat-thinking').classes('is-collapsed')).toBe(false)
    expect(chat.find('[data-find-part="thinking"]').text()).toContain('Checking the sample source')
  })
  it('names every reachable place in the access tooltip and counts nodes too', async () => {
    const chat = await render(
      fakeChatSession({
        kind: 'chat',
        overrides: {
          scopeResolver: {
            summary: ref('1 file, 1 folder'),
            entries: ref([
              { type: 'file', path: 'Sample/reference.md' },
              { type: 'folder', path: 'Sample/Pages' },
            ]),
          },
          overrides: ref({
            nodeScope: [
              {
                kind: 'target',
                node_id: 'sample-node',
                project_id: 'sample-project',
                target: { kind: 'workspace', workspace_id: 'sample-workspace' },
                access: 'read',
              },
            ],
          }),
        },
      })
    )
    const input = chat.findComponent({ name: 'AiChatInput' })
    expect(input.props('scopeCode')).toBe('3')
    expect(input.props('scopeLabel')).toBe(
      // Node places are said by name; with no node here to ask, the ids stand in for the names.
      'Access: file: Sample/reference.md · folder: Sample/Pages · sample-node node · sample-project · worktree sample-workspace · can read files'
    )
  })
  it('passes background question and approval state to the tree dots', async () => {
    const active = fakeChatSession({ kind: 'chat' })
    const waiting = fakeChatSession({ kind: 'chat', overrides: { id: 'sample-waiting-tab' } })
    waiting.pendingQuestions.value = {
      questions: [{ question: 'Sample?', options: ['Yes'] }],
      currentIndex: 0,
    }
    const chats = ChatService.getInstance()
    const beforeOrder = chats.tabOrder.value
    const beforeId = chats.activeTabId.value
    chats.tabOrder.value = [active.id, waiting.id]
    chats.activeTabId.value = active.id
    vi.spyOn(chats, 'getSession').mockImplementation(
      (id) => (id === waiting.id ? waiting : active) as never
    )
    vi.spyOn(chats, 'getPresentation').mockImplementation(
      (id) => ({ label: ref(id), isStreaming: ref(false), messages: ref([]) }) as never
    )
    try {
      const chat = await render(active)
      await chat.get('.abele-chat-switch__current').trigger('click')
      const waitingDot = () =>
        chat
          .get(`[data-chat="${waiting.id}"] .abele-chat-tree__dot`)
          .classes()
          .includes('abele-chat-tree__dot_waiting')
      expect(waitingDot()).toBe(true)
      waiting.pendingQuestions.value = null
      waiting.pendingToolCalls.value = [{ id: 'sample-call' }]
      await flushPromises()
      expect(waitingDot()).toBe(true)
      waiting.pendingToolCalls.value = []
      await flushPromises()
      expect(waitingDot()).toBe(false)
    } finally {
      chats.tabOrder.value = beforeOrder
      chats.activeTabId.value = beforeId
    }
  })
  it('keeps an empty access set discoverable for editing', async () => {
    const chat = await render(fakeChatSession({ kind: 'chat' }))
    const input = chat.findComponent({ name: 'AiChatInput' })
    expect(input.props('scopeLabel')).toBe('Access: No files')
    expect(input.props('scopeIcon')).toBe('folder-lock')
    expect(input.props('scopeCode')).toBe('0')
  })
  it('counts other waiting chats, not the active approval or a running-only chat', async () => {
    const rows = AgentsService.getInstance().rows
    rows.value = [
      {
        key: 'active',
        reference: { kind: 'local', sessionId: 'session-1', path: '' },
        title: 'Sample active',
        agent: 'Sample',
        source: 'Chat',
        folder: '/',
        reasons: [{ kind: 'approval', id: 'a', at: 1 }],
      },
      {
        key: 'other',
        reference: { kind: 'local', sessionId: 'other-session', path: '' },
        title: 'Sample other',
        agent: 'Sample',
        source: 'Chat',
        folder: '/',
        reasons: [{ kind: 'question', id: 'q', at: 1 }],
      },
      {
        key: 'working',
        reference: { kind: 'local', sessionId: 'working-session', path: '' },
        title: 'Sample working',
        agent: 'Sample',
        source: 'Chat',
        folder: '/',
        reasons: [{ kind: 'running', id: 'r', at: 1 }],
      },
    ]
    try {
      const chat = await render(fakeChatSession({ kind: 'chat' }))
      expect(chat.findComponent({ name: 'AgentsButton' }).props('count')).toBe(1)
      rows.value = [rows.value[0], rows.value[2]]
      await flushPromises()
      expect(chat.findComponent({ name: 'AgentsButton' }).exists()).toBe(false)
    } finally {
      rows.value = []
    }
  })
})

describe('the question card', () => {
  it('answers by row or digit, exposes progress, and lets an own answer focus the composer', async () => {
    view = mount(ChatQuestionCard, {
      props: { question: 'Pick a sample route', options: ['Short', 'Scenic'], index: 0, count: 2 },
    })
    expect(view.get('[aria-label="Question 1 of 2"]').text()).toBe('1/2')
    await view.get('.abele-chat-question__option').trigger('click')
    await view.get('.abele-chat-question').trigger('keydown', { key: '2' })
    expect(view.emitted('answer')).toEqual([['Short'], ['Scenic']])
    await view.get('.abele-chat-question__option_own').trigger('click')
    expect(view.emitted('own')).toHaveLength(1)
    await view.get('.abele-chat-question').trigger('keydown', { key: 'Escape' })
    expect(view.emitted('skip')).toHaveLength(1)
  })
  it('does not answer from a composing, repeated or modified key', async () => {
    view = mount(ChatQuestionCard, {
      props: { question: 'Sample?', options: ['Yes'], index: 0, count: 1 },
    })
    for (const event of [{ isComposing: true }, { repeat: true }, { metaKey: true }])
      await view.get('.abele-chat-question').trigger('keydown', { key: '1', ...event })
    expect(view.emitted('answer')).toBeUndefined()
  })
})
