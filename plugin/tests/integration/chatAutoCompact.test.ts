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
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
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
