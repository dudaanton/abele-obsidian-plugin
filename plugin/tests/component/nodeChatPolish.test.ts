import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Menu, MarkdownRenderer, Platform } from 'obsidian'
import NodeChatView from '@/components/NodeChatView.vue'
import NodeSidebarChat from '@/components/NodeSidebarChat.vue'
import NodeMessageTree from '@/components/NodeMessageTree.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import ChatToolRun from '@/components/ChatToolRun.vue'
import { useVault } from '../helpers/testEnv'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import type { JournalEvent } from '@abele/channel-protocol'
const presenter = () => ({
  id: 'sample-node-tab',
  reference: { registrationId: 'sample' },
  label: ref('Sample coding task'),
  provider: ref('claude'),
  nativeSessionId: ref('sample-native'),
  state: ref('needs-attention'),
  connection: { state: ref('connected'), error: ref(''), connect: vi.fn() },
  messages: ref([
    { id: 'input:followup', role: 'user', content: 'Sample follow-up', timestamp: 0 },
  ]),
  projection: ref({
    activeRuns: ['run'],
    queuedInputs: [{ id: 'followup', text: 'Sample follow-up' }],
    prompts: [],
    children: {},
    artifacts: [],
    unknown: [],
  }),
  queued: ref([]),
  rejected: ref([]),
  error: ref(''),
  draft: ref({ text: '', attachments: [] }),
  send: vi.fn(),
  answer: vi.fn(),
  cancelInput: vi.fn(),
  interrupt: vi.fn(),
  openResource: vi.fn(),
})
it('keeps the phone drawer switch out of the node chat title row', () => {
  useVault([])
  const prior = Platform.isPhone
  ;(Platform as { isPhone: boolean }).isPhone = true
  const wrapper = mount(NodeSidebarChat, {
    props: { presenter: presenter() as never },
    global: { stubs: { DrawerViewSwitch: { template: '<div class="abele-drawer-switch" />' } } },
  })
  try {
    expect(wrapper.find('.abele-ai-chat__header .abele-drawer-switch').exists()).toBe(false)
    expect(wrapper.find('.abele-chat-input__toolbar .abele-node-chat__agent').exists()).toBe(true)
  } finally {
    wrapper.unmount()
    ;(Platform as { isPhone: boolean }).isPhone = prior
  }
})
it('keeps the agent glyph accessible in the composer when navigation occupies the header', () => {
  useVault([])
  const wrapper = mount(NodeChatView, {
    props: { presenter: presenter() as never },
    slots: { navigation: 'Sample navigation' },
    global: { stubs: { Markdown: true } },
  })
  try {
    const picker = wrapper.get('.abele-chat-input__toolbar .abele-node-chat__agent')
    expect(picker.attributes('aria-label')).toBe('Agent: Claude Code. Start a chat with another')
    expect(picker.get('[data-icon="bot"]').exists()).toBe(true)
  } finally {
    wrapper.unmount()
  }
})

