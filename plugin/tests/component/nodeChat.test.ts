import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import NodeChatView from '@/components/NodeChatView.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import AiChatInput from '@/components/AiChatInput.vue'
import VoiceRecorder from '@/components/VoiceRecorder.vue'
import { useVault } from '../helpers/testEnv'

it('uses the shared composer and renderer, labels offline queue and never offers local history controls', async () => {
  useVault([])
  const send = vi.fn()
  const presenter = {
    id: 'sample',
    label: ref('Sample session'),
    messages: ref([{ id: 'i', role: 'user', content: 'Sample input', timestamp: 0 }]),
    projection: ref({ messages: [], prompts: [], artifacts: [], unknown: [], state: 'idle' }),
    state: ref('offline'),
    queued: ref([{ id: 'pending', text: 'Queued input' }]),
    rejected: ref([]),
    error: ref(''),
    draft: ref({ text: '', attachments: [] }),
    connection: { state: ref('offline'), error: ref(''), connect: vi.fn() },
    capabilities: { editHistory: false },
    send,
    answer: vi.fn(),
    openResource: vi.fn(),
  }
  const wrapper = mount(NodeChatView, {
    props: { presenter: presenter as never },
    global: { stubs: { AiChatInput: true, AiChatMessage: true, Icon: true, Button: true } },
  })
  expect(wrapper.text()).toContain('Offline')
  expect(wrapper.text()).toContain('Queued input')
  expect(wrapper.findComponent({ name: 'AiChatMessage' }).props('readOnlyHistory')).toBe(true)
  expect(wrapper.findComponent({ name: 'AiChatInput' }).props('textOnly')).toBe(true)
  wrapper.findComponent({ name: 'AiChatInput' }).vm.$emit('send', 'Hello', [])
  await flushPromises()
  expect(send).toHaveBeenCalledWith('Hello')
  wrapper.unmount()
})

it('restores exact Claude permission cards and nested work without fake controls', async () => {
  useVault([])
  const prompt = {
    prompt_id: 'sample-approval',
    state: 'pending',
    tool_name: 'Bash',
    input: { command: 'printf sample' },
    expires_at: 1999999999999,
  }
  const answer = vi.fn()
  const presenter = {
    id: 'claude',
    label: ref('Sample coding task'),
    provider: ref('claude'),
    nativeSessionId: ref('sample-native'),
    messages: ref([
      { id: 'parent', role: 'tool-call', content: '', toolName: 'Agent', timestamp: 0 },
    ]),
    projection: ref({
      activeRuns: ['run'],
      queuedInputs: [{ id: 'i', text: 'Follow-up' }],
      children: {
        parent: [{ id: 'child', role: 'assistant', content: '**Nested result**', timestamp: 0 }],
      },
      prompts: [prompt],
      artifacts: [],
      unknown: [],
    }),
    state: ref('needs-attention'),
    queued: ref([]),
    rejected: ref([]),
    error: ref(''),
    draft: ref({ text: '', attachments: [] }),
    connection: { state: ref('connected'), error: ref('') },
    answer,
    openResource: vi.fn(),
    send: vi.fn(),
    interrupt: vi.fn(),
    cancelInput: vi.fn(),
  }
  const mountChat = () =>
    mount(NodeChatView, {
      props: { presenter: presenter as never },
      global: { stubs: { AiChatMessage: true, AiChatInput: true, Icon: true } },
    })
  let wrapper = mountChat()
  wrapper.unmount()
  wrapper = mountChat()
  try {
    expect(wrapper.text()).toContain('Claude Code')
    expect(wrapper.text()).not.toContain('Ask for permission')
    expect(wrapper.text()).toContain('printf sample')
    expect(wrapper.text()).toContain('not supported yet')
    expect(wrapper.find('.abele-node-child-work').attributes('open')).toBeUndefined()
    expect(wrapper.findAllComponents(AiChatMessage)).toHaveLength(2)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Approve')!
      .trigger('click')
    await flushPromises()
    expect(answer).toHaveBeenCalledWith(prompt, 'allow')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Cancel queued input')!
      .trigger('click')
    expect(presenter.cancelInput).toHaveBeenCalledWith('i')
  } finally {
    wrapper.unmount()
  }
})

it.each([
  { textOnly: false, isStreaming: false },
  { textOnly: false, isStreaming: true },
  { textOnly: true, isStreaming: false },
  { textOnly: true, isStreaming: true },
])(
  'keeps one dictation control and only local attachments ($textOnly, $isStreaming)',
  async ({ textOnly, isStreaming }) => {
    useVault([])
    const wrapper = mount(AiChatInput, {
      props: {
        textOnly,
        isStreaming,
        isBusy: false,
        canContinue: false,
        tokenDisplay: '',
        scopeLabel: '',
      },
      global: { stubs: { VoiceRecorder: true } },
    })
    try {
      expect(wrapper.findAll('[data-icon="paperclip"]')).toHaveLength(textOnly ? 0 : 1)
      expect(wrapper.findAll('[data-icon="mic"]')).toHaveLength(1)
      await wrapper.get('[data-icon="mic"]').trigger('click')
      wrapper.findComponent(VoiceRecorder).vm.$emit('send', 'Sample dictated words')
      await flushPromises()
      expect(wrapper.emitted('send')).toEqual([['Sample dictated words', []]])
      expect(wrapper.get('textarea').element.value).toBe('')
      if (textOnly) {
        await wrapper.get('textarea').setValue('/new')
        await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
        expect(wrapper.emitted('send')?.[1]).toEqual(['/new', []])
        expect(wrapper.emitted('command')).toBeUndefined()
      }
    } finally {
      wrapper.unmount()
    }
  }
)

it('does not expose branch, repeat, edit, retry or rewind on a read-only node message', async () => {
  useVault([])
  const wrapper = mount(AiChatMessage, {
    props: {
      message: { id: 'i', role: 'user', content: 'Sample input', timestamp: 0 },
      readOnlyHistory: true,
    },
    global: { stubs: { Icon: true, Markdown: true } },
  })
  await wrapper.find('.abele-chat-msg__icon').trigger('click')
  for (const label of ['Branch from here', 'Repeat', 'Edit', 'Rewind', 'Retry', 'Insert into note'])
    expect(wrapper.text()).not.toContain(label)
  wrapper.unmount()
})
