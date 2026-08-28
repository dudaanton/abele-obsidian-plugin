/**
 * What is typed and not sent belongs to the tab it was typed in.
 *
 * The input is a single component shared by every tab, so a tab switch has to do something
 * about it. It used to empty it, which meant looking something up in another conversation
 * cost you the message you were composing. Leaving it alone is not the answer either — then
 * one conversation shows another's half-written message.
 *
 * The session is faked because none of this is about a conversation: the questions are which
 * tab is active and what the textarea holds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const messages = ref<ChatMessage[]>([])

/** Enough of a session for the chat to render; every member it reaches for has to exist. */
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

let service: ChatService

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  messages.value = []
  service = ChatService.getInstance()
  service.tabOrder.value = ['tab-a', 'tab-b']
  service.activeTabId.value = 'tab-a'
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
    value: fakeSession(),
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const open = () => mount(AiChat, { attachTo: document.body })

const textarea = (wrapper: ReturnType<typeof open>) => wrapper.get('.abele-chat-input__textarea')

/** Type, the way the person does — the component tracks the textarea's own value. */
async function type(wrapper: ReturnType<typeof open>, value: string) {
  await textarea(wrapper).setValue(value)
}

/** Switching tabs is a service call; the chat reacts to the id changing. */
async function switchTo(tabId: string) {
  service.activeTabId.value = tabId
  await nextTick()
  await nextTick()
}

describe('a message being composed', () => {
  it('is still there when the tab is returned to', async () => {
    const wrapper = open()
    await type(wrapper, 'half a thought')

    await switchTo('tab-b')
    await switchTo('tab-a')

    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('half a thought')
  })

  it('does not follow you into the other tab', async () => {
    const wrapper = open()
    await type(wrapper, 'half a thought')

    await switchTo('tab-b')

    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('')
  })

  it('is kept per tab, so two tabs hold two different messages', async () => {
    const wrapper = open()
    await type(wrapper, 'for A')

    await switchTo('tab-b')
    await type(wrapper, 'for B')
    await switchTo('tab-a')
    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('for A')

    await switchTo('tab-b')
    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('for B')
  })

  it('is forgotten once its tab is gone, rather than kept for a tab that no longer exists', async () => {
    const wrapper = open()
    await type(wrapper, 'for A')

    await switchTo('tab-b')
    // The tab is closed while another is open, as closing one always does.
    service.tabOrder.value = ['tab-b', 'tab-a']
    await switchTo('tab-a')
    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('for A')

    await switchTo('tab-b')
    service.tabOrder.value = ['tab-b']
    await switchTo('tab-a')

    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('')
  })
})
