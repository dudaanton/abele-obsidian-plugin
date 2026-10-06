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
let nextStreamError: string | null = null
/** Every (systemPrompt, messages) pair the stub was called with. */
const calls: Array<{ model: ModelConfig; system: string; messages: Message[] }> = []

vi.mock('@/ai/client/OpenAIClient', () => {
  class OpenAIClient {
    async *stream(_model: ModelConfig, system: string, messages: Message[]) {
      calls.push({ model: _model, system, messages })
      if (nextError) throw nextError
      yield { type: 'text_delta' as const, delta: nextResponse }
      if (nextStreamError) yield { type: 'error' as const, error: nextStreamError }
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
  let dirties = 0

  const host: SummarizerHost = {
    messages: ref<ChatMessage[]>([]),
    chatTitle: ref(''),
    currentChatFile: shallowRef<TFile | null>(null),
    isGeneratingTitle: ref(false),
    isCompacting: ref(false),
    isStreaming: ref(false),
    error: ref<string | null>(null),
    pendingToolCalls: ref<ToolCallContent[]>([]),
    recap: ref(''),
    summary: ref(''),
    touchedNotes: () => ['Notes/A.md'],
    messagesForModel: () => [
      { role: 'user', content: 'question', timestamp: 1 },
      { role: 'user', content: 'another', timestamp: 2 },
      { role: 'user', content: 'third', timestamp: 3 },
      ...(overrides.messages?.value ?? [])
        .filter((m) => m.role === 'assistant' && m.usage)
        .map((m) => modelAssistant(m.usage!.total)),
    ],
    toolDefs: () => [],
    hasInternalMessages: () => true,
    applyCompactSummary: (summary: string) => void applied.push(summary),
    backgroundSignal: () => new AbortController().signal,
    save: async () => void saves++,
    markDirty: () => void dirties++,
    auxiliaryModel: () => MODEL,
    activeModel: () => MODEL,
    ...overrides,
  }

  return { host, applied, saveCount: () => saves, dirtyCount: () => dirties }
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

function modelAssistant(total: number): Message {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'answer' }],
    model: MODEL.id,
    usage: { input: total, output: 0, totalTokens: total, cacheRead: 0, cacheWrite: 0 },
    stopReason: 'stop',
    timestamp: 4,
  }
}

beforeEach(() => {
  nextResponse = ''
  nextError = null
  nextStreamError = null
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
  it.each(['manual', 'automatic'] as const)(
    'reports a streamed failure during %s compaction without replacing history',
    async (kind) => {
      nextResponse = 'Partial summary'
      nextStreamError = 'Sample connection failure'
      const { host, applied, saveCount } = buildHost({ messages: ref([assistantMessage(999)]) })
      const summarizer = new ChatSummarizer(host)
      if (kind === 'manual') await summarizer.compact()
      else await summarizer.autoCompactIfNeeded()
      expect(host.error.value).toBe('Compact failed: Sample connection failure')
      expect(applied).toEqual([])
      expect(saveCount()).toBe(0)
    }
  )

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

/**
 * A user turn carrying attachments has `content` as an array of parts rather than a string —
 * see `UserMessage` in `ai/client/types.ts`. The transcript handed to the summarising model
 * has to read the text out of those parts, the way the assistant branch already does. It used
 * to interpolate the array straight into a template string, so everything the user actually
 * typed reached the model as `[object Object]` and was summarised away.
 */
describe('the transcript a summary is made from', () => {
  const transcript = () =>
    (calls[0].messages[0].content as string).split('\n\n').filter((l) => l.startsWith('[user]'))

  it('carries the text of a plain user turn', async () => {
    nextResponse = 'ok'
    const { host } = buildHost({
      messagesForModel: () => [{ role: 'user', content: 'what does the parser do', timestamp: 1 }],
    })

    await new ChatSummarizer(host).compact()

    expect(transcript()).toEqual(['[user]: what does the parser do'])
  })

  it('carries the text the user typed alongside an attachment', async () => {
    nextResponse = 'ok'
    const { host } = buildHost({
      messagesForModel: () => [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is in this screenshot' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
          ],
          timestamp: 1,
        },
      ],
    })

    await new ChatSummarizer(host).compact()

    expect(transcript()).toEqual(['[user]: what is in this screenshot'])
  })

  it('never lets a content part reach the model as [object Object]', async () => {
    nextResponse = 'ok'
    const { host } = buildHost({
      messagesForModel: () => [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'compare these' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
          ],
          timestamp: 1,
        },
      ],
    })

    await new ChatSummarizer(host).compact()

    expect(calls[0].messages[0].content as string).not.toContain('[object Object]')
  })

  it('drops a turn that carried no text at all, as it does for the assistant', async () => {
    nextResponse = 'ok'
    const { host } = buildHost({
      messagesForModel: () => [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }],
          timestamp: 1,
        },
        { role: 'user', content: 'and this one', timestamp: 2 },
      ],
    })

    await new ChatSummarizer(host).compact()

    expect(transcript()).toEqual(['[user]: and this one'])
  })
})

