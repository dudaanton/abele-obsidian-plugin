/**
 * `remember` writes to the memory of the agent that called it, and to no other.
 *
 * Two chats on two agents run side by side in the same plugin, so "the current agent" is not a
 * global — each chat hands the tool its own agent, and a delegated run or a script hands it the
 * agent doing the work.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { REMEMBER_TOOL, FORGET_TOOL, MEMORY_ITEM_MAX_LENGTH } from '@/ai/agents/memory'
import { createAgentTools, getToolRegistry } from '@/ai/tools'
import type { AgentTool } from '@/ai/client'
import { useVault } from '../helpers/testEnv'

let saved = 0

function sessionOn(agentId: string): ChatSession {
  const session = new ChatSession(ChatService.getInstance(), undefined, { kind: 'chat' })
  session.agentId.value = agentId
  return session
}

function toolOf(session: ChatSession, name = REMEMBER_TOOL): AgentTool {
  const tools = (session as unknown as { getTools: () => AgentTool[] }).getTools()
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`no ${name} tool`)
  return tool
}

const resultText = (result: { content: { type: string; text?: string }[] }) =>
  result.content.map((c) => c.text ?? '').join('')

const texts = (id: string) => (AgentRegistry.getInstance().get(id)?.memory ?? []).map((m) => m.text)

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  const config = AbeleConfig.getInstance()
  config.ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
  saved = 0
  config.saveSettings = vi.fn(async () => {
    saved++
  })
})

describe('remember', () => {
  it('adds to the memory of the chat agent, and to no other agent', async () => {
    const registry = AgentRegistry.getInstance()
    const writer = registry.create({ name: 'Writer', toolModes: { remember: 'auto' } })
    const coder = registry.create({ name: 'Coder', toolModes: { remember: 'auto' } })

    await toolOf(sessionOn(writer.id)).execute('c1', { text: 'Answer in Russian' })
    await toolOf(sessionOn(coder.id)).execute('c2', { text: 'Use tabs' })

    expect(texts(writer.id)).toEqual(['Answer in Russian'])
    expect(texts(coder.id)).toEqual(['Use tabs'])
    expect(saved).toBe(2)
  })

  it('refuses a long item and tells the model to shorten it', async () => {
    const registry = AgentRegistry.getInstance()
    const writer = registry.create({ name: 'Writer', toolModes: { remember: 'auto' } })

    await expect(
      toolOf(sessionOn(writer.id)).execute('c1', { text: 'x'.repeat(MEMORY_ITEM_MAX_LENGTH + 5) })
    ).rejects.toThrow(/shorten/i)
    expect(texts(writer.id)).toEqual([])
    expect(saved).toBe(0)
  })

  it('is not offered to an agent that has it switched off', () => {
    const registry = AgentRegistry.getInstance()
    const quiet = registry.create({ name: 'Quiet', toolModes: { remember: 'off' } })

    const tools = (sessionOn(quiet.id) as unknown as { getTools: () => AgentTool[] }).getTools()

    expect(tools.map((t) => t.name)).not.toContain(REMEMBER_TOOL)
  })

  it('runs without asking under its default mode', () => {
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({ name: 'Default' })

    expect(agent.toolModes[REMEMBER_TOOL]).toBe('auto')
    expect(sessionOn(agent.id).needsApproval(REMEMBER_TOOL, { text: 'x' })).toBe(false)
  })

  it('writes to the agent a script bound it to', async () => {
    const registry = AgentRegistry.getInstance()
    const target = registry.create({ name: 'Target' })
    const other = registry.create({ name: 'Other' })
    registry.setDefault(other.id)

    const tool = createAgentTools({ agentId: target.id }).find((t) => t.name === REMEMBER_TOOL)!
    await tool.execute('c1', { text: 'Reports go to Reports/' })

    expect(texts(target.id)).toEqual(['Reports go to Reports/'])
    expect(texts(other.id)).toEqual([])
  })

  it('refuses rather than guess when it knows of no agent', async () => {
    const tool = createAgentTools().find((t) => t.name === REMEMBER_TOOL)!

    await expect(tool.execute('c1', { text: 'Something' })).rejects.toThrow()
  })

  it('is listed in the agent editor under its own label', () => {
    expect(getToolRegistry().find((t) => t.name === REMEMBER_TOOL)).toMatchObject({
      label: 'Remember',
    })
  })
})

describe('changing and forgetting', () => {
  it('remembers, changes and forgets an item on the chat agent, saving each time', async () => {
    const registry = AgentRegistry.getInstance()
    const writer = registry.create({ name: 'Writer' })
    const session = sessionOn(writer.id)

    await toolOf(session).execute('c1', { text: 'The cat is called Bruno' })
    await toolOf(session).execute('c2', { text: 'Answer in Russian' })
    const changed = await toolOf(session).execute('c3', {
      text: 'The cat is called Felix',
      replace: 'The cat is called Bruno',
    })
    expect(resultText(changed)).toContain('The cat is called Felix')
    expect(texts(writer.id)).toEqual(['The cat is called Felix', 'Answer in Russian'])

    const forgotten = await toolOf(session, FORGET_TOOL).execute('c4', { text: 'cat' })
    expect(resultText(forgotten)).toContain('The cat is called Felix')
    expect(texts(writer.id)).toEqual(['Answer in Russian'])
    expect(saved).toBe(4)
  })

  it('touches only the memory of the agent that calls it', async () => {
    const registry = AgentRegistry.getInstance()
    const writer = registry.create({ name: 'Writer' })
    const coder = registry.create({ name: 'Coder' })
    await toolOf(sessionOn(writer.id)).execute('c1', { text: 'Use tabs' })
    await toolOf(sessionOn(coder.id)).execute('c2', { text: 'Use tabs' })

    await toolOf(sessionOn(coder.id), FORGET_TOOL).execute('c3', { text: 'Use tabs' })

    expect(texts(writer.id)).toEqual(['Use tabs'])
    expect(texts(coder.id)).toEqual([])
  })

  it('tells the model what is remembered when the line it named is not there, and saves nothing', async () => {
    const registry = AgentRegistry.getInstance()
    const writer = registry.create({ name: 'Writer' })
    await toolOf(sessionOn(writer.id)).execute('c1', { text: 'Answer in Russian' })
    saved = 0

    await expect(
      toolOf(sessionOn(writer.id), FORGET_TOOL).execute('c2', { text: 'dog' })
    ).rejects.toThrow(/Answer in Russian/)
    await expect(
      toolOf(sessionOn(writer.id)).execute('c3', { text: 'The dog is Rex', replace: 'dog' })
    ).rejects.toThrow(/Answer in Russian/)
    expect(saved).toBe(0)
  })

  it('is on and runs without asking under its default mode, like remember', () => {
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({ name: 'Default' })

    expect(agent.toolModes[FORGET_TOOL]).toBe(agent.toolModes[REMEMBER_TOOL])
    expect(sessionOn(agent.id).needsApproval(FORGET_TOOL, { text: 'x' })).toBe(false)
  })

  it('is not offered to an agent that has it switched off', () => {
    const registry = AgentRegistry.getInstance()
    const quiet = registry.create({ name: 'Quiet', toolModes: { forget: 'off' } })

    const tools = (sessionOn(quiet.id) as unknown as { getTools: () => AgentTool[] }).getTools()

    expect(tools.map((t) => t.name)).not.toContain(FORGET_TOOL)
  })

  it('forgets on the agent a script bound it to', async () => {
    const registry = AgentRegistry.getInstance()
    const target = registry.create({ name: 'Target' })
    const tools = createAgentTools({ agentId: target.id })
    await tools.find((t) => t.name === REMEMBER_TOOL)!.execute('c1', { text: 'Reports go to Reports/' })

    await tools.find((t) => t.name === FORGET_TOOL)!.execute('c2', { text: 'Reports' })

    expect(texts(target.id)).toEqual([])
  })

  it('refuses rather than guess when it knows of no agent', async () => {
    const tool = createAgentTools().find((t) => t.name === FORGET_TOOL)!

    await expect(tool.execute('c1', { text: 'Something' })).rejects.toThrow()
  })

  it('is listed in the agent editor under its own label', () => {
    expect(getToolRegistry().find((t) => t.name === FORGET_TOOL)).toMatchObject({
      label: 'Forget',
      category: 'AI',
    })
  })
})
