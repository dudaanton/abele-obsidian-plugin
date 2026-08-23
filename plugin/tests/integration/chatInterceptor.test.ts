/**
 * Draft review, now that the reviewer is an ordinary agent.
 *
 * The interesting behaviour is what the reviewer is shown: `contextDepth` lives on the chat
 * rather than on the agent, so the same reviewer can be given the whole conversation in one
 * chat and only the draft in another.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { ChatInterceptor, type InterceptorHost } from '@/ai/ChatInterceptor'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage, type AiProvider } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { Message, ModelConfig } from '@/ai/client'

let nextResponse = ''
let nextError: Error | null = null
const calls: Array<{ system: string; messages: Message[] }> = []

vi.mock('@/ai/client/OpenAIClient', () => {
  class OpenAIClient {
    async *stream(_model: ModelConfig, system: string, messages: Message[]) {
      calls.push({ system, messages })
      if (nextError) throw nextError
      yield { type: 'text_delta' as const, delta: nextResponse }
    }
  }
  return { OpenAIClient }
})

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [
    {
      id: 'small',
      name: 'Small',
      contextWindow: 8000,
      maxTokens: 512,
      supportsReasoning: false,
    },
  ],
}

function draftMessage(content = 'Draft text'): ChatMessage {
  return { id: 'd1', role: 'user', content, timestamp: 10, draft: true, interceptorChat: [] }
}

function buildHost(messages: ChatMessage[]) {
  let saves = 0
  const host: InterceptorHost = {
    messages: ref(messages),
    findMessage: (id) => messages.find((m) => m.id === id),
    updateVisibleMessages: () => {},
    save: async () => void saves++,
  }
  return { host, saveCount: () => saves }
}

/** Creates the reviewer agent and returns a ready interceptor bound to it. */
function buildInterceptor(messages: ChatMessage[], contextDepth = 0) {
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Reviewer',
    utility: true,
    providerId: 'p1',
    modelId: 'small',
    prompts: [{ type: 'text', value: 'Review the draft.' }],
  })

  const { host, saveCount } = buildHost(messages)
  const interceptor = new ChatInterceptor(host)
  interceptor.agentId.value = agent.id
  interceptor.contextDepth.value = contextDepth

  return { interceptor, agent, host, saveCount }
}

beforeEach(() => {
  nextResponse = ''
  nextError = null
  calls.length = 0
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
  }
})

describe('ChatInterceptor', () => {
  it('is inactive until an agent that exists is chosen', () => {
    const { host } = buildHost([])
    const interceptor = new ChatInterceptor(host)

    expect(interceptor.isActive).toBe(false)

    interceptor.agentId.value = 'gone'
    expect(interceptor.isActive).toBe(false)
  })

  it('appends the reviewer reply to the draft sub-chat', async () => {
    nextResponse = 'Too vague — say which file.'
    const draft = draftMessage()
    const { interceptor } = buildInterceptor([draft])

    await interceptor.review('d1')

    expect(draft.interceptorChat).toHaveLength(1)
    expect(draft.interceptorChat![0].content).toBe('Too vague — say which file.')
    expect(draft.interceptorChat![0].role).toBe('assistant')
    expect(interceptor.streaming.value).toBe(false)
  })

  it('sends the agent composed prompt as the system message', async () => {
    nextResponse = 'ok'
    const { interceptor } = buildInterceptor([draftMessage()])

    await interceptor.review('d1')

    expect(calls[0].system).toBe('Review the draft.')
  })

  it('shows only the draft at context depth 0', async () => {
    nextResponse = 'ok'
    const history: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'earlier question', timestamp: 1 },
      { id: 'm2', role: 'assistant', content: 'earlier answer', timestamp: 2 },
      draftMessage(),
    ]
    const { interceptor } = buildInterceptor(history, 0)

    await interceptor.review('d1')

    expect(calls[0].messages).toHaveLength(1)
    expect(calls[0].messages[0].content).toBe('Draft text')
  })

  it('shows the whole visible history at context depth -1', async () => {
    nextResponse = 'ok'
    const history: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'earlier question', timestamp: 1 },
      { id: 'm2', role: 'assistant', content: 'earlier answer', timestamp: 2 },
      draftMessage(),
    ]
    const { interceptor } = buildInterceptor(history, -1)

    await interceptor.review('d1')

    // Two history turns plus the draft. The draft itself is excluded from the history slice.
    expect(calls[0].messages).toHaveLength(3)
    expect(calls[0].messages[0].content).toBe('[user]: earlier question')
    expect(calls[0].messages[1].content).toBe('[assistant]: earlier answer')
  })

  it('shows only the last N at a positive context depth', async () => {
    nextResponse = 'ok'
    const history: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'first', timestamp: 1 },
      { id: 'm2', role: 'assistant', content: 'second', timestamp: 2 },
      { id: 'm3', role: 'user', content: 'third', timestamp: 3 },
      draftMessage(),
    ]
    const { interceptor } = buildInterceptor(history, 1)

    await interceptor.review('d1')

    expect(calls[0].messages).toHaveLength(2)
    expect(calls[0].messages[0].content).toBe('[user]: third')
  })

  it('reports a reviewer whose model cannot be resolved, rather than failing silently', async () => {
    const { interceptor, agent } = buildInterceptor([draftMessage()])
    AgentRegistry.getInstance().update(agent.id, { modelId: 'deleted' })

    await interceptor.review('d1')

    expect(interceptor.error.value).toContain('no usable model')
    expect(calls).toHaveLength(0)
  })

  it('surfaces a failed request', async () => {
    nextError = new Error('offline')
    const draft = draftMessage()
    const { interceptor } = buildInterceptor([draft])

    await interceptor.review('d1')

    expect(interceptor.error.value).toBe('offline')
    expect(draft.interceptorChat).toEqual([])
    expect(interceptor.streaming.value).toBe(false)
  })

  it('does nothing at all when no agent is chosen', async () => {
    nextResponse = 'ok'
    const draft = draftMessage()
    const { host } = buildHost([draft])
    const interceptor = new ChatInterceptor(host)

    await interceptor.review('d1')

    expect(calls).toHaveLength(0)
    expect(draft.interceptorChat).toEqual([])
  })

  it('carries the sub-chat forward when the user replies to the reviewer', async () => {
    nextResponse = 'First reply.'
    const draft = draftMessage()
    const { interceptor, saveCount } = buildInterceptor([draft])
    await interceptor.review('d1')

    nextResponse = 'Second reply.'
    await interceptor.sendMessage('d1', 'Why?')

    expect(draft.interceptorChat!.map((m) => m.content)).toEqual([
      'First reply.',
      'Why?',
      'Second reply.',
    ])
    // Draft, then the reviewer reply, the user question and nothing else preceding them.
    const sent = calls[1].messages.map((m) => m.content)
    expect(sent[0]).toBe('Draft text')
    expect(sent).toHaveLength(3)
    expect(saveCount()).toBe(1)
  })
})
