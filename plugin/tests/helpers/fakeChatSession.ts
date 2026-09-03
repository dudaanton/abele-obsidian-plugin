/**
 * Enough of a `ChatSession` for the chat to render one.
 *
 * The component reaches into a good deal of a session, and every reactive member it touches
 * has to exist or the render throws before anything is mounted. Nothing here does anything:
 * these tests ask what gets drawn, not what happens when it is used, so each test overrides
 * the few members its own question is about.
 */
import { ref, shallowRef, type Ref } from 'vue'
import type { CommentState } from '@/editor/CommentPlugin'
import type { ChatMessage, CommentAnchor, QueuedMessage } from '@/ai/types'

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
  // The four the real `isMidTurn` is computed over, held apart so the getter below can read
  // them: a test that sets `pendingToolCalls` gets a mid-turn session without saying so twice.
  const isStreaming = ref(false)
  const isCompacting = ref(false)
  const pendingToolCalls = ref<unknown[]>([])
  const pendingQuestions = ref<unknown>(null)
  return {
    id: 'session-1',
    messages,
    allMessages: messages,
    queuedMessages,
    isStreaming,
    isGeneratingTitle: off,
    isCompacting,
    isExecutingTool: off,
    hideReasoning: off,
    hasFallbackModel: off,
    streamingContent: ref(''),
    streamingThinking: ref(''),
    error: ref(null),
    currentChatFile: ref(null),
    pendingQuestions,
    pendingToolCalls,
    /** Derived exactly as the real session derives it, so a test can set either side. */
    get isMidTurn(): boolean {
      if (isStreaming.value || isCompacting.value) return true
      return pendingToolCalls.value.length > 0 || pendingQuestions.value !== null
    },
    /** Set by `CommentService` for the length of a move; nothing here moves on its own. */
    moving: ref(false),
    scopeResolver: { summary: ref('No files') },
    interceptor: { streaming: off, streamingContent: ref(''), error: ref(null) },
    // Comment sessions. A card reads the agent's name for its badge, the anchor for the quote
    // it is attached to, and `commentState` for the dot that has to agree with the marker.
    kind: 'comment' as 'chat' | 'run' | 'comment',
    commentId: 'k7d2ph' as string | null,
    anchor: shallowRef<CommentAnchor | null>({ note: 'Notes/Anchor.md' }),
    agent: ref({ id: 'comment-agent', name: 'Comment' }),
    agentId: ref('comment-agent'),
    commentState: ref<CommentState>('idle'),
    // Pinning. `pinned` is the one record of it on a real session, and the three methods below
    // are what a row and a pin card call; a test that cares about either overrides them.
    pinned: shallowRef<string[]>([]),
    isPinned: () => false,
    pin: nothing,
    unpin: nothing,
    getDraftMessage: () => null,
    getDebugData: () => ({}),
    getToolMode: () => 'ask',
    resolveModel: () => null,
    toolModes: ref({}),
    load: nothing,
    reset: nothing,
    sendMessage: nothing,
    addUserNote: nothing,
    switchAgent: nothing,
    createBranch: nothing,
    switchBranch: nothing,
    repeatMessage: nothing,
    retryFromMessage: nothing,
    retryRequest: nothing,
    retryInterceptor: nothing,
    sendInterceptorMessage: nothing,
    confirmDraft: nothing,
    injectSkill: nothing,
    approveToolCall: nothing,
    rejectToolCall: nothing,
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
