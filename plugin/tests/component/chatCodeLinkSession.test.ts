import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { MarkdownRenderer } from 'obsidian'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'

afterEach(() => vi.restoreAllMocks())

it('renders an answer when the session has no overrides', async () => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  const service = ChatService.getInstance()
  const session = fakeChatSession({
    kind: 'chat',
    messages: ref<ChatMessage[]>([
      { id: 'sample-answer', role: 'assistant', content: 'Sample answer', timestamp: 1 },
    ]),
  })
  expect('overrides' in session).toBe(false)
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({ value: session } as never)
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, text, el) => {
    el.textContent = text
  })
  const view = mount(AiChat)
  try {
    await flushPromises()
    expect(view.get('.abele-chat-msg_assistant .abele-markdown').text()).toBe('Sample answer')
  } finally {
    view.unmount()
  }
})
