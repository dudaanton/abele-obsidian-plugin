/**
 * The interceptor reading the agent's finished answer and, by itself, putting its own text in
 * its place: inside the turn, before anything else runs; kept as a revision of the reply so the
 * next turn reads the replacement and undo hands the agent its own words back; a failure or Stop
 * keeps the answer and says why under it; a message typed meanwhile waits.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { parseChat } from '@/ai/ChatLog'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import type { InterceptInput } from '@/ai/interceptor/context'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import {
  EMPTY_USAGE,
  type AgentTool,
  type Message,
  type ModelConfig,
  type StreamOptions,
} from '@/ai/client'
import { newEntry } from '@/ai/interceptor/entries'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

const main: Array<{ messages: Message[] }> = []
const reviews: Message[][] = []
let answers: string[] = []
let failMain = 0
let reviewerReply = 'The lamp is on the shelf.'
let reviewerFails = false
let toolFirst = false

const userText = (m: Message) =>
  typeof m.content === 'string'
    ? m.content
    : (m.content as { type: string; text?: string }[]).map((b) => b.text ?? '').join('')

vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream(
      model: ModelConfig,
      system: string,
      messages: Message[],
      _tools: unknown,
      options: StreamOptions
    ) {
      const reviewing = system === 'Check this answer.'
      if (reviewing) {
        reviews.push(messages)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5)
          options.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              resolve()
            },
            { once: true }
          )
        })
        if (reviewerFails) throw new Error('Sample reviewer offline')
      } else {
        main.push({ messages })
        if (failMain > 0) {
          failMain--
          throw new Error('Sample provider failure')
        }
      }
      if (!reviewing && toolFirst) {
        toolFirst = false
        yield {
          type: 'done' as const,
          message: {
            role: 'assistant' as const,
            content: [
              { type: 'toolCall' as const, id: 'call-one', name: 'sample_tool', arguments: {} },
            ],
            model: model.id,
            usage: EMPTY_USAGE,
            stopReason: 'toolUse' as const,
            timestamp: Date.now(),
          },
        }
        return
      }
      const text = reviewing ? reviewerReply : (answers.shift() ?? 'The lantern is on the shelf.')
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

let app: ReturnType<typeof useVault>

function agents(writerPatch: Record<string, unknown> = {}) {
  const registry = AgentRegistry.getInstance()
  const reviewer = registry.create({
    name: 'Sample checker',
    providerId: 'p1',
    modelId: 'sample',
    prompts: [{ type: 'text', value: 'Check this answer.' }],
    // Its own interceptor must never run: interceptors do not chain.
    interceptorScript: 'Sample guard',
    interceptorChecks: 'both',
  })
  const writer = registry.create({
    name: 'Writer',
    providerId: 'p1',
    modelId: 'sample',
    interceptorChecks: 'answer',
    ...writerPatch,
  })
  registry.setDefault(writer.id)
  return { registry, reviewer, writer }
}

function newSession() {
  const session = new ChatSession(ChatService.getInstance())
  for (const method of [
    'generateTitle',
    'generateSummary',
    'generateRecap',
    'autoCompactIfNeeded',
  ] as const) {
    vi.spyOn(session.summarizer, method).mockResolvedValue(undefined)
  }
  return session
}

type Pending = {
  resolve(value?: unknown): void
  reject(reason: Error): void
  signal: AbortSignal
  input: InterceptInput
}

async function scriptSetup(writerPatch: Record<string, unknown> = {}) {
  const state = agents({ interceptorScript: 'Sample guard', ...writerPatch })
  const service = ScriptService.getInstance()
  await service.discover()
  vi.spyOn(service, 'getAll').mockReturnValue([
    {
      path: 'Scripts/sample-guard.js',
      commandId: '',
      code: '',
      meta: { name: 'Sample guard', description: '', params: [], interceptor: 30 },
    },
  ])
  const pending: Pending[] = []
  const intercept = vi.spyOn(service, 'intercept').mockImplementation(
    (_path, input, signal) =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject, signal, input })
      })
  )
  return { ...state, pending, intercept, session: newSession() }
}

const assistant = (session: ChatSession): ChatMessage[] =>
  session.messages.value.filter((m) => m.role === 'assistant')

async function onDisk(session: ChatSession) {
  const file = session.currentChatFile.value!
  return parseChat(await app.vault.read(file))
}

destroyChatsAfterEach()

beforeEach(() => {
  app = useVault([])
  ScriptService.destroy()
  AgentRegistry.destroy()
  ChatService.getInstance().destroy()
  ChatStorage.destroy()
  main.length = 0
  reviews.length = 0
  answers = []
  failMain = 0
  reviewerReply = 'The lamp is on the shelf.'
  reviewerFails = false
  toolFirst = false
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    chatFolder: 'AI/Chats',
    chatHistory: [],
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
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
})

describe('an interceptor checking the agent’s answers', () => {
  it('replaces the answer inside the turn, keeps the original and the next turn reads the replacement', async () => {
    const { session, pending, intercept } = await scriptSetup()
    const sent = session.sendMessage('Where is the lantern?')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    // The person's message went straight on: only the answer reaches the script.
    expect(intercept).toHaveBeenCalledTimes(1)
    expect(session.answerCheck.value).toMatchObject({ by: 'Sample guard' })
    expect(session.isMidTurn).toBe(true)
    const input = pending[0].input
    expect(input.message).toMatchObject({
      kind: 'answer',
      text: 'The lantern is on the shelf.',
      attachments: [],
      tools: [],
    })
    expect(input.chat.messages.map((m) => m.text)).toEqual(['Where is the lantern?'])
    pending[0].resolve('The lamp is on the shelf.')
    await sent
    expect(session.answerCheck.value).toBeNull()

    const [answer] = assistant(session)
    expect(answer.content).toBe('The lamp is on the shelf.')
    expect(answer.revisions).toEqual([
      expect.objectContaining({
        by: 'interceptor',
        author: 'Sample guard',
        before: 'The lantern is on the shelf.',
        after: 'The lamp is on the shelf.',
      }),
    ])
    const disk = await onDisk(session)
    expect(disk.messages.find((m) => m.id === answer.id)?.content).toBe('The lamp is on the shelf.')
    expect(disk.messages.find((m) => m.id === answer.id)?.revisions?.[0].before).toBe(
      'The lantern is on the shelf.'
    )

    answers = ['Second answer.']
    const second = session.sendMessage('And the key?')
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[1].resolve()
    await second
    const history = main[1].messages.filter((m) => m.role === 'assistant').map(userText)
    expect(history).toEqual(['The lamp is on the shelf.'])
  })

  it('undone, gives the next turn the agent’s own answer back', async () => {
    const { session, pending } = await scriptSetup()
    const sent = session.sendMessage('Where is the lantern?')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending[0].resolve({ text: 'The lamp is on the shelf.' })
    await sent
    await session.undoReplyRevision(assistant(session)[0].id)
    expect(assistant(session)[0].content).toBe('The lantern is on the shelf.')

    const second = session.sendMessage('And the key?')
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[1].resolve()
    await second
    expect(main[1].messages.filter((m) => m.role === 'assistant').map(userText)).toEqual([
      'The lantern is on the shelf.',
    ])
  })

  it('checks only messages unless told otherwise, and only answers when told so', async () => {
    const { session, pending, registry, writer } = await scriptSetup({
      interceptorChecks: 'message',
    })
    const sent = session.sendMessage('Where is the lantern?')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    expect(pending[0].input.message.kind).toBe('message')
    pending[0].resolve()
    await sent
    expect(pending).toHaveLength(1)
    expect(assistant(session)[0].revisions).toBeUndefined()

    registry.update(writer.id, { interceptorChecks: 'both' })
    const both = session.sendMessage('And the key?')
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    expect(pending[1].input.message.kind).toBe('message')
    pending[1].resolve()
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    expect(pending[2].input.message.kind).toBe('answer')
    pending[2].resolve()
    await both
  })

  it('applies the pattern to the answer being checked', async () => {
    const { session, pending, intercept } = await scriptSetup({ interceptorPattern: '^Sample' })
    await session.sendMessage('Where is the lantern?')
    expect(intercept).not.toHaveBeenCalled()
    answers = ['Sample answer.']
    const sent = session.sendMessage('Again?')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending[0].resolve()
    await sent
  })

  it.each([
    [
      'a failing script',
      (p: Pending) => p.reject(new Error('Sample script failure')),
      /Sample script failure/,
    ],
    ['a result it cannot use', (p: Pending) => p.resolve({ reply: 'x' }), /"reply"/],
  ])('keeps the answer and says why after %s', async (_name, finish, reason) => {
    const { session, pending } = await scriptSetup()
    const sent = session.sendMessage('Where is the lantern?')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    finish(pending[0])
    await sent
    const [answer] = assistant(session)
    expect(answer.content).toBe('The lantern is on the shelf.')
    expect(answer.revisions).toBeUndefined()
    const note = answer.interceptorChat?.map((m) => m.content).join(' ') ?? ''
    expect(note).toMatch(reason)
    expect(note).toContain('The answer stays as it was.')
    expect(answer.interceptorName).toBe('Sample guard')
    expect(answer.interceptorCollapsed).toBe(false)
    expect(session.error.value).toBeNull()
  })

  it('a note alone stays under the kept answer', async () => {
    const { session, pending } = await scriptSetup()
    const sent = session.sendMessage('Where is the lantern?')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending[0].resolve({ note: 'Checked against the sample list.' })
    await sent
    const [answer] = assistant(session)
    expect(answer.content).toBe('The lantern is on the shelf.')
    expect(answer.interceptorChat?.map((m) => m.content)).toEqual([
      'Checked against the sample list.',
    ])
  })

  it('Stop cancels the check and keeps the answer, saying it was stopped', async () => {
    const { session, pending } = await scriptSetup()
    const sent = session.sendMessage('Where is the lantern?')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    session.abort()
    expect(pending[0].signal.aborted).toBe(true)
    await sent
    const [answer] = assistant(session)
    expect(answer.content).toBe('The lantern is on the shelf.')
    expect(answer.interceptorChat?.map((m) => m.content).join(' ')).toMatch(/stopped/)
    expect(session.answerCheck.value).toBeNull()
    expect(session.isBusy).toBe(false)
  })

  it('holds a message typed during the check until the check is done', async () => {
    const { session, pending } = await scriptSetup()
    const sent = session.sendMessage('Where is the lantern?')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    await session.sendMessage('And the key?')
    expect(session.queuedMessages.value.map((q) => q.content)).toEqual(['And the key?'])
    expect(main).toHaveLength(1)
    answers = ['Second answer.']
    pending[0].resolve('The lamp is on the shelf.')
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    // The queued message ran after the replacement, and its turn read the replacement.
    expect(main).toHaveLength(2)
    expect(main[1].messages.filter((m) => m.role === 'assistant').map(userText)).toEqual([
      'The lamp is on the shelf.',
    ])
    pending[1].resolve()
    await sent
  })

  it('checks the answer of a retried turn', async () => {
    const { session, pending } = await scriptSetup()
    failMain = 1
    await session.sendMessage('Where is the lantern?')
    expect(session.error.value).toBeTruthy()
    expect(pending).toHaveLength(0)
    const retried = session.retryRequest()
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending[0].resolve('The lamp is on the shelf.')
    await retried
    expect(assistant(session)[0].content).toBe('The lamp is on the shelf.')
  })

  it('checks the answer of a turn that went on after a tool was approved, showing the script that call', async () => {
    const { session, pending } = await scriptSetup()
    const internals = session as unknown as { getTools(): AgentTool[]; needsApproval(): boolean }
    vi.spyOn(internals, 'getTools').mockReturnValue([
      {
        name: 'sample_tool',
        label: 'Sample tool',
        description: 'A tool that needs to be approved.',
        parameters: {},
        execute: async () => ({ content: [{ type: 'text' as const, text: 'sample result' }] }),
      },
    ])
    vi.spyOn(internals, 'needsApproval').mockReturnValue(true)
    toolFirst = true
    await session.sendMessage('Where is the lantern?')
    expect(session.pendingToolCalls.value).toHaveLength(1)
    expect(pending).toHaveLength(0)
    const approved = session.approveToolCall()
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    expect(pending[0].input.message.tools).toEqual([
      { name: 'sample_tool', args: {}, result: 'sample result', refused: false },
    ])
    pending[0].resolve('The lamp is on the shelf.')
    await approved
    expect(assistant(session).at(-1)?.content).toBe('The lamp is on the shelf.')
  })

  it('a reviewing agent’s reply becomes the answer, and its own interceptor never runs', async () => {
    const { reviewer, writer, registry } = agents()
    registry.update(writer.id, { interceptorAgentId: reviewer.id, interceptorContextDepth: -1 })
    const service = ScriptService.getInstance()
    const intercept = vi.spyOn(service, 'intercept')
    const session = newSession()
    await session.sendMessage('Where is the lantern?')
    expect(reviews).toHaveLength(1)
    expect(intercept).not.toHaveBeenCalled()
    expect(reviews[0].map(userText)).toEqual([
      '[user]: Where is the lantern?',
      'The lantern is on the shelf.',
    ])
    const [answer] = assistant(session)
    expect(answer.content).toBe('The lamp is on the shelf.')
    expect(answer.revisions?.[0]).toMatchObject({ by: 'interceptor', author: 'Sample checker' })
  })

  it('a reviewing agent that fails or says nothing keeps the answer', async () => {
    const { reviewer, writer, registry } = agents()
    registry.update(writer.id, { interceptorAgentId: reviewer.id })
    const session = newSession()
    reviewerFails = true
    await session.sendMessage('Where is the lantern?')
    expect(assistant(session)[0].content).toBe('The lantern is on the shelf.')
    expect(assistant(session)[0].interceptorChat?.[0].content).toMatch(/Sample reviewer offline/)
    reviewerFails = false
    reviewerReply = '   '
    await session.sendMessage('And the key?')
    expect(assistant(session)[1].content).toBe('The lantern is on the shelf.')
    expect(assistant(session)[1].interceptorChat).toBeUndefined()
  })

  it('never checks a delegated run’s answers, even with a chat-style override', async () => {
    const { writer, intercept } = await scriptSetup()
    const run = new ChatSession(ChatService.getInstance(), undefined, {
      kind: 'run',
      agentId: writer.id,
    })
    for (const method of [
      'generateTitle',
      'generateSummary',
      'generateRecap',
      'autoCompactIfNeeded',
    ] as const) {
      vi.spyOn(run.summarizer, method).mockResolvedValue(undefined)
    }
    run.interceptor.script.value = 'Sample guard'
    run.interceptor.checks.value = 'answer'
    await run.sendMessage('Where is the lantern?')
    expect(intercept).not.toHaveBeenCalled()
    expect(assistant(run)[0].content).toBe('The lantern is on the shelf.')
    run.destroy()
  })

  it('remembers a chat’s own choice of what is checked', async () => {
    const { session, registry, writer } = await scriptSetup({ interceptorChecks: 'message' })
    session.interceptor.checks.value = 'answer'
    await session.addUserNote('Sample note')
    const file = session.currentChatFile.value!
    expect((await onDisk(session)).metadata).toMatchObject({ interceptorChecks: 'answer' })
    registry.update(writer.id, { interceptorChecks: 'both' })
    const reopened = newSession()
    await reopened.load(file)
    expect(reopened.interceptor.checks.value).toBe('answer')
    expect(reopened.interceptor.route('anything')).toEqual({ kind: 'none' })
    expect(reopened.interceptor.answerRoute('anything')).toMatchObject({ kind: 'script' })
  })
})

describe('several interceptors over an answer', () => {
  /** The writer runs `Sample guard`, then the checking agent, over its answers. */
  async function chainSetup() {
    const state = await scriptSetup()
    state.registry.update(state.writer.id, {
      interceptors: [
        newEntry({ id: 'ic-guard', script: 'Sample guard', checks: 'answer' }),
        newEntry({ id: 'ic-checker', agentId: state.reviewer.id, checks: 'answer' }),
      ],
    })
    return state
  }

  it('each reads the answer the one before left, counted, and each leaves a version', async () => {
    const { session, pending } = await chainSetup()
    reviewerReply = 'The lamp is on the high shelf.'
    const readers: unknown[] = []
    watch(session.answerCheck, (now) => now && readers.push(now), { flush: 'sync' })
    const sent = session.sendMessage('Where is the lantern?')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending[0].resolve('The lamp is on the shelf.')
    await sent
    expect(readers).toEqual([
      expect.objectContaining({ by: 'Sample guard', at: 1, of: 2 }),
      expect.objectContaining({ by: 'Sample checker', at: 2, of: 2 }),
    ])

    expect(userText(reviews[0].at(-1)!)).toBe('The lamp is on the shelf.')
    const [answer] = assistant(session)
    expect(answer.content).toBe('The lamp is on the high shelf.')
    expect(answer.revisions?.map((r) => [r.author, r.before, r.after])).toEqual([
      ['Sample guard', 'The lantern is on the shelf.', 'The lamp is on the shelf.'],
      ['Sample checker', 'The lamp is on the shelf.', 'The lamp is on the high shelf.'],
    ])
  })

  it('one that fails keeps the answer as it stands, and the ones after it do not read it', async () => {
    const { session, pending } = await chainSetup()
    const sent = session.sendMessage('Where is the lantern?')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending[0].reject(new Error('Sample guard broke'))
    await sent

    expect(reviews).toHaveLength(0)
    const [answer] = assistant(session)
    expect(answer.content).toBe('The lantern is on the shelf.')
    const said = answer.interceptorChat?.map((m) => m.content).join('\n') ?? ''
    expect(said).toContain('The answer stays as it was')
    expect(said).toContain('The interceptors after it did not read it.')
  })
})

