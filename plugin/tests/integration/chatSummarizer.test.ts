/**
 * Title generation and compaction, driven through the narrow host interface rather than a
 * whole ChatSession. The point of the extraction is that these tasks need very little of a
 * chat; the fake below is that "very little", written out.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { TFile } from 'obsidian'
import { ChatSummarizer, type SummarizerHost } from '@/ai/ChatSummarizer'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import type { Message, ModelConfig, ToolCallContent } from '@/ai/client'

/** Whatever the stubbed client should emit as `text_delta` on the next call. */
let nextResponse = ''
/** Set to throw from the stream instead of yielding. */
let nextError: Error | null = null
/** Every (systemPrompt, messages) pair the stub was called with. */
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

const MODEL: ModelConfig = {
  id: 'aux',
  name: 'Aux',
  baseUrl: 'http://localhost/v1',
  apiKey: '',
  contextWindow: 1000,
  maxTokens: 100,
  supportsReasoning: false,
}

function buildHost(overrides: Partial<SummarizerHost> = {}) {
  const applied: string[] = []
  let saves = 0

  const host: SummarizerHost = {
    messages: ref<ChatMessage[]>([]),
    chatTitle: ref(''),
    currentChatFile: shallowRef<TFile | null>(null),
    isGeneratingTitle: ref(false),
    isCompacting: ref(false),
    isStreaming: ref(false),
    error: ref<string | null>(null),
    pendingToolCalls: ref<ToolCallContent[]>([]),
    messagesForModel: () => [
      { role: 'user', content: 'question', timestamp: 1 },
      { role: 'user', content: 'another', timestamp: 2 },
      { role: 'user', content: 'third', timestamp: 3 },
    ],
    toolDefs: () => [],
    hasInternalMessages: () => true,
    applyCompactSummary: (summary: string) => void applied.push(summary),
    backgroundSignal: () => new AbortController().signal,
    save: async () => void saves++,
    auxiliaryModel: () => MODEL,
    activeModel: () => MODEL,
    ...overrides,
  }

  return { host, applied, saveCount: () => saves }
}

function assistantMessage(total: number): ChatMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: 'answer',
    timestamp: 1,
    usage: { input: total, output: 0, total },
  }
}

beforeEach(() => {
  nextResponse = ''
  nextError = null
  calls.length = 0
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
})

describe('ChatSummarizer.generateTitle', () => {
  it('writes the generated title back to the chat', async () => {
    nextResponse = 'Refactoring the parser'
    const { host } = buildHost()

    await new ChatSummarizer(host).generateTitle()

    expect(host.chatTitle.value).toBe('Refactoring the parser')
    expect(host.isGeneratingTitle.value).toBe(false)
  })

  it('strips quotes and characters a filename cannot carry', async () => {
    nextResponse = '"Fix: the/broken|thing"'
    const { host } = buildHost()

    await new ChatSummarizer(host).generateTitle()

    expect(host.chatTitle.value).toBe('Fix- the-broken-thing')
  })

  it('swallows a failed request instead of surfacing a chat error', async () => {
    // A title is a convenience. Failing one must never interrupt what the user is doing.
    nextError = new Error('offline')
    const { host } = buildHost()

    await new ChatSummarizer(host).generateTitle()

    expect(host.error.value).toBeNull()
    expect(host.chatTitle.value).toBe('')
    expect(host.isGeneratingTitle.value).toBe(false)
  })

  it('leaves the title alone when the model returns nothing', async () => {
    nextResponse = '   '
    const { host } = buildHost({ chatTitle: ref('Existing') })

    await new ChatSummarizer(host).generateTitle()

    expect(host.chatTitle.value).toBe('Existing')
  })
})

describe('ChatSummarizer.compact', () => {
  it('hands the summary to the host and saves', async () => {
    nextResponse = 'They discussed the parser.'
    const { host, applied, saveCount } = buildHost()

    await new ChatSummarizer(host).compact()

    expect(applied).toEqual(['They discussed the parser.'])
    expect(saveCount()).toBe(1)
    expect(host.isCompacting.value).toBe(false)
  })

  it('refuses to run while the chat is streaming', async () => {
    nextResponse = 'summary'
    const { host, applied } = buildHost({ isStreaming: ref(true) })

    await new ChatSummarizer(host).compact()

    expect(applied).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('does nothing when there is no conversation to compact', async () => {
    nextResponse = 'summary'
    const { host, applied } = buildHost({ hasInternalMessages: () => false })

    await new ChatSummarizer(host).compact()

    expect(applied).toEqual([])
  })

  it('reports a failed compaction, unlike a failed title', async () => {
    // Compaction is user-visible work: the chat is about to overflow and did not get shorter.
    nextError = new Error('offline')
    const { host } = buildHost()

    await new ChatSummarizer(host).compact()

    expect(host.error.value).toBe('Compact failed: offline')
    expect(host.isCompacting.value).toBe(false)
  })
})

describe('ChatSummarizer.autoCompactIfNeeded', () => {
  it('compacts once reported usage crosses 90% of the context window', async () => {
    nextResponse = 'summary'
    const { host, applied } = buildHost({ messages: ref([assistantMessage(950)]) })

    await new ChatSummarizer(host).autoCompactIfNeeded()

    expect(applied).toHaveLength(1)
  })

  it('leaves the chat alone below the threshold', async () => {
    nextResponse = 'summary'
    const { host, applied } = buildHost({ messages: ref([assistantMessage(500)]) })

    await new ChatSummarizer(host).autoCompactIfNeeded()

    expect(applied).toEqual([])
  })

  it('waits rather than compacting mid tool call', async () => {
    nextResponse = 'summary'
    const { host, applied } = buildHost({
      messages: ref([assistantMessage(950)]),
      pendingToolCalls: ref([
        { type: 'toolCall', id: 't1', name: 'read', arguments: {} },
      ] as ToolCallContent[]),
    })

    await new ChatSummarizer(host).autoCompactIfNeeded()

    expect(applied).toEqual([])
  })

  it('does nothing when the chat model cannot be resolved', async () => {
    nextResponse = 'summary'
    const { host, applied } = buildHost({
      messages: ref([assistantMessage(950)]),
      activeModel: () => null,
    })

    await new ChatSummarizer(host).autoCompactIfNeeded()

    expect(applied).toEqual([])
  })
})
