import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { EMPTY_USAGE, type Message, type AgentTool } from '@/ai/client'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { cloneChatPath } from '@/ai/chatClone'
import { useVault } from '../helpers/testEnv'

const path = 'SampleBranch/sample-context.abchat'
const messages: ChatMessage[] = [
  { id: 'q', role: 'user', content: 'Review the sample memo', timestamp: 1 },
  { id: 'a', parentId: 'q', role: 'assistant', content: 'Reviewing sample sections', timestamp: 2 },
  {
    id: 'first',
    parentId: 'a',
    role: 'tool-call',
    content: '',
    timestamp: 3,
    toolName: 'sample_lookup',
    toolCallId: 'lookup-first',
    toolStatus: 'approved',
    toolResult: 'First section',
  },
  {
    id: 'later',
    parentId: 'first',
    role: 'tool-call',
    content: '',
    timestamp: 4,
    toolName: 'sample_lookup',
    toolCallId: 'lookup-later',
    toolStatus: 'approved',
    toolResult: 'Later section',
  },
  {
    id: 'reply',
    parentId: 'later',
    role: 'assistant',
    content: 'Both sections reviewed',
    timestamp: 5,
  },
]
const history: Message[] = [
  { role: 'user', content: messages[0].content, timestamp: 1, chatMessageId: 'q' },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: messages[1].content },
      { type: 'toolCall', id: 'lookup-first', name: 'sample_lookup', arguments: {} },
      { type: 'toolCall', id: 'lookup-later', name: 'sample_lookup', arguments: {} },
    ],
    model: 'sample',
    usage: EMPTY_USAGE,
    stopReason: 'toolUse',
    timestamp: 2,
    chatMessageId: 'a',
  },
  {
    role: 'toolResult',
    toolCallId: 'lookup-first',
    toolName: 'sample_lookup',
    content: [{ type: 'text', text: 'First section' }],
    stored: { key: 'sample-first-key', text: 'First retained section' },
    isError: false,
    timestamp: 3,
    chatMessageId: 'first',
  },
  {
    role: 'toolResult',
    toolCallId: 'lookup-later',
    toolName: 'sample_lookup',
    content: [{ type: 'text', text: 'Later section' }],
    stored: { key: 'sample-later-key', text: 'Later retained section' },
    isError: false,
    timestamp: 4,
    chatMessageId: 'later',
  },
  {
    role: 'assistant',
    content: [{ type: 'text', text: 'Both sections reviewed' }],
    model: 'sample',
    usage: EMPTY_USAGE,
    stopReason: 'stop',
    timestamp: 5,
    chatMessageId: 'reply',
  },
]
let session: ChatSession
let app: ReturnType<typeof useVault>
const executed = vi.fn()
const calls = (input: Message[]) =>
  input.flatMap((m) =>
    m.role === 'assistant' ? m.content.flatMap((p) => (p.type === 'toolCall' ? [p.id] : [])) : []
  )
const recordProvider = () => {
  const sent: Message[][] = []
  vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
    async function* (_model, _prompt, input) {
      sent.push(structuredClone(input))
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Sample continuation' }],
          model: 'sample',
          usage: EMPTY_USAGE,
          stopReason: 'stop',
          timestamp: 20,
        },
      }
    }
  )
  return sent
}
beforeEach(async () => {
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [
      {
        id: 'sample-provider',
        name: 'Sample provider',
        baseUrl: 'https://sample.invalid/v1',
        apiKeyId: '',
        models: [
          {
            id: 'sample',
            name: 'Sample',
            maxTokens: 1000,
            contextWindow: 100000,
            supportsReasoning: false,
          },
        ],
      },
    ],
  }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Sample reviewer',
    providerId: 'sample-provider',
    modelId: 'sample',
  })
  registry.setDefault(agent.id)
  app = useVault([
    {
      path,
      raw: serializeChat({
        metadata: {
          type: 'abele-chat',
          agentId: agent.id,
          providerId: 'sample-provider',
          modelId: 'sample',
          created: '2034-04-06',
          activeLeafId: 'reply',
        },
        messages: structuredClone(messages),
        internalMessages: structuredClone(history),
      }),
    },
    {
      path: 'SampleBranch/sample-memo.md',
      content: 'Current text includes the original later edits.',
    },
  ])
  const chats = ChatService.getInstance()
  vi.spyOn(chats, 'saveTabs').mockImplementation(() => {})
  vi.spyOn(chats, 'getSystemPrompt').mockResolvedValue('Use only the synthetic context.')
  session = new ChatSession(chats)
  await session.load(app.vault.getAbstractFileByPath(path) as TFile)
  vi.spyOn(session, 'getTools').mockReturnValue([
    {
      name: 'sample_lookup',
      label: 'Sample lookup',
      description: 'Synthetic only',
      parameters: {},
      execute: executed,
    } as AgentTool,
  ])
  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  for (const name of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded'])
    vi.spyOn(summarizer, name).mockResolvedValue(undefined)
  executed.mockClear()
})
afterEach(async () => {
  session?.destroy()
  vi.restoreAllMocks()
})

