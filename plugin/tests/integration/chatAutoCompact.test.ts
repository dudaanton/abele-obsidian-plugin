import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { parseChat, serializeChat, type ChatSnapshot } from '@/ai/ChatLog'
import { TFile } from 'obsidian'
import { ChatSummarizer } from '@/ai/ChatSummarizer'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import type { AgentTool, AssistantMessage, Message, StreamEvent } from '@/ai/client'
import { useVault } from '../helpers/testEnv'

let session: ChatSession
let requests: Message[][]
let helpers: Message[][]
let usage: number
let resultText: string
let helperError: boolean
let stopDuringSummary: boolean
let extraToolStep: boolean
let queueCorrection: boolean

const reply = (content: AssistantMessage['content'], total: number): AssistantMessage => ({
  role: 'assistant',
  content,
  model: 'sample-model',
  usage: { input: total, output: 0, totalTokens: total, cacheRead: 0, cacheWrite: 0 },
  stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
  timestamp: 1,
})

function seedCompactedRevision(storedCorrection: boolean) {
  const original: ChatMessage = {
    id: 'sample-old-reply',
    parentId: 'sample-old-question',
    role: 'assistant',
    content: 'Corrected sample fact.',
    timestamp: 2,
    revisions: [
      {
        proposal: 'sample-proposal',
        before: 'Original sample fact.',
        after: 'Corrected sample fact.',
        author: 'sample-reviewer',
        at: 3,
        highlights: [],
      },
    ],
  }
  const internals = session as unknown as {
    allChatMessages: ChatMessage[]
    allInternalMessages: Message[]
    activeLeafId: string
  }
  internals.allChatMessages = [
    { id: 'sample-old-question', role: 'user', content: 'Check the sample fact.', timestamp: 1 },
    original,
  ]
  internals.allInternalMessages = [
    {
      role: 'user',
      content: 'Check the sample fact.',
      timestamp: 1,
      chatMessageId: 'sample-old-question',
    },
    { ...reply([{ type: 'text', text: 'Original sample fact.' }], 50), chatMessageId: original.id },
  ]
  internals.activeLeafId = original.id
  session.updateVisibleMessages()
  session.applyCompactSummary('Prior sample summary.')
  if (storedCorrection) internals.allInternalMessages.push(session.messagesForModel().at(-1)!)
  return internals
}

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    providers: [
      {
        id: 'sample-provider',
        name: 'Sample',
        baseUrl: 'http://localhost/v1',
        apiKeyId: '',
        models: [
          {
            id: 'sample-model',
            name: 'Sample',
            contextWindow: 1000,
            maxTokens: 100,
            supportsReasoning: false,
          },
        ],
      },
    ],
  }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Sample',
    providerId: 'sample-provider',
    modelId: 'sample-model',
  })
  registry.setDefault(agent.id)
  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('Sample system prompt')
  for (const method of ['generateTitle', 'generateSummary', 'generateRecap'] as const) {
    vi.spyOn(ChatSummarizer.prototype, method).mockResolvedValue(undefined)
  }
  const tool: AgentTool = {
    name: 'sample_tool',
    label: 'Sample',
    description: 'Sample tool',
    parameters: {},
    execute: async (id) => ({
      content: [{ type: 'text', text: id === 'call-one' ? resultText : 'second result' }],
      ...(id === 'call-two'
        ? {
            injectMessages: [
              {
                role: 'user' as const,
                content: [
                  { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAA' } },
                ],
                timestamp: 2,
              },
            ],
          }
        : {}),
    }),
  }
  const internals = session as unknown as { getTools(): AgentTool[]; needsApproval(): boolean }
  vi.spyOn(internals, 'getTools').mockReturnValue([tool])
  vi.spyOn(internals, 'needsApproval').mockReturnValue(false)
  requests = []
  helpers = []
  usage = 920
  resultText = 'first result'
  helperError = false
  stopDuringSummary = false
  extraToolStep = false
  queueCorrection = false
  vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
    async function* (_model, system, messages): AsyncGenerator<StreamEvent> {
      if (system.includes('You summarize conversations')) {
        helpers.push(structuredClone(messages))
        if (stopDuringSummary) session.abort()
        if (helperError) yield { type: 'error', error: 'Sample summary failure' }
        else yield { type: 'text_delta', delta: 'Continue the sample request.' }
        return
      }
      requests.push(structuredClone(messages))
      if (queueCorrection && requests.length === 1)
        await session.sendMessage('Preserve the sample correction')
      const content: AssistantMessage['content'] =
        requests.length === 1
          ? [
              { type: 'toolCall', id: 'call-one', name: 'sample_tool', arguments: {} },
              { type: 'toolCall', id: 'call-two', name: 'sample_tool', arguments: {} },
            ]
          : extraToolStep && requests.length === 2
            ? [{ type: 'toolCall', id: 'call-three', name: 'sample_tool', arguments: {} }]
            : [{ type: 'text', text: 'Finished' }]
      yield {
        type: 'done',
        message: reply(
          content,
          requests.length === 1 || (extraToolStep && requests.length === 2) ? usage : 50
        ),
      }
    }
  )
})

