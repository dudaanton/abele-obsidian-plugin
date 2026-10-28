import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { ChatSummarizer } from '@/ai/ChatSummarizer'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { AgentTool, AssistantMessage, Message, StreamEvent } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'
import { contentHash, READ_FIRST, ReadGuard } from '@/ai/readGuard'
import { flushPromises } from '@vue/test-utils'

const reply = (content: AssistantMessage['content']): AssistantMessage => ({
  role: 'assistant',
  content,
  model: 'sample-model',
  timestamp: 1,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
  stopReason: content.some((b) => b.type === 'toolCall') ? 'toolUse' : 'stop',
})
const calls = ['one', 'two', 'three', 'four'].map((id) => ({
  type: 'toolCall' as const,
  id,
  name: 'sample_write',
  arguments: {},
}))
let session: ChatSession
let sessions: ChatSession[]
let app: ReturnType<typeof useVault>
let execute: ReturnType<typeof vi.fn<AgentTool['execute']>>
let requests: Message[][]

function configure(holder: ChatSession) {
  const internals = holder as unknown as { getTools(): AgentTool[]; needsApproval(): boolean }
  vi.spyOn(internals, 'getTools').mockReturnValue([
    {
      name: 'sample_write',
      label: 'Sample',
      description: '',
      parameters: {},
      execute,
    },
  ])
  vi.spyOn(internals, 'needsApproval').mockReturnValue(false)
}

beforeEach(async () => {
  app = useVault([{ path: 'Samples/sample-note.md', content: 'before' }])
  sessions = []
  ChatStorage.destroy()
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    chatFolder: 'Samples/Chats/{{name}}',
    providers: [
      {
        id: 'sample-provider',
        name: 'Sample',
        baseUrl: 'https://sample.invalid/v1',
        apiKeyId: '',
        models: [
          {
            id: 'sample-model',
            name: 'Sample',
            contextWindow: 100000,
            maxTokens: 100,
            supportsReasoning: false,
          },
        ],
      },
    ],
  }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  const registry = AgentRegistry.getInstance()
  registry.setDefault(
    registry.create({ name: 'Sample', providerId: 'sample-provider', modelId: 'sample-model' }).id
  )
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('Sample system')
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  for (const key of [
    'generateTitle',
    'generateSummary',
    'generateRecap',
    'autoCompactIfNeeded',
  ] as const)
    vi.spyOn(ChatSummarizer.prototype, key).mockResolvedValue(undefined)
  execute = vi.fn(async (id) => {
    await app.vault.modify(
      app.vault.getAbstractFileByPath('Samples/sample-note.md')!,
      'saved ' + id
    )
    return { content: [{ type: 'text', text: 'Saved ' + id }] }
  })
  requests = []
  session = new ChatSession(ChatService.getInstance())
  sessions.push(session)
  configure(session)
})

afterEach(async () => {
  for (const holder of sessions) {
    await holder.flush()
    holder.destroy()
  }
  ChatStorage.destroy()
  vi.restoreAllMocks()
})

async function reopen() {
  await session.flush()
  const file = session.currentChatFile.value!
  expect(file).toBeTruthy()
  const opened = new ChatSession(ChatService.getInstance())
  sessions.push(opened)
  await opened.load(file)
  configure(opened)
  expect(opened.messages.value).toEqual(session.messages.value)
  expect(opened.messagesForModel()).toEqual(session.messagesForModel())
  return opened
}

async function continueWithRealClient(holder: ChatSession) {
  vi.mocked(OpenAIClient.prototype.stream).mockRestore()
  const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(
    new Response(
      'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: 'Continue without replay.' }, finish_reason: 'stop' }],
        }) +
        '\n\ndata: [DONE]\n\n'
    )
  )
  await holder.sendMessage('Continue')
  const messages = JSON.parse(String(fetch.mock.calls[0][1]!.body)).messages as {
    role: string
    content: string
    tool_call_id?: string
  }[]
  expect(messages.some((m) => m.content === 'Tool result unavailable')).toBe(false)
  return messages
}

function streamBatch(count: number, next?: () => AsyncGenerator<StreamEvent>) {
  let n = 0
  vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
    async function* (_model, _system, messages) {
      requests.push(structuredClone(messages))
      if (++n === 1) yield { type: 'done', message: reply(calls.slice(0, count)) }
      else if (n === 2 && next) yield* next()
      else throw Error('No continuation after Stop')
    }
  )
}