describe('editing a user message into a sibling branch', () => {
  it.each(['first', 'middle'])(
    'replaces the %s question in the visible path and provider history',
    async (position) => {
      const sent = recordProvider()
      const restore = vi.spyOn(session.rewind, 'apply')
      if (position === 'middle') await session.sendMessage('Original sample follow-up')
      const originalLeaf = session.branchLeafId!
      const original = [...session.messages.value]
      const question = position === 'first' ? original[0] : original.at(-2)!
      const prefix = original.slice(
        0,
        original.findIndex((m) => m.id === question.id)
      )
      const before = await app.vault.read(
        app.vault.getAbstractFileByPath('SampleBranch/sample-memo.md') as TFile
      )
      sent.length = 0

      session.createBranch(question.parentId ?? null)
      expect(session.messages.value).toEqual(prefix)
      expect(session.messagesForModel().map((m) => m.chatMessageId)).toEqual(
        history
          .filter((m) => prefix.some((p) => p.id === m.chatMessageId))
          .map((m) => m.chatMessageId)
      )
      await session.sendMessage('Revised sample question')
      expect(sent).toHaveLength(1)
      expect(sent[0].filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
        ...prefix.filter((m) => m.role === 'user').map((m) => m.content),
        'Revised sample question',
      ])
      const revised = session.messages.value.at(-2)!
      expect(revised.parentId).toBe(question.parentId)
      expect(session.messages.value.map((m) => m.content)).toEqual([
        ...prefix.map((m) => m.content),
        'Revised sample question',
        'Sample continuation',
      ])
      const revisedLeaf = session.branchLeafId!
      await session.save()
      await session.load(app.vault.getAbstractFileByPath(path) as TFile)
      expect(session.branchLeafId).toBe(revisedLeaf)
      expect(session.messages.value.some((m) => m.id === question.id)).toBe(false)
      expect(session.switchBranch(originalLeaf, false)).toBe(true)
      expect(session.messages.value).toEqual(original)
      expect(restore).not.toHaveBeenCalled()
      expect(executed).not.toHaveBeenCalled()
      expect(
        await app.vault.read(
          app.vault.getAbstractFileByPath('SampleBranch/sample-memo.md') as TFile
        )
      ).toBe(before)
    }
  )
})