afterEach(() => {
  session.destroy()
  vi.restoreAllMocks()
})

describe('automatic compaction inside a tool loop', () => {
  it.each(['projected', 'stored'] as const)(
    'ignores a %s correction when retaining the unread tool batch, images and queued input',
    async (kind) => {
      seedCompactedRevision(kind === 'stored')
      usage = 200
      resultText = 'unread-result '.repeat(300)
      queueCorrection = true
      await session.sendMessage('Complete the sample request')
      const next = requests[1]
      expect(next.filter((m) => m.role === 'toolResult').map((m) => m.content[0].text)).toEqual([
        resultText,
        'second result',
      ])
      expect(
        next.find((m) => m.role === 'assistant' && m.model === 'sample-model')?.content
      ).toEqual([
        { type: 'toolCall', id: 'call-one', name: 'sample_tool', arguments: {} },
        { type: 'toolCall', id: 'call-two', name: 'sample_tool', arguments: {} },
      ])
      expect(next.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
        [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }],
        'Preserve the sample correction',
      ])
      const corrections = next.filter((m) => m.role === 'assistant' && m.model === '')
      expect(corrections).toHaveLength(1)
      expect(JSON.stringify(corrections[0].content)).toContain('Corrected sample fact.')
      expect(helpers).toHaveLength(1)
      expect(JSON.stringify(helpers[0])).not.toContain('unread-result')
      expect(JSON.stringify(helpers[0])).not.toContain('Preserve the sample correction')
    }
  )

  it.each(['projected', 'stored'] as const)(
    'does not let a %s correction summarize a new request before its first model reply',
    async (kind) => {
      const internals = seedCompactedRevision(kind === 'stored')
      const content: Message['content'] = [
        { type: 'text', text: 'unanswered-request '.repeat(300) },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' } },
      ]
      internals.allChatMessages.push({
        id: 'sample-new-question',
        parentId: internals.activeLeafId,
        role: 'user',
        content: 'Unanswered sample request',
        timestamp: 4,
      })
      internals.allInternalMessages.push({
        role: 'user',
        content,
        timestamp: 4,
        chatMessageId: 'sample-new-question',
      })
      internals.activeLeafId = 'sample-new-question'
      session.updateVisibleMessages()
      await session.retryRequest()
      expect(requests[0].filter((m) => m.role === 'user').map((m) => m.content)).toEqual([content])
      expect(requests[0].filter((m) => m.role === 'assistant' && m.model === '')).toHaveLength(1)
      expect(helpers).toHaveLength(1)
      // Once the real model has responded, this user request may join the older summary.
      expect(JSON.stringify(helpers[0])).toContain('unanswered-request')
    }
  )

  it('compacts completed exchanges before a new request without summarizing that request', async () => {
    const internals = seedCompactedRevision(false)
    internals.allChatMessages.push(
      {
        id: 'sample-previous-question',
        parentId: internals.activeLeafId,
        role: 'user',
        content: 'Previous sample question',
        timestamp: 4,
      },
      {
        id: 'sample-previous-reply',
        parentId: 'sample-previous-question',
        role: 'assistant',
        content: 'Previous sample answer',
        timestamp: 5,
      },
      {
        id: 'sample-pending-question',
        parentId: 'sample-previous-reply',
        role: 'user',
        content: 'Pending sample question',
        timestamp: 6,
      }
    )
    const content = [
      { type: 'text' as const, text: 'pending-request '.repeat(300) },
      { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,CCC' } },
    ]
    internals.allInternalMessages.push(
      {
        role: 'user',
        content: 'Previous sample question',
        timestamp: 4,
        chatMessageId: 'sample-previous-question',
      },
      {
        ...reply([{ type: 'text', text: 'Previous sample answer' }], 100),
        chatMessageId: 'sample-previous-reply',
      },
      { role: 'user', content, timestamp: 6, chatMessageId: 'sample-pending-question' }
    )
    internals.activeLeafId = 'sample-pending-question'
    session.updateVisibleMessages()
    await session.retryRequest()
    expect(helpers).toHaveLength(2)
    expect(JSON.stringify(helpers[0])).toContain('Previous sample answer')
    expect(JSON.stringify(helpers[0])).not.toContain('pending-request')
    expect(requests[0].filter((m) => m.role === 'user').map((m) => m.content)).toEqual([content])
    expect(requests[0].filter((m) => m.role === 'assistant' && m.model === '')).toHaveLength(1)
  })

  it.each(['reported usage', 'new tool results', 'missing usage'] as const)(
    'compacts before the next request when %s crosses the threshold, preserving the completed batch',
    async (source) => {
      if (source !== 'reported usage') {
        usage = source === 'missing usage' ? 0 : 200
        resultText = 'sample '.repeat(1000)
      }
      await session.sendMessage('Complete the sample request')
      expect(requests).toHaveLength(2)
      expect(helpers).toHaveLength(1)
      expect(requests[1][0]).toMatchObject({
        role: 'system',
        content: expect.stringContaining('[Conversation compacted]'),
      })
      expect(requests[1].slice(1).map((m) => m.role)).toEqual([
        'assistant',
        'toolResult',
        'toolResult',
        'user',
      ])
      const results = requests[1].filter((m) => m.role === 'toolResult')
      expect(results.map((m) => m.content[0].text)).toEqual([resultText, 'second result'])
      expect(requests[1].at(-1)?.content).toEqual([
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      ])
      expect(session.messagesForModel().map((m) => m.role)).toEqual([
        'system',
        'assistant',
        'toolResult',
        'toolResult',
        'user',
        'assistant',
      ])
      expect(session.allMessages.value.filter((m) => m.role === 'tool-call')).toHaveLength(2)
      expect(session.allMessages.value.filter((m) => m.role === 'system')).toHaveLength(1)
      expect(session.error.value).toBeNull()
    }
  )

  it('retains a correction queued during the tool step', async () => {
    queueCorrection = true
    await session.sendMessage('Complete the sample request')
    expect(helpers).toHaveLength(1)
    expect(requests[1].at(-1)).toMatchObject({
      role: 'user',
      content: 'Preserve the sample correction',
    })
    expect(session.messagesForModel().filter((m) => m.role === 'toolResult')).toHaveLength(2)
    expect(session.queuedMessages.value).toEqual([])
  })

  it('waits for every pending approval and then compacts with all results intact', async () => {
    const internals = session as unknown as { needsApproval(): boolean }
    vi.spyOn(internals, 'needsApproval').mockReturnValue(true)
    await session.sendMessage('Complete the sample request')
    expect(session.pendingToolCalls.value).toHaveLength(2)
    expect(helpers).toEqual([])
    await session.approveToolCall()
    expect(session.pendingToolCalls.value).toHaveLength(1)
    expect(helpers).toEqual([])
    await session.approveToolCall()
    expect(session.pendingToolCalls.value).toEqual([])
    expect(helpers).toHaveLength(1)
    expect(requests[1].map((m) => m.role)).toEqual([
      'system',
      'assistant',
      'toolResult',
      'toolResult',
      'user',
    ])
    expect(session.messagesForModel().filter((m) => m.role === 'toolResult')).toHaveLength(2)
  })

  it('can compact again later in the same turn without duplicating results', async () => {
    extraToolStep = true
    await session.sendMessage('Complete the sample request')
    expect(requests).toHaveLength(3)
    expect(helpers).toHaveLength(2)
    expect(JSON.stringify(helpers[1])).toContain('Continue the sample request.')
    expect(requests[2].map((m) => m.role)).toEqual(['system', 'assistant', 'toolResult'])
    expect(session.messagesForModel().map((m) => m.role)).toEqual([
      'system',
      'assistant',
      'toolResult',
      'assistant',
    ])
    expect(session.allMessages.value.filter((m) => m.role === 'tool-call')).toHaveLength(3)
  })

  it('keeps the retained exchange after reopening and does not duplicate it on an earlier branch', async () => {
    await session.sendMessage('Complete the sample request')
    const snapshot = (session as unknown as { snapshot(): ChatSnapshot }).snapshot()
    const parsed = parseChat(serializeChat(snapshot))
    vi.spyOn(ChatStorage.getInstance(), 'loadChat').mockResolvedValue(parsed)
    const file = Object.assign(new TFile(), { path: 'AI/Chats/sample.abchat', basename: 'sample' })
    await session.load(file)
    expect(session.messagesForModel().map((m) => m.role)).toEqual([
      'system',
      'assistant',
      'toolResult',
      'toolResult',
      'user',
      'assistant',
    ])
    const beforeDivider = session.allMessages.value.find((m) => m.toolCallId === 'call-two')!
    // Select the cut before the divider; switchBranch normally follows descendants to a leaf.
    ;(session as unknown as { activeLeafId: string }).activeLeafId = beforeDivider.id
    session.updateVisibleMessages()
    expect(session.messagesForModel().map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'toolResult',
      'user',
    ])
  })

  it('does not compact below the threshold', async () => {
    usage = 100
    await session.sendMessage('Complete the sample request')
    expect(requests).toHaveLength(2)
    expect(helpers).toEqual([])
    expect(requests[1][0].role).toBe('user')
  })

  it('keeps the complete conversation when summarization fails', async () => {
    helperError = true
    await session.sendMessage('Complete the sample request')
    expect(helpers).toHaveLength(1)
    expect(requests[1][0].role).toBe('user')
    expect(session.messagesForModel().filter((m) => m.role === 'toolResult')).toHaveLength(2)
    expect(session.allMessages.value.filter((m) => m.role === 'system')).toEqual([])
  })

  it('does not send another request or lose results when stopped during compaction', async () => {
    stopDuringSummary = true
    await session.sendMessage('Complete the sample request')
    expect(helpers).toHaveLength(1)
    expect(requests).toHaveLength(1)
    expect(session.messagesForModel().filter((m) => m.role === 'toolResult')).toHaveLength(2)
    expect(session.isCompacting.value).toBe(false)
    expect(session.isStreaming.value).toBe(false)
  })
})
