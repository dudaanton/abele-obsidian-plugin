import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Menu } from 'obsidian'
import NodeChatView from '@/components/NodeChatView.vue'
import NodeMessageTree from '@/components/NodeMessageTree.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import ChatToolRun from '@/components/ChatToolRun.vue'
import { useVault } from '../helpers/testEnv'
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