describe('a completed-call branch in the real session', () => {
  it('cuts an intermediate answer before its bundled calls and persists that choice', async () => {
    const sent = recordProvider()
    const restore = vi.spyOn(session.rewind, 'apply')
    session.createBranch('a')
    expect(calls(session.messagesForModel())).toEqual([])
    expect(JSON.stringify(session.messagesForModel())).toContain('Reviewing sample sections')
    expect(session.messagesForModel().some((m) => m.role === 'toolResult')).toBe(false)
    await session.save()
    await session.load(app.vault.getAbstractFileByPath(path) as TFile)
    await session.sendMessage('Use a different sample approach')
    expect(sent).toHaveLength(1)
    expect(calls(sent[0])).toEqual([])
    expect(executed).not.toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()
    expect(session.switchBranch('reply', false)).toBe(true)
    expect(calls(session.messagesForModel())).toEqual(['lookup-first', 'lookup-later'])
  })

  it('keeps only images injected by a retained result in the next provider request', async () => {
    const snapshot = parseChat(await app.vault.read(app.vault.getAbstractFileByPath(path) as TFile))
    for (const [id, marker] of [
      ['first', 'prefix-image'],
      ['later', 'tail-image'],
    ]) {
      const index = snapshot.internalMessages!.findIndex((m) => m.chatMessageId === id)
      snapshot.internalMessages!.splice(index + 1, 0, {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${marker}` } }],
        chatMessageId: id,
        timestamp: 6,
      })
    }
    await app.vault.modify(app.vault.getAbstractFileByPath(path) as TFile, serializeChat(snapshot))
    await session.load(app.vault.getAbstractFileByPath(path) as TFile)
    const sent = recordProvider()
    session.createBranch('first')
    await session.sendMessage('Describe the retained sample image')
    expect(sent).toHaveLength(1)
    expect(JSON.stringify(sent[0])).toContain('prefix-image')
    expect(JSON.stringify(sent[0])).not.toContain('tail-image')
    expect(executed).not.toHaveBeenCalled()
  })

  it('excludes old compaction context, survives new compaction and reload, and restores the original branch', async () => {
    session.applyCompactSummary(
      'Old summary includes the later section.',
      session.messagesForModel()
    )
    session.createBranch('first')
    expect(JSON.stringify(session.messagesForModel())).not.toContain('Old summary')
    session.applyCompactSummary(
      'New summary covers only the first section.',
      session.messagesForModel()
    )
    await session.save()
    await session.load(app.vault.getAbstractFileByPath(path) as TFile)
    const sent = recordProvider()
    await session.sendMessage('Continue from the compacted prefix')
    expect(sent).toHaveLength(1)
    expect(calls(sent[0])).toEqual(['lookup-first'])
    expect(JSON.stringify(sent[0])).toContain('New summary')
    expect(JSON.stringify(sent[0])).not.toContain('Old summary')
    expect(session.switchBranch('reply', false)).toBe(true)
    expect(calls(session.messagesForModel())).toEqual(['lookup-first', 'lookup-later'])
    expect(executed).not.toHaveBeenCalled()
  })

  it('clones a persisted cut with remapped boundaries and real prefix results without changing its source', async () => {
    recordProvider()
    session.createBranch('first')
    await session.sendMessage('Another sample direction')
    await session.save()
    const source = parseChat(await app.vault.read(app.vault.getAbstractFileByPath(path) as TFile))
    const before = structuredClone(source)
    const clone = cloneChatPath(source, session.branchLeafId!)!
    const boundary = clone.messages.find((m) => m.branchCutAfter)
    const retained = clone.messages.find((m) => m.toolCallId === 'lookup-first')!
    expect(boundary?.branchCutAfter).toBe(retained.id)
    expect(retained.id).not.toBe('first')
    expect(calls(clone.internalMessages!)).toEqual(['lookup-first'])
    expect(clone.internalMessages!.filter((m) => m.role === 'toolResult')).toHaveLength(1)
    expect(clone.internalMessages!.find((m) => m.role === 'toolResult')?.stored?.key).toBe(
      'sample-first-key'
    )
    expect(JSON.stringify(clone.internalMessages)).not.toContain('lookup-later')
    expect(source).toEqual(before)
    expect(executed).not.toHaveBeenCalled()
  })
  it('waits, persists its cut, and sends only the real prefix through a fake provider', async () => {
    const before = await app.vault.read(
      app.vault.getAbstractFileByPath('SampleBranch/sample-memo.md') as TFile
    )
    const restore = vi.spyOn(session.rewind, 'apply')
    const sent: Message[][] = []
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
      async function* (_model, _prompt, input) {
        sent.push(structuredClone(input))
        yield {
          type: 'done',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Synthetic continuation complete' }],
            model: 'sample',
            usage: EMPTY_USAGE,
            stopReason: 'stop',
            timestamp: 10,
          },
        }
      }
    )
    session.createBranch('first')
    expect(sent).toHaveLength(0)
    expect(executed).not.toHaveBeenCalled()
    expect(calls(session.messagesForModel())).toEqual(['lookup-first'])
    await session.save()
    const saved = parseChat(await app.vault.read(app.vault.getAbstractFileByPath(path) as TFile))
    expect(saved.metadata?.pendingBranchCut).toBe('first')
    await session.load(app.vault.getAbstractFileByPath(path) as TFile)
    await session.sendMessage('Try another sample approach')
    expect(sent).toHaveLength(1)
    expect(calls(sent[0])).toEqual(['lookup-first'])
    expect(JSON.stringify(sent[0])).not.toContain('lookup-later')
    expect(JSON.stringify(sent[0])).not.toContain('unavailable')
    expect(
      sent[0].some(
        (m) =>
          m.role === 'toolResult' &&
          m.toolCallId === 'lookup-first' &&
          m.content[0].text === 'First section'
      )
    ).toBe(true)
    expect(restore).not.toHaveBeenCalled()
    expect(executed).not.toHaveBeenCalled()
    expect(
      await app.vault.read(app.vault.getAbstractFileByPath('SampleBranch/sample-memo.md') as TFile)
    ).toBe(before)
    const continued = parseChat(
      await app.vault.read(app.vault.getAbstractFileByPath(path) as TFile)
    )
    expect(
      continued.messages.find((m) => m.content === 'Try another sample approach')?.branchCutAfter
    ).toBe('first')
    expect(session.switchBranch('reply', false)).toBe(true)
    expect(calls(session.messagesForModel())).toEqual(['lookup-first', 'lookup-later'])
  })
  it('keeps retained results on the cut prefix, including after compaction', async () => {
    session.createBranch('first')
    const store = (session as unknown as { results: { lookup(key: string): unknown } }).results
    expect(store.lookup('sample-first-key')).not.toBeNull()
    expect(store.lookup('sample-later-key')).toBeNull()
    const prefix = session.messagesForModel()
    session.applyCompactSummary('Only the first sample section was reviewed.', prefix)
    expect(calls(session.messagesForModel())).toEqual(['lookup-first'])
    expect(store.lookup('sample-first-key')).not.toBeNull()
    expect(store.lookup('sample-later-key')).toBeNull()
  })
  it.each(['streaming', 'execution', 'approval', 'question', 'retry'])(
    'refuses to cut during %s',
    (state) => {
      if (state === 'streaming') session.isStreaming.value = true
      if (state === 'execution') session.isExecutingTool.value = true
      if (state === 'approval')
        session.pendingToolCalls.value = [
          { id: 'pending', type: 'toolCall', name: 'sample_lookup', arguments: {} },
        ]
      if (state === 'question')
        session.pendingQuestions.value = {
          questions: [{ question: 'Sample?', options: ['Yes'] }],
          currentIndex: 0,
          answers: [],
          resolve: () => {},
        }
      if (state === 'retry') session.retrying.value = { attempt: 1, of: 2, secondsLeft: 2 }
      session.createBranch('first')
      expect(session.branchLeafId).toBe('reply')
    }
  )
})
