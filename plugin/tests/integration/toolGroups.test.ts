import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { boundRunToParent } from '@/ai/DelegateRun'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { parseChat, serializeChat, type ChatSnapshot } from '@/ai/ChatLog'
import { EMPTY_USAGE, type AgentTool, type AssistantMessage } from '@/ai/client'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import { estimateTokens } from '@/ai/tokens'
import type { TFile } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

const tools = (session: ChatSession) =>
  (session as unknown as { getTools(): AgentTool[] }).getTools()
const names = (session: ChatSession) => tools(session).map((t) => t.name)
const file = { path: 'AI/Chats/sample.abchat', basename: 'sample' } as TFile
let session: ChatSession
let saved: ChatSnapshot

/** A fake model that answers each request with the next of these assistant contents. */
const script = (...turns: AssistantMessage['content'][]) => {
  const offered: string[][] = []
  vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
    async function* (_m, _s, _history, sent) {
      offered.push(sent.map((t) => t.name))
      const content = turns[offered.length - 1] ?? [{ type: 'text', text: 'Sample answer' }]
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content,
          model: 'sample',
          usage: EMPTY_USAGE,
          stopReason: content.some((c) => c.type === 'toolCall') ? 'toolUse' : 'stop',
          timestamp: 1,
        },
      }
    }
  )
  return offered
}
const call = (id: string, name: string): AssistantMessage['content'] => [
  { type: 'toolCall', id, name, arguments: {} },
]

destroyChatsAfterEach()
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
    name: 'Sample agent',
    providerId: 'sample-provider',
    modelId: 'sample',
    toolModes: { geocode: 'ask', route: 'off', chart_docs: 'auto' },
  })
  registry.setDefault(agent.id)
  const chats = ChatService.getInstance()
  vi.spyOn(chats, 'getSystemPrompt').mockResolvedValue('Synthetic prompt.')
  vi.spyOn(chats, 'saveTabs').mockImplementation(() => {})
  vi.spyOn(ChatStorage.getInstance(), 'saveChat').mockImplementation(async (snapshot) => {
    saved = snapshot
    return file
  })
  session = new ChatSession(chats)
  quiet(session)
})
afterEach(() => vi.restoreAllMocks())

