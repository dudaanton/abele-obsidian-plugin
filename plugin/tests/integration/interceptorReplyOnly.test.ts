import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMetadata } from '@/ai/types'
import { EMPTY_USAGE, type Message, type ModelConfig, type StreamOptions } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'
import type { TFile } from 'obsidian'

const calls: Array<{ system: string; messages: Message[]; signal?: AbortSignal }> = []
const releases = new Map<string, () => void>()
let reviewerError = false
let mainRelease: (() => void) | null = null
let delayMain = false

vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream(
      model: ModelConfig,
      system: string,
      messages: Message[],
      _tools: unknown,
      options: StreamOptions
    ) {
      calls.push({ system, messages, signal: options.signal })
      const reviewing = system === 'Review this.'
      const text = reviewing ? String(messages.at(-1)!.content) : 'Main answer.'
      if (reviewing) {
        await new Promise<void>((resolve) => {
          releases.set(text, resolve)
          options.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        if (reviewerError) throw new Error('Reviewer offline')
      }
      if (!reviewing && delayMain) {
        await new Promise<void>((resolve) => {
          mainRelease = resolve
        })
      }
      yield { type: 'text_delta' as const, delta: text }
      yield {
        type: 'done' as const,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text }],
          model: model.id,
          usage: EMPTY_USAGE,
          stopReason: 'stop' as const,
          timestamp: Date.now(),
        },
      }
    }
  },
}))

const file = { path: 'AI/Chats/sample.abchat', basename: 'sample' } as TFile
let metadata: ChatMetadata | null = null
let storedMessages: ChatSession['messages']['value'] = []

function setup() {
  const registry = AgentRegistry.getInstance()
  const reviewer = registry.create({
    name: 'Reviewer',
    providerId: 'p1',
    modelId: 'sample',
    prompts: [{ type: 'text', value: 'Review this.' }],
  })
  const writer = registry.create({
    name: 'Writer',
    providerId: 'p1',
    modelId: 'sample',
    interceptorAgentId: reviewer.id,
    interceptorContextDepth: -1,
    interceptorReplyOnly: true,
  })
  registry.setDefault(writer.id)
  const session = new ChatSession(ChatService.getInstance())
  for (const method of [
    'generateTitle',
    'generateSummary',
    'generateRecap',
    'autoCompactIfNeeded',
  ] as const) {
    vi.spyOn(session.summarizer, method).mockResolvedValue(undefined)
  }
  return { session, writer, reviewer, registry }
}

destroyChatsAfterEach()

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  calls.length = 0
  releases.clear()
  reviewerError = false
  mainRelease = null
  delayMain = false
  metadata = null
  storedMessages = []
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [
      {
        id: 'p1',
        name: 'Sample provider',
        baseUrl: 'http://sample.invalid/v1',
        apiKeyId: 'sample-key',
        models: [
          {
            id: 'sample',
            name: 'Sample',
            contextWindow: 100000,
            maxTokens: 512,
            supportsReasoning: false,
          },
        ],
      },
    ],
    agents: [],
    defaultAgentId: '',
  }
  vi.spyOn(ChatStorage.getInstance(), 'saveChat').mockImplementation(async (snapshot) => {
    metadata = snapshot.metadata
    storedMessages = JSON.parse(JSON.stringify(snapshot.messages))
    return file
  })
  vi.spyOn(ChatStorage.getInstance(), 'loadChat').mockImplementation(async () => ({
    metadata,
    messages: storedMessages,
  }))
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
})