function expectStopped(holder: ChatSession, id: string, phase: string) {
  const visible = holder.messages.value.find((m) => m.toolCallId === id)
  expect(visible).toMatchObject({ role: 'tool-call', toolExecution: phase })
  expect(visible?.toolResult).toBeUndefined()
  expect(holder.messagesForModel()).toContainEqual(
    expect.objectContaining({
      role: 'toolResult',
      toolCallId: id,
      isError: true,
      content: [{ type: 'text', text: expect.stringMatching(/interrupted by the user/i) }],
    })
  )
}

describe('durable stopped turns', () => {
  it('does not authorize writes from an abandoned read completing in a later turn', async () => {
    const entered = deferred(),
      release = deferred()
    const internals = session as unknown as {
      getTools(): AgentTool[]
      wrapToolsForSession(tools: AgentTool[]): AgentTool[]
      readGuard: ReadGuard
    }
    session.scopeResolver.entries.value = [{ type: 'folder', path: 'Samples' }]
    const record = vi.spyOn(internals.readGuard, 'record')
    const wrapped = internals.wrapToolsForSession([
      {
        name: 'sample_write',
        description: '',
        parameters: {},
        execute: async () => {
          entered.resolve()
          await release.promise
          return {
            content: [{ type: 'text', text: 'before' }],
            seen: {
              path: 'Samples/sample-note.md',
              hash: contentHash('before'),
            },
          }
        },
      },
    ])
    vi.mocked(internals.getTools).mockReturnValue(wrapped)
    streamBatch(1)
    const turn = session.sendMessage('Read the sample')
    await entered.promise
    session.abort()
    await turn
    await continueWithRealClient(session)
    release.resolve()
    await flushPromises()
    expect(record).not.toHaveBeenCalled()
    expect(await internals.readGuard.check('write', { path: 'Samples/sample-note.md' })).toContain(
      READ_FIRST
    )
  })

  it.each(['queue', 'composer'])(
    'preserves preparing attachments in the %s on Stop',
    async (target) => {
      const entered = deferred(),
        release = deferred(),
        toolEntered = deferred(),
        toolRelease = deferred()
      const read = app.vault.read.bind(app.vault)
      vi.spyOn(app.vault, 'read').mockImplementation(async (file) => {
        if (file.path === 'Samples/sample-note.md') {
          entered.resolve()
          await release.promise
        }
        return read(file)
      })
      execute.mockImplementation(async () => {
        toolEntered.resolve()
        await toolRelease.promise
        return { content: [] }
      })
      streamBatch(1)
      const turn = session.sendMessage('Start the sample')
      await toolEntered.promise
      await session.sendMessage('Read this attachment', ['Samples/sample-note.md'])
      await session.sendMessage('Then inspect another sample')
      toolRelease.resolve()
      await entered.promise
      const recovered = target === 'composer' ? session.takeQueuedMessages() : undefined
      session.abort()
      await turn
      session.abort()
      const visible = session.messages.value.map((m) => m.content)
      const kept = recovered ?? session.queuedMessages.value
      expect(kept.map((q) => q.content)).toEqual([
        'Read this attachment',
        'Then inspect another sample',
      ])
      expect(kept[0].attachments).toEqual(['Samples/sample-note.md'])
      release.resolve()
      await flushPromises()
      expect(session.messages.value.map((m) => m.content)).toEqual(visible)
      const guard = (session as unknown as { readGuard: ReadGuard }).readGuard
      expect(guard.view('Samples/sample-note.md')).toBeUndefined()
      if (recovered) {
        expect(session.queuedMessages.value).toEqual([])
        return
      }
      const next = await continueWithRealClient(session)
      expect(next).toContainEqual(
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({ type: 'text', text: expect.stringContaining('before') }),
          ]),
        })
      )
      expect(session.queuedMessages.value).toEqual([])
    }
  )

  it('ends a provider stream that ignores abort and whose return never resolves', async () => {
    const entered = deferred()
    const close = vi.fn(() => new Promise<IteratorResult<StreamEvent>>(() => {}))
    vi.spyOn(OpenAIClient.prototype, 'stream').mockReturnValue({
      next: async () => {
        entered.resolve()
        return new Promise<IteratorResult<StreamEvent>>(() => {})
      },
      return: close,
      [Symbol.asyncIterator]() {
        return this
      },
    } as AsyncGenerator<StreamEvent>)
    const turn = session.sendMessage('Read the sample')
    await entered.promise
    session.abort()
    await Promise.race([
      turn,
      new Promise((_, reject) => setTimeout(() => reject(Error('Stream stayed busy')), 700)),
    ])
    expect(close).toHaveBeenCalledOnce()
    expect(session.isStreaming.value).toBe(false)
    await continueWithRealClient(session)
  })

  it.each([1, 2])(
    'ends a hung tool turn after %s Stop presses and accepts the next message',
    async (presses) => {
      const entered = deferred()
      let signal: AbortSignal | undefined
      execute.mockImplementation((_id, _args, currentSignal) => {
        signal = currentSignal
        entered.resolve()
        return new Promise(() => {})
      })
      streamBatch(4)
      const turn = session.sendMessage('Run the sample batch')
      await entered.promise
      for (let i = 0; i < presses; i++) session.abort()
      await Promise.race([
        turn,
        new Promise((_, reject) => setTimeout(() => reject(Error('Stop left the turn busy')), 700)),
      ])
      expect(signal?.aborted).toBe(true)
      expect(session.isStreaming.value).toBe(false)
      expect(session.isExecutingTool.value).toBe(false)
      expectStopped(session, 'one', 'interrupted')
      for (const id of ['two', 'three', 'four']) expectStopped(session, id, 'not-run')
      const next = await continueWithRealClient(session)
      expect(next.filter((m) => m.role === 'tool')).toHaveLength(4)
      expect(execute).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps an unfinished streamed tool request as not run when the transport throws', async () => {
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(async function* () {
      yield { type: 'text_delta', delta: 'Preparing a sample read.' }
      yield { type: 'tool_call_start', toolCallId: 'one', toolName: 'sample_write' }
      yield { type: 'tool_call_delta', delta: '{"path":"sample' }
      session.abort()
      throw new DOMException('Stopped', 'AbortError')
    })
    await session.sendMessage('Inspect the sample')
    expectStopped(session, 'one', 'not-run')
    await reopen()
    expect(execute).not.toHaveBeenCalled()
  })

  it('keeps two completed calls and streamed text when the provider throws on Stop', async () => {
    streamBatch(2, async function* () {
      yield { type: 'text_delta', delta: 'Already saved both notes.' }
      session.abort()
      throw new DOMException('Stopped', 'AbortError')
    })
    await session.sendMessage('Update the sample notes')
    expect(session.messages.value.filter((m) => m.toolCallId).map((m) => m.toolResult)).toEqual([
      'Saved one',
      'Saved two',
    ])
    // The streamed text stays, and the stop is named after it.
    expect(session.messages.value.at(-2)?.content).toBe('Already saved both notes.')
    expect(session.messages.value.at(-1)).toMatchObject({
      role: 'system',
      content: 'Stopped by you. The task may be unfinished.',
    })
    const opened = await reopen()
    const next = await continueWithRealClient(opened)
    expect(next).toContainEqual(
      expect.objectContaining({ role: 'assistant', content: 'Already saved both notes.' })
    )
    expect(next.filter((m) => m.role === 'tool').map((m) => m.content)).toEqual([
      'Saved one',
      'Saved two',
    ])
    expect(execute).toHaveBeenCalledTimes(2)
    expect(await app.vault.read(app.vault.getAbstractFileByPath('Samples/sample-note.md')!)).toBe(
      'saved two'
    )
  })

  it('keeps the running call interrupted and the unstarted tail not run', async () => {
    execute.mockImplementation(async (id, _args, signal) => {
      if (id === 'one') return { content: [{ type: 'text', text: 'Saved one' }] }
      session.abort()
      signal!.throwIfAborted()
      throw Error('unreachable')
    })
    streamBatch(3)
    await session.sendMessage('Update the sample notes')
    expectStopped(session, 'two', 'interrupted')
    expectStopped(session, 'three', 'not-run')
    const opened = await reopen()
    const next = await continueWithRealClient(opened)
    expect(next.filter((m) => m.role === 'tool')).toEqual([
      expect.objectContaining({ tool_call_id: 'one', content: 'Saved one' }),
      expect.objectContaining({
        tool_call_id: 'two',
        content: expect.stringMatching(/interrupted by the user/i),
      }),
      expect.objectContaining({
        tool_call_id: 'three',
        content: expect.stringMatching(/not run/i),
      }),
    ])
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('persists completed work and stopped call states while a non-cancellable call is still settling', async () => {
    const entered = deferred(),
      release = deferred()
    execute.mockImplementation(async (id, _args, signal) => {
      if (id !== 'three') return { content: [{ type: 'text', text: 'Saved ' + id }] }
      entered.resolve()
      await release.promise
      signal!.throwIfAborted()
      throw Error('unreachable')
    })
    streamBatch(4)
    const sending = session.sendMessage('Update the sample notes')
    await entered.promise
    session.abort()
    try {
      const opened = await reopen()
      expect(opened.messages.value.filter((m) => m.toolCallId).map((m) => m.toolResult)).toEqual([
        'Saved one',
        'Saved two',
        undefined,
        undefined,
      ])
      expectStopped(opened, 'three', 'interrupted')
      expectStopped(opened, 'four', 'not-run')
      const next = await continueWithRealClient(opened)
      expect(next.filter((m) => m.role === 'tool')).toHaveLength(4)
      expect(execute).toHaveBeenCalledTimes(3)
    } finally {
      release.resolve()
      await sending
    }
  })

  it('does not overwrite an earlier completed call when a stopped request reuses its provider ID', async () => {
    let n = 0
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(async function* () {
      n++
      if (n === 2)
        yield { type: 'done', message: reply([{ type: 'text', text: 'First turn complete.' }]) }
      else {
        if (n === 3) session.abort()
        yield { type: 'done', message: reply([calls[0]]) }
      }
    })
    await session.sendMessage('Complete the first sample')
    await session.sendMessage('Request another sample')
    const visible = session.messages.value.filter((m) => m.toolCallId === 'one')
    expect(visible).toHaveLength(2)
    expect(visible[0]).toMatchObject({ toolResult: 'Saved one', toolStatus: 'approved' })
    expect(visible[0].toolExecution).toBeUndefined()
    expect(visible[1]).toMatchObject({ toolExecution: 'not-run', toolResult: undefined })
    await reopen()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('keeps a real result when a non-cancellable tool finishes after Stop', async () => {
    execute.mockImplementation(async () => {
      session.abort()
      return { content: [{ type: 'text', text: 'Saved after cancellation' }] }
    })
    streamBatch(2)
    await session.sendMessage('Update the sample notes')
    expect(session.messages.value.find((m) => m.toolCallId === 'one')).toMatchObject({
      toolResult: 'Saved after cancellation',
    })
    expectStopped(session, 'two', 'not-run')
    await reopen()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('marks an approved manual call interrupted and settles its unstarted tail', async () => {
    const internals = session as unknown as { needsApproval(): boolean }
    vi.mocked(internals.needsApproval).mockReturnValue(true)
    streamBatch(2)
    await session.sendMessage('Update the sample notes')
    execute.mockImplementation(async (_id, _args, signal) => {
      session.abortToolExecution()
      signal!.throwIfAborted()
      throw Error('unreachable')
    })
    await session.approveToolCall()
    expectStopped(session, 'one', 'interrupted')
    expectStopped(session, 'two', 'not-run')
    const opened = await reopen()
    const next = await continueWithRealClient(opened)
    expect(next.filter((m) => m.role === 'tool')).toHaveLength(2)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('ends an approved tool that ignores abort without waiting for its result', async () => {
    const internals = session as unknown as { needsApproval(): boolean }
    vi.mocked(internals.needsApproval).mockReturnValue(true)
    streamBatch(2)
    await session.sendMessage('Update the sample notes')
    const entered = deferred()
    execute.mockImplementation(() => {
      entered.resolve()
      return new Promise(() => {})
    })
    const approval = session.approveToolCall()
    await entered.promise
    session.abort()
    session.abort()
    await Promise.race([
      approval,
      new Promise((_, reject) => setTimeout(() => reject(Error('Approval stayed busy')), 700)),
    ])
    expect(session.isExecutingTool.value).toBe(false)
    expect(session.isStreaming.value).toBe(false)
    expectStopped(session, 'one', 'interrupted')
    expectStopped(session, 'two', 'not-run')
    await continueWithRealClient(session)
  })

  it('does not turn Stop during an approval hook into an executable pending call', async () => {
    const internals = session as unknown as {
      needsApproval(): boolean
      policyFor(): Promise<{ kind: 'ask' }>
    }
    vi.mocked(internals.needsApproval).mockReturnValue(true)
    const entered = deferred(),
      release = deferred()
    vi.spyOn(internals, 'policyFor').mockImplementation(async () => {
      entered.resolve()
      await release.promise
      return { kind: 'ask' }
    })
    streamBatch(2)
    const sending = session.sendMessage('Update the sample notes')
    await entered.promise
    session.abort()
    release.resolve()
    await sending
    expect(session.pendingToolCalls.value).toEqual([])
    expectStopped(session, 'one', 'not-run')
    expectStopped(session, 'two', 'not-run')
    await reopen()
    expect(execute).not.toHaveBeenCalled()
  })

  it.each(['current', 'reopened'] as const)(
    'keeps an injected image owned and completed approval results paired in the %s chat',
    async (state) => {
      const image: Message = {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }],
        timestamp: 2,
      }
      const readImage = vi.fn<AgentTool['execute']>(async () => ({
        content: [{ type: 'text', text: 'Loaded sample-image.png' }],
        injectMessages: [image],
      }))
      const internals = session as unknown as {
        getTools(): AgentTool[]
        needsApproval(name: string): boolean
      }
      vi.mocked(internals.getTools).mockReturnValue([
        {
          name: 'read_image',
          label: 'Sample image',
          description: '',
          parameters: {},
          execute: readImage,
        },
        { name: 'sample_write', label: 'Sample write', description: '', parameters: {}, execute },
      ])
      vi.mocked(internals.needsApproval).mockImplementation((name) => name === 'sample_write')
      vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(async function* () {
        yield {
          type: 'done',
          message: reply([
            {
              type: 'toolCall',
              id: 'image-call',
              name: 'read_image',
              arguments: { path: 'Samples/sample-image.png' },
            },
            { type: 'toolCall', id: 'approved-call', name: 'sample_write', arguments: {} },
            { type: 'toolCall', id: 'stopped-call', name: 'sample_write', arguments: {} },
          ]),
        }
      })

      await session.sendMessage('Inspect the sample image and update the sample note')
      expect(session.pendingToolCalls.value.map((call) => call.id)).toEqual([
        'approved-call',
        'stopped-call',
      ])
      await session.approveToolCall()
      expect(session.pendingToolCalls.value.map((call) => call.id)).toEqual(['stopped-call'])
      session.stopFromApproval('stopped-call')
      const holder = state === 'reopened' ? await reopen() : session
      const imageRow = holder.messages.value.find((m) => m.toolCallId === 'image-call')!
      const beforeRead = holder.messages.value[0].id
      const stoppedLeaf = holder.branchLeafId!
      const storedImage = holder
        .messagesForModel()
        .find((m) => m.role === 'user' && Array.isArray(m.content))!

      const next = await continueWithRealClient(holder)
      expect(next.filter((m) => m.role === 'tool')).toEqual([
        expect.objectContaining({ tool_call_id: 'image-call', content: 'Loaded sample-image.png' }),
        expect.objectContaining({ tool_call_id: 'approved-call', content: 'Saved approved-call' }),
        expect.objectContaining({
          tool_call_id: 'stopped-call',
          content: expect.stringMatching(/interrupted by the user/i),
        }),
      ])
      expect(storedImage.chatMessageId).toBe(imageRow.id)
      const imageIndex = next.findIndex((m) => Array.isArray(m.content))
      expect(imageIndex).toBeGreaterThan(next.findIndex((m) => m.tool_call_id === 'stopped-call'))
      expect(next[imageIndex]).toMatchObject({ content: image.content })

      holder.createBranch(beforeRead)
      expect(holder.messagesForModel()).toHaveLength(1)
      expect(holder.messagesForModel()[0]).toMatchObject({
        role: 'user',
        content: 'Inspect the sample image and update the sample note',
      })
      expect(holder.switchBranch(stoppedLeaf, false)).toBe(true)
      expect(holder.messagesForModel()).toContainEqual(
        expect.objectContaining({ chatMessageId: imageRow.id, content: image.content })
      )
      expect(readImage).toHaveBeenCalledTimes(1)
      expect(execute).toHaveBeenCalledTimes(1)
      expect(await app.vault.read(app.vault.getAbstractFileByPath('Samples/sample-note.md')!)).toBe(
        'saved approved-call'
      )
    }
  )

  it('settles a displayed approval queue as not run without continuing', async () => {
    const internals = session as unknown as { needsApproval(): boolean }
    vi.mocked(internals.needsApproval).mockReturnValue(true)
    streamBatch(2)
    await session.sendMessage('Update the sample notes')
    expect(session.pendingToolCalls.value).toHaveLength(2)
    session.stopFromApproval()
    expectStopped(session, 'one', 'not-run')
    expectStopped(session, 'two', 'not-run')
    await reopen()
    expect(session.pendingToolCalls.value).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })
})
