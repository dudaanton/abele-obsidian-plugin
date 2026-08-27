/**
 * How much of a conversation the chat mounts.
 *
 * The window itself is settled in `tests/unit/useTailPagedList.test.ts`. What is asserted here
 * is that the chat actually uses it — that a long conversation puts a bounded number of
 * messages in the DOM, says how many it is holding back, and reveals them when the reader
 * scrolls to the top. Mounting every message is exactly the cost this exists to avoid, so a
 * regression here is invisible to every other test and obvious to anyone opening a long chat.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { DEFAULT_TAIL_PAGE_SIZE } from '@/composables/useTailPagedList'
import { useVault } from '../helpers/testEnv'

function conversation(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i + 1}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i + 1}`,
    timestamp: i + 1,
  })) as ChatMessage[]
}

const messages = ref<ChatMessage[]>([])

/**
 * Enough of a session for the chat to render one.
 *
 * The component reads a good deal of a session, and every reactive member it reaches for has
 * to exist or the render throws before a single message is mounted. Nothing here does
 * anything: the question is what gets drawn, not what happens when it is used.
 */
function fakeSession() {
  const off = ref(false)
  const nothing = () => {}
  return {
    messages,
    allMessages: messages,
    isStreaming: off,
    isGeneratingTitle: off,
    isCompacting: off,
    isExecutingTool: off,
    hideReasoning: off,
    hasFallbackModel: off,
    streamingContent: ref(''),
    streamingThinking: ref(''),
    error: ref(null),
    currentChatFile: ref(null),
    pendingQuestions: ref(null),
    pendingToolCalls: ref([]),
    scopeResolver: { summary: ref('No files') },
    interceptor: { streaming: off, streamingContent: ref(''), error: ref(null) },
    getDraftMessage: () => null,
    getDebugData: () => ({}),
    getToolMode: () => 'ask',
    resolveModel: () => null,
    toolModes: ref({}),
    load: nothing,
    reset: nothing,
    sendMessage: nothing,
    createBranch: nothing,
    switchBranch: nothing,
    repeatMessage: nothing,
    retryFromMessage: nothing,
    retryRequest: nothing,
    retryInterceptor: nothing,
    sendInterceptorMessage: nothing,
    confirmDraft: nothing,
    injectSkill: nothing,
    answerCurrentQuestion: nothing,
    abortQuestions: nothing,
  }
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  messages.value = []
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
    value: fakeSession(),
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** How many messages the chat put in the DOM. */
const mounted = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAllComponents(AiChatMessage).length

describe('a conversation longer than a page', () => {
  const LENGTH = DEFAULT_TAIL_PAGE_SIZE * 3

  it('mounts one page of it rather than all of it', () => {
    messages.value = conversation(LENGTH)

    const wrapper = mount(AiChat)

    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE)
  })

  it('mounts the end of it — the part being read', () => {
    messages.value = conversation(LENGTH)

    const wrapper = mount(AiChat)
    const rendered = wrapper.findAllComponents(AiChatMessage)

    expect(rendered.at(-1)?.props('message').id).toBe(`m${LENGTH}`)
  })

  it('says how many it is holding back', () => {
    messages.value = conversation(LENGTH)

    const wrapper = mount(AiChat)

    expect(wrapper.find('.abele-ai-chat__older').text()).toContain(
      `${LENGTH - DEFAULT_TAIL_PAGE_SIZE} earlier messages`
    )
  })
})

describe('a conversation that fits', () => {
  it('mounts all of it', () => {
    messages.value = conversation(5)

    const wrapper = mount(AiChat)

    expect(mounted(wrapper)).toBe(5)
  })

  it('says nothing about earlier messages', () => {
    messages.value = conversation(5)

    const wrapper = mount(AiChat)

    expect(wrapper.find('.abele-ai-chat__older').exists()).toBe(false)
  })
})

describe('scrolling back', () => {
  it('reveals the previous page when the reader reaches the top', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mount(AiChat)
    const container = wrapper.find('.abele-ai-chat__messages')

    // happy-dom lays nothing out, so the scroll position is set rather than performed.
    Object.defineProperty(container.element, 'scrollTop', { value: 0, writable: true })
    await container.trigger('scroll')
    await nextTick()

    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE * 2)
  })

  it('does not reveal anything while the reader is in the middle', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mount(AiChat)
    const container = wrapper.find('.abele-ai-chat__messages')

    Object.defineProperty(container.element, 'scrollTop', { value: 5000, writable: true })
    await container.trigger('scroll')
    await nextTick()

    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE)
  })
})

describe('a message arriving while the chat is open', () => {
  it('is mounted, however far back the reader has scrolled', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 2)
    const wrapper = mount(AiChat)

    messages.value = [
      ...messages.value,
      { id: 'newest', role: 'assistant', content: 'Just now', timestamp: 999 } as ChatMessage,
    ]
    await nextTick()

    const rendered = wrapper.findAllComponents(AiChatMessage)
    expect(rendered.at(-1)?.props('message').id).toBe('newest')
  })
})
