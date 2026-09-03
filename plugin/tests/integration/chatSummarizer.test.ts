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
    recap: ref(''),
    touchedNotes: () => ['Notes/A.md'],
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
