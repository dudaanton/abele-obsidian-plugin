/** Synthetic diagnostic; happy-dom counts structure, not Electron layout/native memory. */
import { it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { parseChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useFakeClock } from '../helpers/fakeClock'
useFakeClock()
it('measures a synthetic 2000-message 47MB chat without a real vault', async () => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  let lines = [
    JSON.stringify({ v: 2, k: 'meta', type: 'abele-chat', title: 'SYNTHETIC MEMORY DIAGNOSTIC' }),
  ]
  for (let i = 0; i < 2000; i++) {
    lines.push(
      JSON.stringify({
        k: 'msg',
        id: `synthetic-${i}`,
        role: i % 2 ? 'assistant' : 'user',
        content: `SYNTHETIC ${i} ` + 'sample '.repeat(820),
        timestamp: i + 1,
      })
    )
    lines.push(
      JSON.stringify({
        k: 'int',
        role: i % 2 ? 'assistant' : 'user',
        chatMessageId: `synthetic-${i}`,
        content: [{ type: 'text', text: `SYNTHETIC HISTORY ${i} ` + 'sample '.repeat(2450) }],
        timestamp: i + 1,
      })
    )
  }
  let text = lines.join('\n') + '\n'
  lines = []
  text = text.replace(
    'SYNTHETIC HISTORY 0 ',
    'SYNTHETIC HISTORY 0 ' + 'x'.repeat(47_000_000 - Buffer.byteLength(text))
  )
  expect(Buffer.byteLength(text)).toBe(47_000_000)
  const parsed = parseChat(text)
  text = ''
  expect(parsed.messages).toHaveLength(2000)
  const messages = ref<ChatMessage[]>(parsed.messages)
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
    value: fakeChatSession({ messages, kind: 'chat' }),
  } as never)
  // Fake-clock timing and runner heap are not renderer memory measurements.
  const wrapper = mount(AiChat)
  const observations: unknown[] = []
  const measure = (stage: string) =>
    observations.push({
      stage,
      messages: wrapper.findAllComponents(AiChatMessage).length,
      elements: wrapper.element.querySelectorAll('*').length,
    })
  try {
    measure('initial')
    expect(wrapper.findAllComponents(AiChatMessage)).toHaveLength(30)
    for (let i = 0; i < 100; i++)
      messages.value.push({
        id: `synthetic-new-${i}`,
        role: 'assistant',
        content: 'SYNTHETIC arrival ' + 'sample '.repeat(820),
        timestamp: 3000 + i,
      })
    await nextTick()
    measure('100-arrivals')
    expect(wrapper.findAllComponents(AiChatMessage)).toHaveLength(90)
    const container = wrapper.find('.abele-ai-chat__messages')
    Object.defineProperty(container.element, 'scrollTop', { value: 0, writable: true })
    await container.trigger('scroll')
    await nextTick()
    measure('one-older-page')
    expect(wrapper.findAllComponents(AiChatMessage)).toHaveLength(90)
    console.log('SYNTHETIC_CHAT_DOM_DIAGNOSTIC', JSON.stringify(observations))
  } finally {
    wrapper.unmount()
    vi.restoreAllMocks()
  }
}, 30000)