describe('ChatSummarizer.autoCompactIfNeeded', () => {
  it('can compact while a title request is still running', async () => {
    nextResponse = 'summary'
    const { host, applied } = buildHost({
      messages: ref([assistantMessage(950)]),
      isGeneratingTitle: ref(true),
    })
    await new ChatSummarizer(host).autoCompactIfNeeded()
    expect(applied).toEqual(['summary'])
  })

  it('includes the preceding summary when compacting again', async () => {
    nextResponse = 'updated summary'
    const { host, applied } = buildHost({
      messagesForModel: () => [
        {
          role: 'system',
          content: '[Conversation compacted]\n\nKeep the sample goal.',
          timestamp: 1,
          chatMessageId: 'divider',
        },
        { role: 'user', content: 'Continue', timestamp: 2 },
        modelAssistant(950),
      ],
    })
    await new ChatSummarizer(host).autoCompactIfNeeded()
    expect(applied).toEqual(['updated summary'])
    expect(JSON.stringify(calls[0].messages)).toContain('Keep the sample goal.')
  })

  it('does not reuse usage from a reply omitted by a previous compaction', async () => {
    nextResponse = 'summary'
    const { host, applied } = buildHost({
      messages: ref([assistantMessage(999)]),
      messagesForModel: () => [
        { role: 'system', content: '[Conversation compacted]\n\nSample summary', timestamp: 1 },
        { role: 'user', content: 'Next question', timestamp: 2 },
        modelAssistant(0),
      ],
    })
    await new ChatSummarizer(host).autoCompactIfNeeded()
    expect(applied).toEqual([])
  })

  it('counts prompt and tool definitions when usage is missing', async () => {
    nextResponse = 'summary'
    const { host, applied } = buildHost()
    await new ChatSummarizer(host).autoCompactIfNeeded({ systemPrompt: 'sample '.repeat(1000) })
    expect(applied).toEqual(['summary'])
  })

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

describe('ChatSummarizer.generateRecap', () => {
  it('records the sentence and saves it', async () => {
    nextResponse = 'Tidied the Arashiyama note and checked its links.'
    const { host, saveCount } = buildHost()

    await new ChatSummarizer(host).generateRecap()

    expect(host.recap.value).toBe('Tidied the Arashiyama note and checked its links.')
    expect(saveCount()).toBe(1)
  })

  it('names the notes that were written, alongside the conversation', async () => {
    nextResponse = 'ok'
    const { host } = buildHost({ touchedNotes: () => ['Notes/A.md', 'Notes/B.md'] })

    await new ChatSummarizer(host).generateRecap()

    const sent = calls[0].messages[0].content as string
    expect(sent).toContain('Notes/A.md')
    expect(sent).toContain('Notes/B.md')
    expect(sent).toContain('[user]: question')
  })

  it('uses the prompt the settings hold rather than the built-in one', async () => {
    nextResponse = 'ok'
    AbeleConfig.getInstance().ai.prompts = {
      ...DEFAULT_AI_SETTINGS.prompts,
      recapPrompt: 'MY OWN PROMPT\n\n{{messages}}',
    }
    const { host } = buildHost()

    await new ChatSummarizer(host).generateRecap()

    expect(calls[0].messages[0].content as string).toContain('MY OWN PROMPT')
  })

  /** A recap runs after every writing turn, so a whole transcript per turn is the wrong cost. */
  it('sends a bounded window of the conversation, not all of it', async () => {
    nextResponse = 'ok'
    const long = 'x'.repeat(5000)
    const { host } = buildHost({
      messagesForModel: () =>
        Array.from({ length: 40 }, (_, i) => ({
          role: 'user' as const,
          content: `${i}: ${long}`,
          timestamp: i,
        })),
    })

    await new ChatSummarizer(host).generateRecap()

    const sent = calls[0].messages[0].content as string
    expect(sent.length).toBeLessThan(6000)
    // The end of the conversation is what the work was, so that is the end that is kept.
    expect(sent).toContain('39: ')
    expect(sent).not.toContain('0: ')
  })

  it('does not ask again while the same notes are the ones that were written', async () => {
    nextResponse = 'Tidied A.'
    const { host } = buildHost()
    const summarizer = new ChatSummarizer(host)

    await summarizer.generateRecap()
    await summarizer.generateRecap()

    expect(calls).toHaveLength(1)
  })

  /**
   * The summarizer outlives the conversation: one tab, one `ChatSummarizer`, and a new chat
   * started in it through `reset()`. Without forgetting, a second chat over the same notes
   * would silently never get a sentence.
   */
  it('asks again for the same notes once the tab has been given a new chat', async () => {
    nextResponse = 'Tidied A.'
    const { host } = buildHost()
    const summarizer = new ChatSummarizer(host)

    await summarizer.generateRecap()
    summarizer.forgetRecap()
    await summarizer.generateRecap()

    expect(calls).toHaveLength(2)
  })

  it('asks again once another note has been written', async () => {
    nextResponse = 'Tidied A.'
    let notes = ['Notes/A.md']
    const { host } = buildHost({ touchedNotes: () => notes })
    const summarizer = new ChatSummarizer(host)

    await summarizer.generateRecap()
    notes = ['Notes/A.md', 'Notes/B.md']
    await summarizer.generateRecap()

    expect(calls).toHaveLength(2)
  })

  it('asks nothing when the chat has written to nothing', async () => {
    nextResponse = 'ok'
    const { host } = buildHost({ touchedNotes: () => [] })

    await new ChatSummarizer(host).generateRecap()

    expect(calls).toHaveLength(0)
  })

  it('leaves the recap alone when the request fails, and reports nothing', async () => {
    nextError = new Error('offline')
    const { host } = buildHost({ recap: ref('What it said before') })

    await new ChatSummarizer(host).generateRecap()

    expect(host.recap.value).toBe('What it said before')
    expect(host.error.value).toBeNull()
  })

  it('strips the quotes a model puts round a sentence, and cuts a long one', async () => {
    nextResponse = `"${'word '.repeat(80)}"`
    const { host } = buildHost()

    await new ChatSummarizer(host).generateRecap()

    expect(host.recap.value.startsWith('"')).toBe(false)
    expect(host.recap.value.length).toBeLessThanOrEqual(200)
  })
})

describe('location results in helper-model requests', () => {
  // Invented device data. The helper can be a different provider from the approved chat model.
  const locationText = JSON.stringify({
    latitude: 12.345,
    longitude: 67.89,
    accuracy: 24,
    timestamp: 1234567890000,
    device: 'sample-device-token',
  })
  const locationResult = {
    role: 'toolResult' as const,
    toolCallId: 'sample-location-call',
    toolName: 'current_location',
    content: [
      { type: 'text' as const, text: locationText },
      { type: 'text' as const, text: 'sample-location-extra' },
    ],
    timestamp: 2,
    isError: false,
  }

  it.each(['generateRecap', 'compact', 'autoCompactIfNeeded'] as const)(
    '%s receives a redacted placeholder instead of any location result content',
    async (operation) => {
      nextResponse = 'A sample summary.'
      const messages: Message[] = [
        { role: 'user', content: 'Find a nearby place', timestamp: 1 },
        locationResult,
        {
          role: 'toolResult',
          toolCallId: 'sample-read-call',
          toolName: 'read',
          content: [{ type: 'text', text: 'ordinary sample tool answer' }],
          timestamp: 3,
          isError: false,
        },
        modelAssistant(950),
      ]
      const before = structuredClone(messages)
      const helper: ModelConfig = {
        ...MODEL,
        id: 'sample-helper',
        baseUrl: 'https://helper.example/v1',
      }
      const { host } = buildHost({
        messages: ref([assistantMessage(950)]),
        messagesForModel: () => messages,
        auxiliaryModel: () => helper,
        activeModel: () => ({ ...MODEL, id: 'sample-primary', baseUrl: 'http://localhost/v1' }),
      })
      await new ChatSummarizer(host)[operation]()
      expect(calls).toHaveLength(1)
      expect(calls[0].model).toEqual(helper)
      const sent = JSON.stringify(calls[0].messages)
      expect(sent).toContain('[tool current_location]: [Location result redacted]')
      for (const secret of [
        '12.345',
        '67.89',
        '1234567890000',
        'sample-device-token',
        'sample-location-extra',
      ]) {
        expect(sent).not.toContain(secret)
      }
      expect(sent).toContain('ordinary sample tool answer')
      // Only the helper's rendering is redacted, not the main model's history or stored result.
      expect(messages).toEqual(before)
    }
  )
})

describe('ChatSummarizer.generateSummary', () => {
  const SECRET = 'SECRET-FROM-A-TOOL'

  function conversation(): ChatMessage[] {
    return [
      { id: 'u', role: 'user', content: 'Plan my trip to Rome', timestamp: 1 },
      {
        id: 't',
        role: 'tool-call',
        content: 'Calling read',
        toolName: 'read',
        toolParams: { path: SECRET },
        toolResult: SECRET,
        timestamp: 2,
      },
      {
        id: 'a',
        role: 'assistant',
        content: 'Here is a three-day plan.',
        thinking: SECRET,
        timestamp: 3,
      },
    ]
  }

  it('writes the summary and asks for it to be saved with the next write', async () => {
    nextResponse = '"Planning a three-day trip to Rome."'
    const { host, saveCount, dirtyCount } = buildHost({ messages: ref(conversation()) })

    await new ChatSummarizer(host).generateSummary()

    expect(host.summary.value).toBe('Planning a three-day trip to Rome.')
    expect(dirtyCount()).toBe(1)
    expect(saveCount()).toBe(0)
  })

  it('asks from the conversation text alone, never from tools or reasoning', async () => {
    nextResponse = 'A trip'
    const { host } = buildHost({ messages: ref(conversation()) })

    await new ChatSummarizer(host).generateSummary()

    const sent = JSON.stringify(calls[0].messages)
    expect(sent).toContain('Plan my trip to Rome')
    expect(sent).toContain('Here is a three-day plan.')
    expect(sent).not.toContain(SECRET)
  })

  it('asks for nothing before the agent has answered', async () => {
    const { host } = buildHost({
      messages: ref<ChatMessage[]>([{ id: 'u', role: 'user', content: 'hi', timestamp: 1 }]),
    })

    await new ChatSummarizer(host).generateSummary()

    expect(calls).toHaveLength(0)
    expect(host.summary.value).toBe('')
  })

  it('keeps the summary it had when the request fails', async () => {
    nextError = new Error('offline')
    const { host } = buildHost({ messages: ref(conversation()), summary: ref('Old one') })

    await new ChatSummarizer(host).generateSummary()

    expect(host.summary.value).toBe('Old one')
    expect(host.error.value).toBeNull()
  })
})
