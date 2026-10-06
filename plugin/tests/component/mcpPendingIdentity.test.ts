import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { shallowRef } from 'vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { createMcpServer } from '@/ai/mcp/types'
import { McpService } from '@/ai/mcp/McpService'
import { mcpPermissionKey, mcpDestinationKey } from '@/ai/mcp/permissions'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

const server = (id: string, name: string) =>
  createMcpServer({
    id,
    name,
    url: 'https://sample.example/mcp',
    tools: [{ name: 'echo', description: '', inputSchema: {} }],
  })
let session: ChatSession
let view: ReturnType<typeof mount>
let execute: ReturnType<typeof vi.spyOn>

destroyChatsAfterEach()
afterEach(() => view?.unmount())
beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  const config = AbeleConfig.getInstance()
  config.applySettings()
  vi.spyOn(config, 'saveSettings').mockResolvedValue()
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
  vi.spyOn(session, 'save').mockResolvedValue()
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue(shallowRef(session))
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
  const summarizer = (
    session as unknown as {
      summarizer: { generateTitle(): Promise<void>; autoCompactIfNeeded(): Promise<void> }
    }
  ).summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue()
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue()
  let first = true
  vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
    if (!first) return { messages: opts.messages }
    first = false
    return {
      messages: opts.messages,
      pausedAt: [{ type: 'toolCall', id: 'call-1', name: 'mcp_archive_echo', arguments: {} }],
    }
  })
  execute = vi
    .spyOn(McpService.getInstance(), 'callTool')
    .mockResolvedValue({ content: [{ type: 'text', text: 'done' }] })
})

const showPending = async () => {
  await session.sendMessage('Use the sample tool')
  expect(session.pendingToolCalls.value).toHaveLength(1)
  const message = session.messages.value.find((m) => m.toolCallId === 'call-1')!
  view = mount(AiToolApproval, { props: { message } })
  await flushPromises()
}
const click = async (label: string) => {
  const button = view.findAll('button').find((b) => b.text() === label)!
  expect(button).toBeDefined()
  await button.trigger('click')
  await flushPromises()
}

describe('pending MCP call identity', () => {
  it.each(['Approve', 'Always allow'])(
    'refuses a changed destination before %s without changing permissions',
    async (label) => {
      await showPending()
      AbeleConfig.getInstance().ai.mcpServers![0].url = 'https://replacement.example/mcp'
      await click(label)
      expect(execute).not.toHaveBeenCalled()
      expect(session.toolModes.value[mcpPermissionKey('original', 'echo')]).toBe('ask')
      const message = session.messages.value.find((m) => m.toolCallId === 'call-1')!
      expect(message.toolStatus).toBe('rejected')
      expect(message.toolResult).toMatch(/destination.*changed/i)
    }
  )

  it('also refuses a changed endpoint path on the same host', async () => {
    await showPending()
    AbeleConfig.getInstance().ai.mcpServers![0].url = 'https://sample.example/other-mcp'
    await click('Approve')
    expect(execute).not.toHaveBeenCalled()
    expect(session.messages.value.find((m) => m.toolCallId === 'call-1')?.toolStatus).toBe(
      'rejected'
    )
  })
  it.each(['Approve', 'Always allow'])(
    'refuses alias reassignment before %s without granting or executing the replacement',
    async (label) => {
      await showPending()
      AbeleConfig.getInstance().ai.mcpServers![0].name = 'Renamed'
      AbeleConfig.getInstance().ai.mcpServers!.push(server('replacement', 'Archive'))
      await click(label)
      expect(execute).not.toHaveBeenCalled()
      expect(session.getToolMode('mcp_archive_echo')).toBe('ask')
      const message = session.messages.value.find((m) => m.toolCallId === 'call-1')!
      expect(message.toolStatus).toBe('rejected')
      expect(message.toolResult).toMatch(/MCP tool.*changed|MCP tool.*no longer/i)
    }
  )

  it('refuses a removed original tool rather than allowing it by its former name', async () => {
    await showPending()
    AbeleConfig.getInstance().ai.mcpServers = []
    await click('Always allow')
    expect(execute).not.toHaveBeenCalled()
    expect(session.toolModes.value[mcpPermissionKey('original', 'echo')]).toBe('ask')
    expect(session.messages.value.find((m) => m.toolCallId === 'call-1')?.toolStatus).toBe(
      'rejected'
    )
  })

  it('persists the pending identity and refuses reassignment after reopening the saved chat', async () => {
    vi.mocked(session.save).mockRestore()
    await showPending()
    const file = session.currentChatFile.value!
    const stored = await ChatStorage.getInstance().loadChat(file)
    expect(stored.metadata?.pendingToolCalls?.[0].permissionKey).toBe(
      mcpPermissionKey('original', 'echo')
    )
    expect(stored.metadata?.pendingToolCalls?.[0].destinationKey).toBe(
      mcpDestinationKey(server('original', 'Archive'))
    )
    AbeleConfig.getInstance().ai.mcpServers![0].name = 'Renamed'
    AbeleConfig.getInstance().ai.mcpServers!.push(server('replacement', 'Archive'))
    await session.load(file)
    expect(session.pendingToolCalls.value[0].permissionKey).toBe(
      mcpPermissionKey('original', 'echo')
    )
    await session.approveToolCall(undefined, true, 'call-1')
    expect(execute).not.toHaveBeenCalled()
    expect(session.toolModes.value[mcpPermissionKey('replacement', 'echo')]).toBe('ask')
    expect(session.messages.value.find((m) => m.toolCallId === 'call-1')?.toolResult).toContain(
      'MCP tool changed'
    )
  })

  it('refuses destination changes after a saved pending call is reopened', async () => {
    vi.mocked(session.save).mockRestore()
    await showPending()
    const file = session.currentChatFile.value!
    AbeleConfig.getInstance().ai.mcpServers![0].url = 'https://replacement.example/mcp'
    await session.load(file)
    await session.approveToolCall(undefined, true, 'call-1')
    expect(execute).not.toHaveBeenCalled()
    expect(session.toolModes.value[mcpPermissionKey('original', 'echo')]).toBe('ask')
    expect(session.messages.value.find((m) => m.toolCallId === 'call-1')?.toolResult).toMatch(
      /destination.*changed/i
    )
  })

  it('refuses older pending calls that recorded a tool identity but no destination', async () => {
    await showPending()
    delete session.pendingToolCalls.value[0].destinationKey
    await click('Always allow')
    expect(execute).not.toHaveBeenCalled()
    expect(session.toolModes.value[mcpPermissionKey('original', 'echo')]).toBe('ask')
    expect(session.messages.value.find((m) => m.toolCallId === 'call-1')?.toolStatus).toBe(
      'rejected'
    )
  })

  it('refuses legacy pending calls with no recorded identity instead of inferring one on click', async () => {
    await showPending()
    delete session.pendingToolCalls.value[0].permissionKey
    await click('Approve')
    expect(execute).not.toHaveBeenCalled()
    expect(session.messages.value.find((m) => m.toolCallId === 'call-1')?.toolStatus).toBe(
      'rejected'
    )
  })

  it('pins the original identity and always-allows only it when the mapping stays unchanged', async () => {
    await showPending()
    expect(session.pendingToolCalls.value[0].permissionKey).toBe(
      mcpPermissionKey('original', 'echo')
    )
    await click('Always allow')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0].id).toBe('original')
    expect(session.toolModes.value[mcpPermissionKey('original', 'echo')]).toBe('auto')
    expect(session.toolModes.value[mcpPermissionKey('replacement', 'echo')]).toBe('ask')
  })
})