describe('reply-only agent interceptors', () => {
  it('finishes the main turn while the reviewer is still pending, without a draft', async () => {
    const { session } = setup()
    await session.sendMessage('First question')
    await vi.waitFor(() => expect(releases.has('First question')).toBe(true))
    expect(session.getDraftMessage()).toBeNull()
    expect(session.isBusy).toBe(false)
    expect(session.messages.value.some((m) => m.role === 'assistant')).toBe(true)
    expect(calls.find((c) => c.system === 'Review this.')?.messages.map((m) => m.content)).toEqual([
      'First question',
    ])
    const reviewing = calls.find((c) => c.system === 'Review this.')!
    expect(reviewing.signal?.aborted).toBe(false)
    releases.get('First question')!()
    await vi.waitFor(() =>
      expect(storedMessages[0].interceptorChat?.[0]?.content).toBe('First question')
    )
  })

  it('keeps overlapping replies on their own messages even when they finish in reverse order', async () => {
    const { session } = setup()
    await session.sendMessage('First question')
    await session.sendMessage('Second question')
    await vi.waitFor(() => expect(releases.size).toBe(2))
    const second = calls.filter((c) => c.system === 'Review this.')[1]
    expect(second.messages.map((m) => m.content)).toEqual([
      '[user]: First question',
      '[assistant]: Main answer.',
      'Second question',
    ])
    releases.get('Second question')!()
    await vi.waitFor(() =>
      expect(
        session.messages.value.find((m) => m.content === 'Second question')?.interceptorChat?.[0]
          ?.content
      ).toBe('Second question')
    )
    releases.get('First question')!()
    await vi.waitFor(() =>
      expect(
        session.messages.value.find((m) => m.content === 'First question')?.interceptorChat?.[0]
          ?.content
      ).toBe('First question')
    )
    expect(session.messages.value.at(-1)?.role).toBe('assistant')
  })

  it('can finish a review while the main turn is still streaming', async () => {
    const { session } = setup()
    delayMain = true
    const sent = session.sendMessage('Sample question')
    await vi.waitFor(() => expect(mainRelease).not.toBeNull())
    await vi.waitFor(() => expect(releases.has('Sample question')).toBe(true))
    releases.get('Sample question')!()
    await vi.waitFor(() =>
      expect(session.messages.value[0].interceptorChat?.[0]?.content).toBe('Sample question')
    )
    expect(session.isBusy).toBe(true)
    expect(session.messages.value.filter((m) => m.role === 'assistant')).toHaveLength(0)
    mainRelease!()
    await sent
    expect(session.messages.value.at(-1)?.role).toBe('assistant')
  })

  it('keeps user notes without asking either agent', async () => {
    const { session } = setup()
    expect(await session.addUserNote('Sample observation')).toBe(true)
    expect(calls).toEqual([])
    expect(session.messages.value[0].interceptorChat).toBeUndefined()
  })

  it('still filters messages and leaves scripts in control', async () => {
    const { session, writer, registry } = setup()
    registry.update(writer.id, { interceptorPattern: '^/review' })
    await session.sendMessage('Plain question')
    expect(calls.some((c) => c.system === 'Review this.')).toBe(false)
    expect(session.interceptor.route('/review text')).toMatchObject({
      kind: 'agent',
      replyOnly: true,
    })
    session.interceptor.script.value = 'Sample guard'
    expect(session.interceptor.route('/review text').kind).toBe('script')
  })

  it('injects queued reply-only messages as usual rather than holding them for a separate turn', async () => {
    const { session } = setup()
    session.queuedMessages.value = [{ id: 'q1', content: 'Queued question' }]
    const taken = await (session as unknown as { takeQueued(): Promise<Message[]> }).takeQueued()
    expect(taken.map((m) => m.content)).toEqual(['Queued question'])
    expect(session.queuedMessages.value).toEqual([])
    await vi.waitFor(() => expect(releases.has('Queued question')).toBe(true))
    releases.get('Queued question')!()
  })

  it('keeps the mode as a chat override across save and reopen', async () => {
    const { session, writer, registry } = setup()
    session.interceptor.replyOnly.value = false
    await session.addUserNote('Sample note')
    expect(metadata?.interceptorReplyOnly).toBe(false)
    registry.update(writer.id, { interceptorReplyOnly: true })
    const reopened = new ChatSession(ChatService.getInstance())
    await reopened.load(file)
    expect(reopened.interceptor.replyOnly.value).toBe(false)
    expect(reopened.interceptor.followsAgent).toBe(false)
    reopened.interceptor.followAgent()
    expect(reopened.interceptor.replyOnly.value).toBe(true)
  })

  it('reports reviewer failures beside the reviewed message without failing the main turn', async () => {
    const { session } = setup()
    await session.sendMessage('Sample question')
    await vi.waitFor(() => expect(releases.has('Sample question')).toBe(true))
    reviewerError = true
    releases.get('Sample question')!()
    const id = session.messages.value[0].id
    await vi.waitFor(() =>
      expect(session.interceptor.replyReviews.value[id]?.error).toBe('Reviewer offline')
    )
    expect(session.error.value).toBeNull()
    expect(session.isBusy).toBe(false)
  })

  it('cancels pending reviews on reset, even if a provider ignores abort', async () => {
    const { session } = setup()
    await session.sendMessage('Old question')
    await vi.waitFor(() => expect(releases.has('Old question')).toBe(true))
    const signal = calls.find((c) => c.system === 'Review this.')!.signal
    await session.reset()
    expect(signal?.aborted).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(session.messages.value).toEqual([])
    expect(session.interceptor.replyReviews.value).toEqual({})
  })
})
