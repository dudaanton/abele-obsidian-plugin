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

it.each([
  { textOnly: false, isStreaming: false },
  { textOnly: false, isStreaming: true },
  { textOnly: true, isStreaming: false },
  { textOnly: true, isStreaming: true },
])('keeps one dictation control and only local attachments ($textOnly, $isStreaming)', async ({ textOnly, isStreaming }) => {
  useVault([])
  const wrapper = mount(AiChatInput, {
    props: { textOnly, isStreaming, isBusy: false, canContinue: false, tokenDisplay: '', scopeLabel: '' },
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
})

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
