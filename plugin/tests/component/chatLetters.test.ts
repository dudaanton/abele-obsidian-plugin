import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatLetterRun from '@/components/chatTree/ChatLetterRun.vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { ownLine, runSummary } from '@/ai/toolRuns'
import type { ChatMessage } from '@/ai/types'
import AiChatMessageDetails from '@/components/AiChatMessageDetails.vue'
import Markdown from '@/components/obsidian/Markdown.vue'

vi.mock('@/ai/chatMessaging', () => ({
  openLetterChat: vi.fn(),
  canOpenLetterChat: (chat: { id: string; path?: string }) => chat.id === 'docs' || !!chat.path,
  openMessagingChats: () => [{ id: 'docs', title: 'Sample documentation', folder: 'Research' }],
}))
afterEach(() => vi.restoreAllMocks())

const letterMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'letter',
  role: 'tool-call',
  content: '',
  timestamp: 1,
  toolStatus: 'approved',
  chatLetter: { to: { id: 'docs', title: 'Sample documentation' } },
  ...overrides,
})

it('shows a chat listing as titles and folders without dumping internal identifiers', () => {
  const wrapper = mount(AiChatMessageDetails, {
    props: {
      message: letterMessage({
        toolName: 'list_chats',
        toolResult: JSON.stringify([
          { id: 'internal-chat-id', title: 'Sample reference', folder: 'Examples', state: 'idle' },
        ]),
      }),
      captureSelection: () => {},
      askHere: () => {},
    },
  })
  try {
    expect(wrapper.find('.abele-chat-list').text()).toContain('Sample reference')
    expect(wrapper.find('.abele-chat-list').text()).toContain('Examples')
    expect(wrapper.text()).not.toContain('internal-chat-id')
  } finally {
    wrapper.unmount()
  }
})

it('codes refused, waiting and working letters and aligns the reason through CallNote', async () => {
  const wrapper = mount(ChatLetterRun, {
    props: {
      message: letterMessage({
        toolStatus: 'rejected',
        chatLetter: {
          to: { id: 'docs', title: 'Sample documentation' },
          refusal: 'That is this chat.',
        },
      }),
    },
  })
  try {
    expect(wrapper.find('.abele-status-dot_red').attributes('aria-label')).toBe('Not sent')
    expect(wrapper.find('.abele-call-note').text()).toBe('That is this chat.')
    expect(wrapper.text()).not.toContain('Not sent:')
    await wrapper.setProps({ message: letterMessage({ toolStatus: 'pending' }) })
    expect(wrapper.find('.abele-status-dot_orange').attributes('aria-label')).toBe(
      'Waiting for your approval'
    )
    await wrapper.setProps({ message: letterMessage() })
    expect(wrapper.find('.abele-status-dot_accent').attributes('aria-label')).toBe(
      'Sample documentation is working on it'
    )
  } finally {
    wrapper.unmount()
  }
})

it('keeps unknown identifiers in the tooltip and offers only usable destinations', () => {
  const wrapper = mount(ChatLetterRun, {
    props: {
      message: letterMessage({
        chatLetter: {
          to: { id: 'missing-chat', title: 'missing-chat', unknown: true },
          refusal: 'No chat by that name.',
        },
      }),
    },
  })
  try {
    expect(wrapper.text()).toContain('Asked an unknown chat')
    expect(wrapper.text()).not.toContain('missing-chat')
    expect(wrapper.find('[title="missing-chat"]').exists()).toBe(true)
    expect(wrapper.find('.abele-tree-item__actions').exists()).toBe(false)
  } finally {
    wrapper.unmount()
  }
})

it('keeps a letter visible as a quiet running line and expands its completed answer', async () => {
  const wrapper = mount(ChatLetterRun, {
    props: { message: letterMessage() },
  })
  try {
    expect(wrapper.text()).toContain('Asked Sample documentation')
    expect(wrapper.find('.abele-chat-letter_running').exists()).toBe(true)
    await wrapper.setProps({
      message: letterMessage({
        chatLetter: { to: { id: 'docs', title: 'Sample documentation' }, reply: 'Sample answer' },
        toolResult: 'Sample answer',
      }),
    })
    expect(wrapper.find('.abele-chat-letter_running').exists()).toBe(false)
    expect(wrapper.find('[aria-expanded="false"]').exists()).toBe(true)
    await wrapper.find('.tree-item-self').trigger('click')
    expect(wrapper.find('[aria-expanded="true"]').exists()).toBe(true)
    expect(wrapper.find('.abele-chat-letter__reply').exists()).toBe(true)
    expect(wrapper.findComponent(Markdown).props('text')).toBe('Sample answer')
  } finally {
    wrapper.unmount()
  }
})

it('shows a refusal separately from the answer', () => {
  const wrapper = mount(ChatLetterRun, {
    props: {
      message: letterMessage({
        chatLetter: {
          to: { id: 'docs', title: 'Sample documentation' },
          refusal: 'The target is waiting for this chat',
        },
      }),
    },
  })
  try {
    expect(wrapper.find('[role="status"]').text()).toBe('The target is waiting for this chat')
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
