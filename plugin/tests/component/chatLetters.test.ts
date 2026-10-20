import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatLetterRun from '@/components/chatTree/ChatLetterRun.vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { ownLine, runSummary } from '@/ai/toolRuns'

vi.mock('@/ai/chatMessaging', () => ({
  openLetterChat: vi.fn(),
  openMessagingChats: () => [{ id: 'docs', title: 'Sample documentation', folder: 'Research' }],
}))
afterEach(() => vi.restoreAllMocks())

it('keeps a letter visible as a quiet running line and expands its completed answer', async () => {
  const wrapper = mount(ChatLetterRun, {
    props: { letter: { to: { id: 'docs', title: 'Sample documentation' } } },
  })
  try {
    expect(wrapper.text()).toContain('Asked Sample documentation')
    expect(wrapper.find('.abele-chat-letter_running').exists()).toBe(true)
    await wrapper.setProps({
      letter: { to: { id: 'docs', title: 'Sample documentation' }, reply: 'Sample answer' },
    })
    expect(wrapper.find('.abele-chat-letter_running').exists()).toBe(false)
    expect(wrapper.find('[aria-expanded="false"]').exists()).toBe(true)
    await wrapper.find('.tree-item-self').trigger('click')
    expect(wrapper.find('[aria-expanded="true"]').exists()).toBe(true)
  } finally {
    wrapper.unmount()
  }
})

it('shows a refusal separately from the answer', () => {
  const wrapper = mount(ChatLetterRun, {
    props: {
      letter: {
        to: { id: 'docs', title: 'Sample documentation' },
        refusal: 'The target is waiting for this chat',
      },
    },
  })
  try {
    expect(wrapper.find('[role="status"]').text()).toBe(
      'Not sent: The target is waiting for this chat'
    )
    expect(wrapper.find('.abele-chat-letter_running').exists()).toBe(false)
  } finally {
    wrapper.unmount()
  }
})

it('shows the destination title, folder and exact message before approval', () => {
  const wrapper = mount(AiToolApproval, {
    props: {
      message: {
        id: 'call',
        role: 'tool-call',
        content: '',
        timestamp: 1,
        toolName: 'send_message_to_chat',
        toolParams: { chat_id: 'docs', message: 'First line\nSecond line' },
        toolStatus: 'pending',
      },
    },
  })
  try {
    expect(wrapper.text()).toContain('Sample documentation')
    expect(wrapper.text()).toContain('Research')
    expect(wrapper.find('.abele-tool-approval__message').text()).toBe('First line\nSecond line')
    expect(wrapper.text()).toContain('Allow')
    expect(wrapper.text()).toContain('Deny')
    expect(wrapper.text()).toContain('Stop')
  } finally {
    wrapper.unmount()
  }
})

it('keeps letters separate from grouped tools and reports the listed count', () => {
  expect(
    ownLine({
      id: 'call',
      role: 'tool-call',
      content: '',
      timestamp: 1,
      chatLetter: { to: { id: 'docs', title: 'Docs' } },
    })
  ).toBe(true)
  expect(
    runSummary([
      {
        id: 'list',
        role: 'tool-call',
        content: '',
        timestamp: 1,
        toolName: 'list_chats',
        toolStatus: 'approved',
        toolResult: '[{},{}]',
      },
    ])
  ).toBe('Listed chats · 2')
})
