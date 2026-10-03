import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { parseChat, serializeChat, type ChatSnapshot } from '@/ai/ChatLog'
import type { AgentTool } from '@/ai/client'
import type { TFile } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

const tools = (session: ChatSession) =>
  (session as unknown as { getTools(): AgentTool[] }).getTools()
const names = (session: ChatSession) => tools(session).map((t) => t.name)
const reveal = async (session: ChatSession, group: string) => {
  const tool = tools(session).find((t) => t.name === 'enable_tools')
  expect(tool).toBeDefined()
  await tool!.execute('sample-call', { group })
}
const file = { path: 'AI/Chats/sample.abchat', basename: 'sample' } as TFile
let session: ChatSession
let saved: ChatSnapshot

destroyChatsAfterEach()
beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Sample agent',
    toolDiscovery: 'by-group',
    toolModes: { geocode: 'ask', route: 'off', chart_docs: 'auto' },
  })
  registry.setDefault(agent.id)
  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(ChatStorage.getInstance(), 'saveChat').mockImplementation(async (snapshot) => {
    saved = snapshot
    return file
  })
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
})

describe('tools revealed by group', () => {
  it('starts with core tools and advertises only groups with an enabled optional tool', () => {
    expect(names(session)).toContain('read')
    expect(names(session)).toContain('query_docs')
    expect(names(session)).not.toContain('geocode')
    expect(names(session)).not.toContain('chart_docs')
    const description = tools(session).find((t) => t.name === 'enable_tools')?.description
    expect(description).toContain('Maps:')
    expect(description).toContain('Docs:')
    expect(description).not.toContain('Books:')
    expect(description).not.toContain('Canvas:')
  })

  it('offers no discovery tool when every optional tool is Off', () => {
    session.toolModes.value = {}
    expect(names(session)).toContain('read')
    expect(names(session)).not.toContain('enable_tools')
    expect(names(session)).not.toContain('geocode')
  })

  it('reveals only enabled tools, leaves Ask intact, and rejects an unavailable group', async () => {
    await reveal(session, 'Maps')
    expect(names(session)).toContain('geocode')
    expect(names(session)).not.toContain('route')
    expect(names(session)).not.toContain('chart_docs')
    expect(session.needsApproval('geocode')).toBe(true)
    expect(session.needsApproval('enable_tools')).toBe(false)
    await expect(reveal(session, 'Books')).rejects.toThrow('Unknown or unavailable tool group')
    session.toolModes.value = { ...session.toolModes.value, geocode: 'off' }
    expect(names(session)).not.toContain('geocode')
  })

  it('only appends groups, with an unchanged discovery description across ordinary turns', async () => {
    const start = tools(session)
    await reveal(session, 'Docs')
    const middle = tools(session)
    expect(middle.slice(0, start.length)).toEqual(
      start.map((t) =>
        expect.objectContaining({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })
      )
    )
    await reveal(session, 'Maps')
    const end = tools(session)
    expect(end.map((t) => t.name).slice(0, middle.length)).toEqual(middle.map((t) => t.name))
    await reveal(session, 'Docs')
    expect(names(session)).toEqual(end.map((t) => t.name))
  })

  it('persists reveal order through the chat file and clears it for a new conversation', async () => {
    ;(session as unknown as { allChatMessages: ChatMessage[] }).allChatMessages = [
      { id: 'sample-message', role: 'user', content: 'Show a chart', timestamp: 1 },
    ]
    await reveal(session, 'Docs')
    await reveal(session, 'Maps')
    await session.save()
    const parsed = parseChat(serializeChat(saved))
    vi.spyOn(ChatStorage.getInstance(), 'loadChat').mockResolvedValue(parsed)
    const reopened = new ChatSession(ChatService.getInstance())
    await reopened.load(file)
    expect(names(reopened)).toEqual(names(session))
    await reopened.reset()
    expect(names(reopened)).not.toContain('geocode')
    expect(names(reopened)).not.toContain('chart_docs')
    reopened.destroy()
  })

  it('keeps the original list unchanged when discovery is off, including old agents', async () => {
    const registry = AgentRegistry.getInstance()
    registry.update(session.agentId.value, { toolDiscovery: 'all' })
    const original = names(session)
    expect(original).toContain('geocode')
    expect(original).toContain('chart_docs')
    expect(original).not.toContain('enable_tools')
    registry.update(session.agentId.value, { toolDiscovery: undefined })
    expect(names(session)).toEqual(original)
  })
})
