/**
 * Enough of a `ChatSession` for the chat to render one.
 *
 * The component reaches into a good deal of a session, and every reactive member it touches
 * has to exist or the render throws before anything is mounted. Nothing here does anything:
 * these tests ask what gets drawn, not what happens when it is used, so each test overrides
 * the few members its own question is about.
 */
import { ref, type Ref } from 'vue'
import type { ChatMessage, QueuedMessage } from '@/ai/types'

export interface FakeSessionOptions {
  messages?: Ref<ChatMessage[]>
  queuedMessages?: Ref<QueuedMessage[]>
  overrides?: Record<string, unknown>
}

export function fakeChatSession({
  messages = ref<ChatMessage[]>([]),
  queuedMessages = ref<QueuedMessage[]>([]),
  overrides = {},
}: FakeSessionOptions = {}) {
  const off = ref(false)
  const nothing = () => {}
  return {
    messages,
    allMessages: messages,
    queuedMessages,
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
    abort: nothing,
    abortToolExecution: nothing,
    takeQueuedMessages: () => {
      const taken = queuedMessages.value
      queuedMessages.value = []
      return taken
    },
    removeQueuedMessage: (id: string) => {
      queuedMessages.value = queuedMessages.value.filter((m) => m.id !== id)
    },
    ...overrides,
  }
}
