import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { parseChat } from '@/ai/ChatLog'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import type { InterceptInput } from '@/ai/interceptor/context'
import { DEFAULT_AI_SETTINGS, type ChatMetadata } from '@/ai/types'
import { EMPTY_USAGE, type Message, type ModelConfig, type StreamOptions } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'
import type { TFile } from 'obsidian'

const calls: Array<{ system: string; messages: Message[]; signal?: AbortSignal }> = []
const releases = new Map<string, () => void>()
let reviewerError = false
let reviewerEventError: string | null = null
let partialReview = false
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
        if (reviewerEventError) {
          const partial = partialReview ? 'Sample unfinished review' : ''
          if (partial) yield { type: 'text_delta' as const, delta: partial }
          yield {
            type: 'error' as const,
            error: reviewerEventError,
            message: {
              role: 'assistant' as const,
              content: [{ type: 'text' as const, text: partial }],
              model: model.id,
              usage: EMPTY_USAGE,
              stopReason: 'error' as const,
              errorMessage: reviewerEventError,
              timestamp: Date.now(),
            },
          }
          return
        }
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
  ScriptService.destroy()
  AgentRegistry.destroy()
  calls.length = 0
  releases.clear()
  reviewerError = false
  reviewerEventError = null
  partialReview = false
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

async function setupScript() {
  const state = setup()
  state.registry.update(state.writer.id, {
    interceptorAgentId: '',
    interceptorScript: 'Sample guard',
  })
  const service = ScriptService.getInstance()
  await service.discover()
  vi.spyOn(service, 'getAll').mockReturnValue([
    {
      path: 'Scripts/sample-guard.js',
      commandId: '',
      code: '',
      meta: { name: 'Sample guard', description: '', params: [], interceptor: 1 },
    },
  ])
  const pending = new Map<
    string,
    {
      resolve(value?: unknown): void
      reject(reason: Error): void
      signal: AbortSignal
      input: InterceptInput
    }
  >()
  vi.spyOn(service, 'intercept').mockImplementation(
    (_path, input, signal) =>
      new Promise((resolve, reject) => {
        pending.set(input.message.text, { resolve, reject, signal, input })
      })
  )
  return { ...state, pending, service }
}

async function sentWithoutWaiting(session: ChatSession, text: string, attachments?: string[]) {
  let finished = false
  void session.sendMessage(text, attachments).then(() => {
    finished = true
  })
  await vi.waitFor(() => expect(finished).toBe(true), { timeout: 500 })
}

const annotations = (session: ChatSession, text: string) =>
  session.messages.value.find((m) => m.content === text)?.interceptorChat?.map((m) => m.content) ??
  []