it('keeps the agent label and menu chevron inside the shared header button', async () => {
  useVault([])
  const p = presenter()
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  const wrapper = mount(NodeChatView, {
    props: { presenter: p as never },
    global: { stubs: { AiChatInput: true, Markdown: true } },
  })
  try {
    const picker = wrapper.get('.abele-node-chat__agent')
    expect(picker.attributes('aria-label')).toBe('Agent: Claude Code. Start a chat with another')
    expect(picker.classes()).not.toContain('dropdown')
    expect(picker.get('.abele-obsidian-button__label').text()).toBe('Claude Code')
    expect(picker.get('.abele-obsidian-button__trailing-icon').attributes('data-icon')).toBe(
      'chevron-down'
    )
    await picker.trigger('click')
    expect(show).toHaveBeenCalledOnce()
  } finally {
    wrapper.unmount()
    show.mockRestore()
  }
})
it('finishes painting an earlier answer while later message deltas keep arriving', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  useVault([])
  const render = vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, text, el) => {
    await new Promise((resolve) => setTimeout(resolve, 30))
    el.setText(text)
  })
  const p = presenter()
  const journal: JournalEvent[] = []
  const update = (kind: string, message_id: string, text: string) => {
    journal.push({
      kind: 'event',
      node_id: 'sample',
      stream_id: 'sample-session',
      seq: journal.length + 1,
      type: 'session.update',
      actor: { kind: 'provider', provider: 'claude', session_id: 'sample-session' },
      at: '2025-01-01T00:00:00.000Z',
      data: { run_id: 'sample-run', update: { kind, message_id, text } },
    } as JournalEvent)
    p.messages.value = reduceTranscript(journal).messages as never
  }
  update('agent_message_chunk', 'earlier', 'The first ans')
  const wrapper = mount(NodeChatView, {
    props: { presenter: p as never },
    global: { stubs: { AiChatInput: true } },
  })
  try {
    await vi.advanceTimersByTimeAsync(100)
    const earlier = () => wrapper.findAllComponents(AiChatMessage)[0].find('.abele-markdown').text()
    expect(earlier()).toBe('The first ans')
    update('agent_message', 'earlier', 'The first answer is complete.')
    update('agent_message_chunk', 'later', 'Next')
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(10)
      update('agent_message_chunk', 'later', ` ${i}`)
    }
    // No pause in the later stream is needed to complete the answer above it.
    expect(earlier()).toBe('The first answer is complete.')
  } finally {
    wrapper.unmount()
    render.mockRestore()
    vi.useRealTimers()
  }
})
it('keeps earlier markdown resource contexts stable while later answers stream', async () => {
  useVault([])
  const p = presenter()
  p.messages.value = [
    { id: 'earlier', role: 'assistant', content: 'An earlier complete answer.', timestamp: 0 },
    { id: 'later', role: 'assistant', content: 'Next', timestamp: 1 },
  ] as never
  const wrapper = mount(NodeChatView, {
    props: { presenter: p as never },
    global: { stubs: { AiChatInput: true, Markdown: true } },
  })
  try {
    const earlier = wrapper.findAllComponents(AiChatMessage)[0]
    const opener = earlier.props('resourceOpener')
    for (const text of ['Next answer', 'Next answer continues', 'Next answer completes.']) {
      p.messages.value = [p.messages.value[0], { ...p.messages.value[1], content: text }]
      await flushPromises()
      expect(earlier.props('message').content).toBe('An earlier complete answer.')
      // A new opener invalidates an asynchronous render even when its text is unchanged.
      expect(earlier.props('resourceOpener')).toBe(opener)
    }
    opener!('sample.txt')
    expect(p.openResource).toHaveBeenCalledWith('sample.txt')
  } finally {
    wrapper.unmount()
  }
})

it('shows working dots throughout a turn and removes them when the turn ends', async () => {
  useVault([])
  const p = presenter()
  const wrapper = mount(NodeChatView, {
    props: { presenter: p as never },
    global: { stubs: { AiChatInput: true, Markdown: true } },
  })
  try {
    expect(wrapper.get('[aria-label="Agent is working"]').attributes('role')).toBe('status')
    expect(wrapper.findAll('.abele-ai-chat__typing-dot')).toHaveLength(3)
    p.projection.value.activeRuns = []
    await flushPromises()
    expect(wrapper.find('[aria-label="Agent is working"]').exists()).toBe(false)
  } finally {
    wrapper.unmount()
  }
})
it('keeps stored service records outside the transcript with a diagnostic menu exit', async () => {
  useVault([])
  const p = presenter()
  p.messages.value = []
  p.projection.value.queuedInputs = []
  p.projection.value.unknown = [
    { seq: 1, type: 'claude.system', data: { subtype: 'init', artifact_id: 'sample-init' } },
    { seq: 2, type: 'claude.raw', data: { frame: 'sample-stream-frame' } },
  ] as never
  p.projection.value.artifacts = [{ artifactId: 'sample-init', size: 100 }] as never
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  const wrapper = mount(NodeChatView, {
    props: { presenter: p as never },
    global: { stubs: { AiChatInput: true } },
  })
  try {
    expect(wrapper.findAllComponents(AiChatMessage)).toHaveLength(0)
    for (const text of ['Read stored output', 'Details', 'sample-init', 'sample-stream-frame'])
      expect(wrapper.text()).not.toContain(text)
    await wrapper.get('[aria-label="More chat actions"]').trigger('click')
    expect((show.mock.contexts.at(-1) as Menu).items.map((i) => i.title)).toContain(
      'Log raw session records'
    )
  } finally {
    wrapper.unmount()
    show.mockRestore()
  }
})
it('keeps secondary session actions in the menu and interrupts through Stop in the composer', async () => {
  useVault([])
  const p = presenter(),
    show = vi.spyOn(Menu.prototype, 'showAtPosition')
  const wrapper = mount(NodeChatView, {
    props: { presenter: p as never },
    global: { stubs: { AiChatInput: true, AiChatMessage: true } },
  })
  try {
    expect(wrapper.text()).not.toContain('Steering and questions are not supported yet')
    expect(wrapper.findAll('.abele-ai-chat__header')).toHaveLength(1)
    expect(wrapper.find('.abele-node-chat__status').exists()).toBe(false)
    // Stop stands in the composer, as in a local chat; the header has no square of its own.
    expect(wrapper.find('[aria-label="Interrupt turn"]').exists()).toBe(false)
    const input = wrapper.findComponent({ name: 'AiChatInput' })
    expect(input.props('isStreaming')).toBe(true)
    input.vm.$emit('abort')
    expect(p.interrupt).toHaveBeenCalledWith('run')
    await wrapper.get('[aria-label="More chat actions"]').trigger('click')
    const menu = show.mock.contexts.at(-1) as Menu
    // Folders and worktrees are the node panel's now; the menu opens it.
    expect(menu.items.map((i) => i.title)).toContain('Folders and worktrees')
    // Nothing it cannot do is offered, greyed out or not.
    expect(menu.items.map((i) => i.title)).not.toContain('Steer turn')
  } finally {
    wrapper.unmount()
    show.mockRestore()
  }
})
it('shows queue state on the existing input rather than another copy of its text', () => {
  useVault([])
  const p = presenter()
  const wrapper = mount(NodeChatView, {
    props: { presenter: p as never },
    global: { stubs: { AiChatInput: true, AiChatMessage: true } },
  })
  try {
    expect(wrapper.findAllComponents(AiChatMessage)).toHaveLength(1)
    expect(wrapper.findAll('.abele-ai-chat__queued-item')).toHaveLength(0)
  } finally {
    wrapper.unmount()
  }
})
it('does not offer local draft Send or Edit for already queued node inputs', async () => {
  useVault([])
  const p = presenter()
  p.messages.value = []
  p.projection.value.queuedInputs = []
  p.queued.value = [{ id: 'pending-operation', text: 'Sample offline input' }] as never
  const wrapper = mount(NodeChatView, {
    props: { presenter: p as never },
    global: { stubs: { AiChatInput: true, Markdown: true } },
  })
  try {
    await flushPromises()
    expect(wrapper.findAllComponents(AiChatMessage)).toHaveLength(1)
    expect(wrapper.find('.abele-chat-msg__draft-actions').exists()).toBe(false)
  } finally {
    wrapper.unmount()
  }
})

