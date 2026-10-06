import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatSummarizer } from '@/ai/ChatSummarizer'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { AssistantMessage, Message } from '@/ai/client'
import { createMcpServer } from '@/ai/mcp/types'
import { McpService } from '@/ai/mcp/McpService'
import { mcpToolBindings, mcpPermissionKey } from '@/ai/mcp/permissions'
import { toolPolicy, type ToolPolicy } from '@/ai/interceptor/policy'
import type { InterceptInput } from '@/ai/interceptor/context'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

const intercepted = vi.hoisted(() => ({ policy: null as ToolPolicy | null }))
vi.mock('@/ai/interceptor/runScript', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runInterceptorScript: async (_name: string, input: InterceptInput) => ({
    kind: 'send',
    text: input.message.text,
    attachments: input.message.attachments,
    rewritten: false,
    policy: intercepted.policy,
  }),
}))

const server = (id: string, name: string) =>
  createMcpServer({
    id,
    name,
    url: 'https://sample.example/mcp',
    tools: [{ name: 'echo', description: '', inputSchema: {} }],
  })
let session: ChatSession
let executed: string[]
let requests: Message[][]
let compacted: boolean

destroyChatsAfterEach()
beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  const config = AbeleConfig.getInstance()
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    mcpServers: [server('original', 'Archive')],
    providers: [
      {
        id: 'p',
        name: 'Sample',
        baseUrl: 'https://sample.example/v1',
        apiKeyId: '',
        models: [
          {
            id: 'm',
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
    providerId: 'p',
    modelId: 'm',
    toolModes: {
      [mcpPermissionKey('original', 'echo')]: 'ask',
      [mcpPermissionKey('replacement', 'echo')]: 'ask',
    },
  })
  registry.setDefault(agent.id)
  session = new ChatSession(ChatService.getInstance())
  session.interceptor.script.value = 'Sample gate'
  intercepted.policy = toolPolicy(
    { approve: ['mcp_archive_echo'], deny: [] },
    'Sample gate',
    undefined,
    mcpToolBindings(config.ai.mcpServers)
  )
  vi.spyOn(session, 'save').mockResolvedValue()
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
  for (const method of ['generateTitle', 'generateSummary', 'generateRecap'] as const)
    vi.spyOn(ChatSummarizer.prototype, method).mockResolvedValue()
  executed = []
  requests = []
  compacted = false
  vi.spyOn(ChatSummarizer.prototype, 'autoCompactIfNeeded').mockImplementation(async (options) => {
    if (options?.atIterationBoundary && executed.length === 1 && !compacted) {
      compacted = true
      session.applyCompactSummary('Sample compacted history.')
    }
  })
  vi.spyOn(McpService.getInstance(), 'callTool').mockImplementation(async (target) => {
    executed.push(target.id)
    if (target.id === 'original') {
      config.ai.mcpServers![0].name = 'Renamed'
      config.ai.mcpServers!.push(server('replacement', 'Archive'))
    }
    return { content: [{ type: 'text', text: 'done' }] }
  })
  vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(async function* (
    _model,
    _system,
    messages
  ) {
    requests.push([...messages])
    const n = requests.length
    const content: AssistantMessage['content'] =
      n <= 2
        ? [{ type: 'toolCall', id: `call-${n}`, name: 'mcp_archive_echo', arguments: {} }]
        : [{ type: 'text', text: 'done' }]
    yield {
      type: 'done',
      message: {
        role: 'assistant',
        content,
        model: 'm',
        timestamp: 1,
        stopReason: n <= 2 ? 'toolUse' : 'stop',
        usage: { input: 900, output: 0, totalTokens: 900, cacheRead: 0, cacheWrite: 0 },
      },
    }
  } as never)
})

describe('MCP interceptor identities across compaction', () => {
  it('executes the approved original tool, then asks about the replacement occupying its alias', async () => {
    await session.sendMessage('Run the sample tools')
    expect(compacted).toBe(true)
    expect(JSON.stringify(requests[1])).toContain('Sample compacted history.')
    expect(executed).toEqual(['original'])
    expect(session.pendingToolCalls.value[0]).toMatchObject({
      id: 'call-2',
      permissionKey: mcpPermissionKey('replacement', 'echo'),
    })
    expect(
      session.messages.value.find((message) => message.toolCallId === 'call-2')?.toolStatus
    ).toBe('pending')
  })
})