describe('reply-only script interceptors', () => {
  it('sends unchanged immediately, snapshots the usual inputs and saves out-of-order replies', async () => {
    const { session, pending } = await setupScript()
    await sentWithoutWaiting(session, 'First question')
    await sentWithoutWaiting(session, 'Second question')
    expect(session.isBusy).toBe(false)
    expect(session.getDraftMessage()).toBeNull()
    expect(session.interceptor.working.value).toBe(false)
    expect(pending.get('First question')!.input.message).toEqual({
      text: 'First question',
      attachments: [],
    })
    expect(pending.get('First question')!.input.chat.messages).toEqual([])
    expect(pending.get('Second question')!.input.chat.messages.map((m) => m.text)).toEqual([
      'First question',
      'Main answer.',
    ])
    pending.get('Second question')!.resolve({ reply: 'Second review' })
    await vi.waitFor(() =>
      expect(annotations(session, 'Second question')).toEqual(['Second review'])
    )
    pending.get('First question')!.resolve({ reply: 'First review' })
    await vi.waitFor(() =>
      expect(storedMessages[0].interceptorChat?.[0].content).toBe('First review')
    )
    expect(annotations(session, 'Second question')).toEqual(['Second review'])
    const reopened = new ChatSession(ChatService.getInstance())
    await reopened.load(file)
    expect(reopened.interceptor.script.value).toBe('Sample guard')
    expect(reopened.interceptor.replyOnly.value).toBe(true)
    expect(annotations(reopened, 'First question')).toEqual(['First review'])
  })

  it('persists a script-specific chat override independently of the agent default', async () => {
    const { session, writer, registry } = await setupScript()
    session.interceptor.script.value = 'Sample guard'
    session.interceptor.replyOnly.value = true
    session.interceptor.pattern.value = '^/review'
    await session.addUserNote('Sample note')
    expect(metadata).toMatchObject({
      interceptorScript: 'Sample guard',
      interceptorReplyOnly: true,
      interceptorPattern: '^/review',
    })
    registry.update(writer.id, { interceptorScript: '', interceptorReplyOnly: false })
    const reopened = new ChatSession(ChatService.getInstance())
    await reopened.load(file)
    expect(reopened.interceptor.followsAgent).toBe(false)
    expect(reopened.interceptor.route('/review next')).toMatchObject({
      kind: 'script',
      script: 'Sample guard',
      replyOnly: true,
    })
  })

  it.each([undefined, null, true])('keeps a silent result (%s) invisible', async (value) => {
    const { session, pending } = await setupScript()
    await sentWithoutWaiting(session, 'Silent question')
    pending.get('Silent question')!.resolve(value)
    await vi.waitFor(() =>
      expect(session.interceptor.replyReviews.value[session.messages.value[0].id]?.streaming).toBe(
        false
      )
    )
    expect(annotations(session, 'Silent question')).toEqual([])
    expect(session.error.value).toBeNull()
  })

  it.each([
    ['replacement', /rewrite/i],
    ['Original question', /rewrite/i],
    [{ text: 'Original question' }, /rewrite/i],
    [{ attachments: [] }, /rewrite/i],
    [{ text: 'replacement', attachments: ['sample-note.md'] }, /rewrite/i],
    [{ hold: 'Wait' }, /hold/i],
    [{ approve: true, deny: ['demo'] }, /tool/i],
  ])('ignores controlling result %j and explains it under the message', async (value, reason) => {
    const { session, pending } = await setupScript()
    await sentWithoutWaiting(session, 'Original question')
    pending.get('Original question')!.resolve(value)
    await vi.waitFor(() =>
      expect(annotations(session, 'Original question').join(' ')).toMatch(reason)
    )
    expect(session.getDraftMessage()).toBeNull()
    expect(calls[0].messages.find((m) => m.role === 'user')?.content).toBe('Original question')
    expect(
      session.messages.value.filter((m) => m.role === 'assistant').map((m) => m.content)
    ).toEqual(['Main answer.'])
    expect(session.error.value).toBeNull()
  })

  it('filters scripts and injects matching queued messages without holding them', async () => {
    const { session, pending } = await setupScript()
    session.interceptor.pattern.value = '^/review'
    await session.sendMessage('Plain question')
    expect(pending.size).toBe(0)
    session.queuedMessages.value = [{ id: 'q1', content: '/review queued' }]
    const taken = await (session as unknown as { takeQueued(): Promise<Message[]> }).takeQueued()
    expect(taken.map((m) => m.content)).toEqual(['/review queued'])
    await vi.waitFor(() => expect(pending.has('/review queued')).toBe(true))
    pending.get('/review queued')!.resolve({ reply: 'Queued review' })
    await vi.waitFor(() =>
      expect(annotations(session, '/review queued')).toEqual(['Queued review'])
    )
  })

  it('keeps script errors and timeouts beside the message, not on the main turn', async () => {
    const { session, pending } = await setupScript()
    await sentWithoutWaiting(session, 'Failing question')
    pending.get('Failing question')!.reject(new Error('Sample script failure'))
    await vi.waitFor(() =>
      expect(annotations(session, 'Failing question').join(' ')).toContain('Sample script failure')
    )
    await sentWithoutWaiting(session, 'Slow question')
    await vi.waitFor(() => expect(annotations(session, 'Slow question').join(' ')).toMatch(/1 s/), {
      timeout: 2000,
    })
    expect(session.error.value).toBeNull()
    expect(session.isBusy).toBe(false)
    expect(session.messages.value.filter((m) => m.role === 'assistant')).toHaveLength(2)
  })

  describe.each(['reset', 'load'] as const)('a script finishing during %s', (transition) => {
    it.each([
      { reply: 'Late review' },
      { hold: 'Late hold' },
      { text: 'Late rewrite' },
      { approve: true },
      42,
    ])('discards %j while the old conversation is being saved', async (result) => {
      const { session, pending } = await setupScript()
      await sentWithoutWaiting(session, 'Old question')
      const oldMessage = session.messages.value[0]
      // Force reset's outgoing save to write, rather than taking the log's noop path.
      session.chatTitle.value = 'Changed sample title'
      const loadedFile = { path: 'AI/Chats/loaded.abchat', basename: 'loaded' } as TFile
      const freshFile = { path: 'AI/Chats/fresh.abchat', basename: 'fresh' } as TFile
      vi.mocked(ChatStorage.getInstance().loadChat).mockResolvedValue({
        metadata: null,
        messages: [],
      })
      let releaseOutgoing!: () => void
      let releaseLate!: () => void
      const outgoing = new Promise<void>((resolve) => {
        releaseOutgoing = resolve
      })
      const late = new Promise<void>((resolve) => {
        releaseLate = resolve
      })
      const targets: Array<string | undefined> = []
      vi.mocked(ChatStorage.getInstance().saveChat).mockImplementation(
        async (_snapshot, _plan, target) => {
          targets.push(target?.path)
          if (targets.length === 1) await outgoing
          if (targets.length === 2) await late
          return target ?? freshFile
        }
      )
      const saves = vi.spyOn(session, 'save')
      const changing = transition === 'reset' ? session.reset() : session.load(loadedFile)
      let accepted: string[] = []
      try {
        await vi.waitFor(() => expect(targets).toEqual([file.path]))
        // The old bubble still exists and cancellation has not happened yet. Only the
        // conversation version says it is no longer allowed to accept a script's result.
        pending.get('Old question')!.resolve(result)
        await new Promise((resolve) => setTimeout(resolve, 0))
        accepted = (oldMessage.interceptorChat ?? []).map((m) => m.content)
      } finally {
        releaseOutgoing()
        await changing
        releaseLate()
        await session.flush()
      }
      expect(session.currentChatFile.value?.path ?? null).toBe(
        transition === 'load' ? loadedFile.path : null
      )
      expect(accepted).toEqual([])
      expect(saves).toHaveBeenCalledTimes(1)
      expect(targets).toEqual([file.path])
      await session.addUserNote('New observation')
      expect(targets.at(-1)).toBe(transition === 'load' ? loadedFile.path : undefined)
      expect(session.currentChatFile.value?.path).toBe(
        transition === 'load' ? loadedFile.path : freshFile.path
      )
    })
  })

  it('cancels on reset and discards late results even when the script ignores abort', async () => {
    const { session, pending } = await setupScript()
    await sentWithoutWaiting(session, 'Old question')
    const old = pending.get('Old question')!
    await session.reset()
    expect(old.signal.aborted).toBe(true)
    old.resolve({ reply: 'Too late' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(session.messages.value).toEqual([])
    expect(session.interceptor.replyReviews.value).toEqual({})
  })
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

  it('persists a review that arrives while the main turn is being written', async () => {
    const { session } = setup()
    let serialized = ''
    let releaseWrite: (() => void) | undefined
    let writes = 0
    vi.mocked(ChatStorage.getInstance().saveChat).mockImplementation(async (_snapshot, plan) => {
      if (++writes === 1)
        await new Promise<void>((resolve) => {
          releaseWrite = resolve
        })
      if (plan.kind === 'rewrite') serialized = plan.content
      else if (plan.kind === 'append') serialized += plan.data
      return file
    })
    const sending = session.sendMessage('Sample question')
    await vi.waitFor(() => expect(releaseWrite).toBeDefined())
    await vi.waitFor(() => expect(releases.has('Sample question')).toBe(true))
    releases.get('Sample question')!()
    await vi.waitFor(() => expect(session.messages.value[0].interceptorChat).toHaveLength(1))
    releaseWrite!()
    await sending
    await vi.waitFor(() =>
      expect(parseChat(serialized).messages[0].interceptorChat?.[0]?.content).toBe(
        'Sample question'
      )
    )
    vi.mocked(ChatStorage.getInstance().loadChat).mockImplementation(async () =>
      parseChat(serialized)
    )
    const reopened = new ChatSession(ChatService.getInstance())
    await reopened.load(file)
    expect(reopened.messages.value[0].interceptorChat?.[0]?.content).toBe('Sample question')
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

  it('still filters messages and routes scripts separately', async () => {
    const { session, writer, registry } = setup()
    registry.update(writer.id, { interceptorPattern: '^/review' })
    await session.sendMessage('Plain question')
    expect(calls.some((c) => c.system === 'Review this.')).toBe(false)
    expect(session.interceptor.route('/review text')).toMatchObject({
      kind: 'agent',
      replyOnly: true,
    })
    session.interceptor.script.value = 'Sample guard'
    expect(session.interceptor.route('/review text')).toMatchObject({
      kind: 'script',
      replyOnly: true,
    })
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

  it.each([401, 429, 500])(
    'surfaces an HTTP %s error event without failing the main turn',
    async (status) => {
      const { session } = setup()
      reviewerEventError = `HTTP ${status}: Sample provider failure`
      await session.sendMessage('Sample question')
      await vi.waitFor(() => expect(releases.has('Sample question')).toBe(true))
      releases.get('Sample question')!()
      const id = session.messages.value[0].id
      await vi.waitFor(() =>
        expect(session.interceptor.replyReviews.value[id]?.error).toBe(reviewerEventError)
      )
      expect(session.messages.value[0].interceptorChat).toEqual([])
      expect(session.interceptor.replyReviews.value[id]?.streaming).toBe(false)
      expect(session.error.value).toBeNull()
      expect(session.isBusy).toBe(false)
    }
  )

  it.each([false, true])(
    'discards an interrupted review and supports Retry (reply only: %s)',
    async (replyOnly) => {
      const { session } = setup()
      session.interceptor.replyOnly.value = replyOnly
      reviewerEventError = 'Sample stream interrupted'
      partialReview = true
      const sending = session.sendMessage('Sample question')
      await vi.waitFor(() => expect(releases.has('Sample question')).toBe(true))
      releases.get('Sample question')!()
      await sending
      const id = session.messages.value[0].id
      const progress = () =>
        replyOnly
          ? session.interceptor.replyReviews.value[id]
          : {
              error: session.interceptor.error.value,
              streaming: session.interceptor.streaming.value,
              streamingContent: session.interceptor.streamingContent.value,
            }
      await vi.waitFor(() => expect(progress()?.error).toBe('Sample stream interrupted'))
      expect(progress()?.streaming).toBe(false)
      expect(progress()?.streamingContent).toBe('')
      expect(session.messages.value[0].interceptorChat).toEqual([])

      reviewerEventError = null
      const retrying = session.retryInterceptor(id)
      await vi.waitFor(() =>
        expect(calls.filter((c) => c.system === 'Review this.')).toHaveLength(2)
      )
      releases.get('Sample question')!()
      await retrying
      expect(progress()?.error).toBeNull()
      expect(session.messages.value[0].interceptorChat?.map((m) => m.content)).toEqual([
        'Sample question',
      ])
    }
  )

  it('cancels a holding reviewer and keeps the draft ready to send or edit', async () => {
    const { session } = setup()
    session.interceptor.replyOnly.value = false
    const sending = session.sendMessage('Sample held question')
    await vi.waitFor(() => expect(releases.has('Sample held question')).toBe(true))
    expect(session.interceptor.streaming.value).toBe(true)
    const signal = calls.find((c) => c.system === 'Review this.')!.signal
    session.abort()
    await sending
    expect(signal?.aborted).toBe(true)
    expect(session.interceptor.streaming.value).toBe(false)
    expect(session.interceptor.error.value).toBeNull()
    expect(session.getDraftMessage()?.content).toBe('Sample held question')
    expect(session.getDraftMessage()?.interceptorChat).toEqual([])
    await session.confirmDraft(session.getDraftMessage()!.id)
    expect(session.getDraftMessage()).toBeNull()
    expect(session.messages.value.at(-1)?.role).toBe('assistant')
  })

  it('cancels pending reviews on reset, even if a provider ignores abort', async () => {
    const { session } = setup()
    await session.sendMessage('Old question')
    await vi.waitFor(() => expect(releases.has('Old question')).toBe(true))
    const signal = calls.find((c) => c.system === 'Review this.')!.signal
    await session.reset()
    expect(signal?.aborted).toBe(true)
    await flushPromises()
    expect(session.messages.value).toEqual([])
    expect(session.interceptor.replyReviews.value).toEqual({})
  })
})
