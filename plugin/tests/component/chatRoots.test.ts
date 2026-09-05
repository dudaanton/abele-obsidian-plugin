/**
 * A conversation with more than one beginning.
 *
 * Repeating the first message starts a second conversation under the same file: a second root
 * beside the first. The switcher a message carries covers its children, and a root has no
 * message above it to carry one — so the first beginning looked deleted rather than put aside
 * (2026-09-05, on both the phone and the desktop). The chat now shows a switcher of its own
 * above the messages whenever there is more than one root.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import AiChat from '@/components/AiChat.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'

const msg = (id: string, role: 'user' | 'assistant', parentId?: string): ChatMessage =>
  ({ id, role, content: id, timestamp: 1, parentId }) as ChatMessage

/** Two beginnings: `r1 → a1` and `r2 → a2`, with the second one on screen. */
const all = ref<ChatMessage[]>([
  msg('r1', 'user'),
  msg('a1', 'assistant', 'r1'),
  msg('r2', 'user'),
  msg('a2', 'assistant', 'r2'),
])
const visible = ref<ChatMessage[]>([all.value[2], all.value[3]])
const switchBranch = vi.fn()

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  switchBranch.mockClear()
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
    value: fakeChatSession({
      messages: visible,
      kind: 'chat',
      overrides: { allMessages: all, switchBranch },
    }),
  } as never)
})

afterEach(() => vi.restoreAllMocks())

describe('a chat with two beginnings', () => {
  it('shows which beginning is on screen, above the messages', () => {
    const wrapper = mount(AiChat)

    expect(wrapper.find('.abele-ai-chat__roots').text()).toBe('2/2')
  })

  it('switches to the other beginning', async () => {
    const wrapper = mount(AiChat)

    const back = wrapper
      .findAllComponents(Icon)
      .find((i) => i.props('icon') === 'chevron-left' && i.element.closest('.abele-ai-chat__roots'))
    await back!.trigger('click')

    expect(switchBranch).toHaveBeenCalledWith('r1')
  })

  it('shows nothing of the kind when there is one beginning', () => {
    all.value = [msg('r1', 'user'), msg('a1', 'assistant', 'r1')]
    visible.value = [...all.value]
    const wrapper = mount(AiChat)

    expect(wrapper.find('.abele-ai-chat__roots').exists()).toBe(false)
  })
})