function quiet(s: ChatSession) {
  const summarizer = (s as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  for (const name of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded'])
    vi.spyOn(summarizer, name).mockResolvedValue(undefined)
}

describe('tools offered by section', () => {
  it('is how a new agent starts: core tools and one section tool per allowed group', () => {
    expect(names(session)).toContain('read')
    expect(names(session)).toContain('query_docs')
    expect(names(session)).toContain('open_maps')
    expect(names(session)).toContain('open_docs')
    expect(names(session)).toContain('open_templates')
    expect(names(session)).not.toContain('geocode')
    expect(names(session)).not.toContain('chart_docs')
    expect(names(session)).not.toContain('list_templates')
    expect(names(session)).not.toContain('open_github')
    expect(names(session)).not.toContain('enable_tools')
  })

  it('offers only the always-allowed sections when every optional tool is Off', () => {
    session.toolModes.value = {}
    expect(names(session).filter((n) => n.startsWith('open_'))).toEqual(['open_templates'])
    expect(names(session)).not.toContain('geocode')
  })

  it('opens a section within the turn, leaves Ask intact and never asks to open', async () => {
    const offered = script(call('c1', 'open_maps'), call('c2', 'route'))
    await session.sendMessage('Where is the sample place?')
    expect(offered[0]).not.toContain('geocode')
    expect(offered[1]).toContain('geocode')
    // Off stays out even with the section open.
    expect(offered[1]).not.toContain('route')
    expect(session.needsApproval('open_maps')).toBe(false)
    expect(session.needsApproval('geocode')).toBe(true)
    const opened = session.messages.value.find((m) => m.toolName === 'open_maps')
    expect(opened?.toolResult).toContain('geocode (asks the person first)')
    const refused = session.messages.value.find((m) => m.toolName === 'route')
    expect(refused?.toolResult ?? refused?.content).toContain('not found')
  })

  it('tells the agent to open a section before using its tools', async () => {
    script(call('c1', 'chart_docs'))
    await session.sendMessage('Explain sample charts')
    const refused = session.messages.value.find((m) => m.toolName === 'chart_docs')
    expect(refused?.toolResult ?? refused?.content).toContain('Call open_docs first')
  })

  it('only appends when a section opens, so the cached prefix stays', async () => {
    const start = tools(session)
    script(call('c1', 'open_docs'), call('c2', 'open_maps'))
    await session.sendMessage('Open two sample sections')
    const end = tools(session)
    expect(end.slice(0, start.length).map((t) => [t.name, t.description])).toEqual(
      start.map((t) => [t.name, t.description])
    )
    expect(end.slice(start.length).map((t) => t.name)).toEqual(['chart_docs', 'geocode'])
  })

  it('belongs to the branch: rewinding past the open call closes it, returning reopens it', async () => {
    script(call('c1', 'open_docs'))
    await session.sendMessage('Open the sample docs')
    const leaf = session.messages.value.at(-1)!.id
    expect(names(session)).toContain('chart_docs')
    const question = session.messages.value.find((m) => m.role === 'user')!
    session.createBranch(question.id)
    expect(names(session)).not.toContain('chart_docs')
    session.switchBranch(leaf)
    expect(names(session)).toContain('chart_docs')
  })

  it('keeps open sections through the chat file and clears them for a new conversation', async () => {
    script(call('c1', 'open_docs'), call('c2', 'open_maps'))
    await session.sendMessage('Open two sample sections')
    await session.save()
    vi.spyOn(ChatStorage.getInstance(), 'loadChat').mockResolvedValue(
      parseChat(serializeChat(saved))
    )
    const reopened = new ChatSession(ChatService.getInstance())
    await reopened.load(file)
    expect(names(reopened)).toEqual(names(session))
    expect(names(reopened)).toContain('chart_docs')
    expect(names(reopened)).toContain('geocode')
    await reopened.reset()
    expect(names(reopened)).not.toContain('chart_docs')
    expect(names(reopened)).not.toContain('geocode')
    reopened.destroy()
  })

  it('opens the groups a chat revealed before sections existed', async () => {
    const messages: ChatMessage[] = [{ id: 'm1', role: 'user', content: 'Sample', timestamp: 1 }]
    vi.spyOn(ChatStorage.getInstance(), 'loadChat').mockResolvedValue({
      metadata: {
        type: 'abele-chat',
        agentId: session.agentId.value,
        revealedToolGroups: ['Maps'],
        activeLeafId: 'm1',
      },
      messages,
      internalMessages: [],
    } as unknown as Awaited<ReturnType<ChatStorage['loadChat']>>)
    const reopened = new ChatSession(ChatService.getInstance())
    await reopened.load(file)
    expect(names(reopened)).toContain('geocode')
    reopened.destroy()
  })

  it('opens files at Read, commands at Run, and node instructions with Run plus Delegate', () => {
    session.overrides.value = {
      ...session.overrides.value,
      nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'read' }],
    }
    const offered = names(session)
    expect(offered).toContain('open_nodes')
    expect(offered).toContain('node_ls')
    const actions = [
      'node_delegate',
      'node_delegations',
      'node_delegation_send',
      'node_delegation_status',
      'node_delegation_cancel',
      'node_command_run',
      'node_command_status',
      'node_command_cancel',
      'node_git_integrate',
    ]
    for (const tool of actions) expect(offered).not.toContain(tool)
    // Listing, status and cancel need no prompt; new instructions keep the parent mode.
    session.toolModes.value = {
      ...session.toolModes.value,
      node_delegate: 'ask',
      node_command_run: 'ask',
      node_git_integrate: 'ask',
    }
    expect(names(session)).not.toContain('node_delegate')
    session.overrides.value.nodeScope![0].access = 'run'
    expect(names(session)).toContain('node_command_run')
    expect(names(session)).not.toContain('node_delegate')
    expect(names(session)).not.toContain('node_delegation_send')
    session.toolModes.value = { ...session.toolModes.value, delegate: 'ask' }
    const enabled = names(session)
    for (const tool of actions) expect(enabled).toContain(tool)
    expect(offered.indexOf('node_ls')).toBeGreaterThan(offered.indexOf('open_nodes'))
    expect(session.getToolMode('node_command_run')).toBe('auto')
    expect(session.getToolMode('node_command_status')).toBe('auto')
    expect(session.getToolMode('node_command_cancel')).toBe('ask')
    for (const tool of ['node_delegations', 'node_delegation_status'])
      expect(session.getToolMode(tool)).toBe('auto')
    expect(session.getToolMode('node_delegation_send')).toBe('ask')
    expect(session.getToolMode('node_git_commit')).toBe('ask')
    // Folder levels replace the former parent/follower tool switches.
    session.toolModes.value = {
      ...session.toolModes.value,
      node_command_run: 'off',
      node_command_status: 'auto',
    }
    expect(session.getToolMode('node_command_status')).toBe('auto')
    expect(names(session)).toContain('node_command_cancel')
    expect(session.getToolMode('node_delegation_cancel')).toBe('ask')
    session.overrides.value.nodeScope = []
    expect(names(session)).not.toContain('node_command_cancel')
    session.overrides.value.nodeScope = [{ kind: 'node', node_id: 'sample-node', access: 'run' }]
    expect(names(session)).toContain('node_delegation_status')
  })

  it('withholds delegation and manager tools without node scope even when their modes are enabled', () => {
    AgentRegistry.getInstance().update(session.agentId.value, { toolDiscovery: 'all-at-once' })
    session.toolModes.value = {
      ...session.toolModes.value,
      delegate: 'auto',
      node_delegate: 'auto',
      node_command_run: 'auto',
    }
    expect(names(session)).not.toContain('node_delegate')
    expect(names(session)).not.toContain('node_command_run')
  })

  it('starts a delegated run with the sections its parent had open', async () => {
    script(call('c1', 'open_docs'))
    await session.sendMessage('Open the sample docs')
    const run = new ChatSession(ChatService.getInstance(), undefined, {
      kind: 'run',
      agentId: session.agentId.value,
      depth: 1,
      root: session,
    })
    boundRunToParent(run, session)
    expect(names(run)).toContain('chart_docs')
    expect(names(run)).not.toContain('geocode')
    run.destroy()
  })

  it('has an agent’s Always open sections open from the first request', () => {
    AgentRegistry.getInstance().update(session.agentId.value, {
      toolSectionOpening: { maps: 'always' },
    })
    expect(names(session)).toContain('geocode')
    expect(names(session)).not.toContain('chart_docs')
  })

  it('tells the agent what a section is for in the agent’s own words when it has some', () => {
    AgentRegistry.getInstance().update(session.agentId.value, {
      toolSectionDescriptions: { maps: 'Sample own words about maps.' },
    })
    const open = tools(session).find((t) => t.name === 'open_maps')!
    expect(open.description).toContain('Sample own words about maps.')
  })

  it('never offers an old node name, but answers an agent that still calls one', async () => {
    AgentRegistry.getInstance().update(session.agentId.value, {
      toolSectionOpening: { nodes: 'always' },
    })
    session.overrides.value.nodeScope = [{ kind: 'node', node_id: 'sample-node', access: 'read' }]
    session.toolModes.value = { ...session.toolModes.value, node_read: 'auto', node_file: 'auto' }
    expect(names(session)).toContain('node_read')
    expect(names(session)).not.toContain('node_file')
    script(call('c1', 'node_file'))
    await session.sendMessage('Read the sample file the old way')
    const result = session.allMessages.value.find((m) => m.toolName === 'node_file')?.toolResult
    expect(result).toBeDefined()
    expect(result).not.toMatch(/not found|not open in this chat/)
  })

  it('offers no old node name when every tool is offered at once either', () => {
    AgentRegistry.getInstance().update(session.agentId.value, { toolDiscovery: 'all-at-once' })
    session.overrides.value.nodeScope = [{ kind: 'node', node_id: 'sample-node', access: 'read' }]
    session.toolModes.value = { ...session.toolModes.value, node_read: 'auto', node_file: 'auto' }
    expect(names(session)).toContain('node_read')
    expect(names(session)).not.toContain('node_file')
  })

  it('keeps the whole list in All at once mode', () => {
    AgentRegistry.getInstance().update(session.agentId.value, { toolDiscovery: 'all-at-once' })
    const all = names(session)
    expect(all).toContain('geocode')
    expect(all).toContain('chart_docs')
    expect(all).toContain('list_templates')
    expect(all.some((n) => n.startsWith('open_'))).toBe(false)
  })

  it('treats older saved modes as sections', () => {
    for (const toolDiscovery of ['all', 'by-group', undefined] as const) {
      AgentRegistry.getInstance().update(session.agentId.value, { toolDiscovery })
      expect(names(session)).toContain('open_maps')
    }
  })

  it('sends a default agent far fewer tool tokens per request by section', () => {
    const registry = AgentRegistry.getInstance()
    // A new agent exactly as the settings make it.
    const fresh = registry.create({
      name: 'Sample default',
      providerId: 'sample-provider',
      modelId: 'sample',
    })
    const size = (s: ChatSession) => {
      const sent = tools(s).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))
      return { count: sent.length, tokens: estimateTokens(JSON.stringify(sent)) }
    }
    const chat = new ChatSession(ChatService.getInstance(), undefined, { agentId: fresh.id })
    const sections = size(chat)
    registry.update(fresh.id, { toolDiscovery: 'all-at-once' })
    const all = size(chat)
    chat.overrides.value = { nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'edit' }] }
    const allNode = size(chat)
    registry.update(fresh.id, { toolDiscovery: 'sections' })
    const sectionsNode = size(chat)
    console.log(
      `default agent tools per request — all at once: ${all.count} tools, ~${all.tokens} tokens; ` +
        `by section: ${sections.count} tools, ~${sections.tokens} tokens; with node scope — ` +
        `all at once: ${allNode.count}, ~${allNode.tokens}; by section: ${sectionsNode.count}, ~${sectionsNode.tokens}`
    )
    expect(sections.tokens).toBeLessThan(all.tokens / 2)
    expect(sections.count).toBeLessThan(40)
    chat.destroy()
  })
})
