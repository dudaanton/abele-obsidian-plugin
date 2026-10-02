import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import { toolPolicy } from '@/ai/interceptor/policy'
import type { Message, ToolCallContent } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

const policy = vi.hoisted(() => ({ approve: vi.fn() }))
vi.mock('@/ai/interceptor/runScript', async (original) => ({
  ...(await original<typeof import('@/ai/interceptor/runScript')>()),
  runInterceptorScript: async (
    _name: string,
    input: { message: { text: string; attachments: string[] } }
  ) => ({
    kind: 'send',
    text: input.message.text,
    attachments: input.message.attachments,
    rewritten: false,
    policy: toolPolicy({ approve: policy.approve, deny: [] }, 'Sample policy'),
  }),
}))
let planned: ToolCallContent[] = []
vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream(_model: unknown, _prompt: string, messages: Message[], tools: unknown[]) {
      const hasResult = messages.some((message) => message.role === 'toolResult')
      const calls = tools?.length && !hasResult ? planned : []
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content: calls.length ? calls : [{ type: 'text', text: 'Sample answer' }],
          model: 'sample-model',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          stopReason: calls.length ? 'toolUse' : 'stop',
          timestamp: Date.now(),
        },
      }
    }
  },
}))
const provider: AiProvider = {
  id: 'sample-provider',
  name: 'Sample provider',
  baseUrl: 'https://model.example/v1',
  apiKeyId: '',
  models: [
    {
      id: 'sample-model',
      name: 'Sample model',
      contextWindow: 32000,
      maxTokens: 100,
      supportsReasoning: false,
    },
  ],
}
const call = (id: string, name: string, args: Record<string, unknown>): ToolCallContent => ({
  type: 'toolCall',
  id,
  name,
  arguments: args,
})
let session: ChatSession
const messages = () =>
  session.messages.value
    .map((message) => `${message.content}\n${message.toolResult ?? ''}`)
    .join('\n')
destroyChatsAfterEach()
beforeEach(() => {
  useVault([
    {
      path: 'Clips/Remote.md',
      content: 'Remote sample instructions',
      frontmatter: { type: 'abele-skill', name: 'Remote' },
    },
    {
      path: 'Clips/Other.md',
      content: 'Other sample instructions',
      frontmatter: { type: 'abele-skill', name: 'Other' },
    },
  ])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
  }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  const agent = AgentRegistry.getInstance().create({
    name: 'Sample worker',
    providerId: provider.id,
    modelId: 'sample-model',
    interceptorScript: 'Sample policy',
  })
  session = new ChatSession(ChatService.getInstance(), undefined, { agentId: agent.id })
  policy.approve
    .mockReset()
    .mockImplementation((request: { name: string; args: Record<string, unknown> }) =>
      request.name === 'skill' && request.args.name === 'Remote' ? true : undefined
    )
})
afterEach(() => vi.restoreAllMocks())

describe('interceptor approval reaching the real skill tool', () => {
  it('admits the approved foreign skill in the loop without approving the next foreign skill', async () => {
    planned = [
      call('remote-call', 'skill', { name: 'Remote' }),
      call('other-call', 'skill', { name: 'Other' }),
    ]
    await session.sendMessage('Use the sample skills')
    expect(messages()).toContain('Remote sample instructions')
    expect(messages()).not.toContain('requires approval')
    expect(messages()).not.toContain('Other sample instructions')
    expect(session.pendingToolCalls.value.map((call) => call.id)).toEqual(['other-call'])
  })
  it('admits an interceptor-approved skill behind a manually approved queue head', async () => {
    planned = [
      call('memory-call', 'remember', { text: 'Keep answers concise' }),
      call('remote-call', 'skill', { name: 'Remote' }),
    ]
    await session.sendMessage('Remember and use the sample skill')
    expect(session.pendingToolCalls.value.map((call) => call.id)).toEqual([
      'memory-call',
      'remote-call',
    ])
    await session.approveToolCall()
    expect(messages()).toContain('Remote sample instructions')
    expect(messages()).not.toContain('requires approval')
    expect(session.pendingToolCalls.value).toEqual([])
    expect(session.agent.value?.memory?.map((item) => item.text)).toEqual(['Keep answers concise'])
  })
})
