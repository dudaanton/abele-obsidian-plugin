import { beforeEach, describe, expect, it } from 'vitest'
import { Notice, TFile } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { ChatService } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { createMcpServer } from '@/ai/mcp/types'
import { createMcpTools } from '@/ai/mcp/tools'
import { mcpPermissionKey } from '@/ai/mcp/permissions'
import { subAgentRefusal } from '@/ai/SubAgentRunner'
import { secretRequestForTool } from '@/ai/tools/secretUtils'
import { collectEntries, applyEntries } from '@/transfer/entries'
import { ChatStorage } from '@/ai/ChatStorage'
import { serializeChat } from '@/ai/ChatLog'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

const pair = (id: string, name: string, tool: string) =>
  createMcpServer({
    id,
    name,
    url: `https://${id}.example/mcp`,
    headers: { 'X-Key': `key-${id}` },
    tools: [{ name: tool, description: '', inputSchema: {} }],
  })

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().applySettings()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    mcpServers: [pair('a', 'One', 'part_echo'), pair('b', 'One_part', 'echo')],
  }
  Notice.shown.length = 0
})

describe('MCP permissions through execution and transfer', () => {
  it('filters and approves each pair independently, including after a server rename', () => {
    const config = AbeleConfig.getInstance()
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({
      toolModes: {
        [mcpPermissionKey('a', 'part_echo')]: 'auto',
        [mcpPermissionKey('b', 'echo')]: 'ask',
      },
    })
    registry.setDefault(agent.id)
    const session = new ChatSession(ChatService.getInstance())
    for (const renamed of [false, true]) {
      if (renamed) config.ai.mcpServers![0].name = 'Other'
      const tools = createMcpTools(config.ai.mcpServers)
      expect(registry.filterTools(agent, tools)).toHaveLength(2)
      expect(session.needsApproval(tools[0].name, {})).toBe(false)
      expect(session.needsApproval(tools[1].name, {})).toBe(true)
      expect(subAgentRefusal(tools[0].name, {}, agent, session.scopeResolver)).toBeNull()
      expect(subAgentRefusal(tools[1].name, {}, agent, session.scopeResolver)).toContain(
        'needs approval'
      )
      expect(secretRequestForTool(tools[1].name, {})).toMatchObject({
        url: 'https://b.example/mcp',
      })
    }
    registry.update(agent.id, { toolModes: { [mcpPermissionKey('a', 'part_echo')]: 'auto' } })
    expect(
      registry.filterTools(registry.get(agent.id)!, createMcpTools(config.ai.mcpServers))
    ).toHaveLength(1)
  })

  it('never uses a stale legacy auto entry as a live permission', () => {
    const session = new ChatSession(ChatService.getInstance())
    session.toolModes.value = { mcp_one_part_echo: 'auto' }
    expect(session.needsApproval('mcp_one_part_echo', {})).toBe(true)
  })

  it('transfers server identities and both defaults and agent choices unchanged', () => {
    const config = AbeleConfig.getInstance()
    config.ai.toolModes = { [mcpPermissionKey('a', 'part_echo')]: 'auto' }
    const agent = AgentRegistry.getInstance().create({
      toolModes: {
        [mcpPermissionKey('a', 'part_echo')]: 'auto',
        [mcpPermissionKey('b', 'echo')]: 'off',
      },
    })
    const source = config.exportSettings()
    const entries = collectEntries(source).filter((e) =>
      ['ai-general', 'ai-agents', 'ai-mcp-servers'].includes(e.section)
    )
    const target = { ...source, ai: { ...DEFAULT_AI_SETTINGS, agents: [], mcpServers: [] } }
    const received = applyEntries(entries, target)
    expect(received.ai.toolModes).toEqual(source.ai.toolModes)
    expect(received.ai.agents.find((a) => a.id === agent.id)?.toolModes).toEqual(agent.toolModes)
    expect(received.ai.mcpServers?.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('migrates old chat overrides to ask, saves them, and notices only on the first load', async () => {
    const agent = AgentRegistry.getInstance().create({ name: 'Sample' })
    AgentRegistry.getInstance().setDefault(agent.id)
    const storage = ChatStorage.getInstance()
    const file = await GlobalStore.getInstance().app.vault.create(
      'sample.abchat',
      serializeChat({
        metadata: {
          type: 'abele-chat',
          title: 'Sample',
          created: '',
          agentId: agent.id,
          overrides: { toolModes: { mcp_one_part_echo: 'auto' } },
        },
        messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: 1 }],
        internalMessages: [],
      })
    )
    expect(file).toBeInstanceOf(TFile)
    const session = new ChatSession(ChatService.getInstance())
    await session.load(file!)
    expect(session.toolModes.value).toEqual({
      [mcpPermissionKey('a', 'part_echo')]: 'ask',
      [mcpPermissionKey('b', 'echo')]: 'ask',
    })
    expect(Notice.shown).toHaveLength(1)
    expect((await storage.loadChat(file!)).metadata?.overrides?.toolModes).toEqual(
      session.toolModes.value
    )
    Notice.shown.length = 0
    await session.load(file!)
    expect(Notice.shown).toEqual([])
  })
})