it('read-only message rows never enable local draft actions while local drafts still do', () => {
  useVault([])
  for (const readOnlyHistory of [true, false]) {
    const wrapper = mount(AiChatMessage, {
      props: {
        message: { id: 'sample', role: 'user', content: 'Sample draft', timestamp: 0, draft: true },
        readOnlyHistory,
      },
      global: { stubs: { Markdown: true } },
    })
    try {
      expect(wrapper.find('.abele-chat-msg__draft-actions').exists()).toBe(!readOnlyHistory)
    } finally {
      wrapper.unmount()
    }
  }
})

it('folds the calls into one line of work, nested work inside it, diffs and thinking closed', async () => {
  useVault([])
  const wrapper = mount(NodeMessageTree, {
    props: {
      messages: [
        {
          id: 'tool',
          role: 'tool-call',
          content: 'Allowed by your Claude settings',
          toolName: 'Edit',
          toolParams: { file_path: 'sample.txt' },
          toolDiff: { old: 'before', new: 'after' },
          timestamp: 0,
          thinking: 'Sample reasoning',
        },
      ],
      children: {
        tool: [{ id: 'child', role: 'assistant', content: 'Nested sample', timestamp: 0 }],
      },
      openResource: vi.fn(),
    },
    global: { stubs: { Markdown: true, Diff: true } },
  })
  try {
    // The call is a line of work, folded as in the regular chat; its nested work is inside.
    expect(wrapper.find('.abele-node-child-work').exists()).toBe(false)
    wrapper.findComponent(ChatToolRun).vm.$emit('update:open', true)
    await flushPromises()
    expect(
      wrapper
        .get('.abele-node-child-work')
        .findAllComponents(AiChatMessage)
        .map((c) => c.props('message').id)
    ).toEqual(['child'])
    expect(wrapper.get('.abele-chat-msg__thinking').attributes('open')).toBeUndefined()
    expect(wrapper.find('.abele-chat-msg__diff').exists()).toBe(false)
    expect(wrapper.find('p.abele-node-message-note').exists()).toBe(false)
    await wrapper.get('.abele-chat-msg__icon').trigger('click')
    expect(wrapper.find('.abele-chat-msg__diff').exists()).toBe(true)
  } finally {
    wrapper.unmount()
  }
})
