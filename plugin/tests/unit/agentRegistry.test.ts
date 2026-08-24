import { describe, it, expect, beforeEach } from 'vitest'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { createAgent, type AgentDefinition } from '@/ai/agents/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

function seed(...agents: AgentDefinition[]) {
  const config = AbeleConfig.getInstance()
  config.ai = { ...DEFAULT_AI_SETTINGS, agents, defaultAgentId: agents[0]?.id ?? '' }
  return config
}

describe('AgentRegistry lookup', () => {
  beforeEach(() => {
    seed(createAgent({ name: 'Default' }))
  })

  it('finds an agent by id and by name', () => {
    const agent = createAgent({ name: 'Researcher' })
    seed(createAgent({ name: 'Default' }), agent)
    const registry = AgentRegistry.getInstance()

    expect(registry.get(agent.id)?.name).toBe('Researcher')
    expect(registry.getByName('Researcher')?.id).toBe(agent.id)
    expect(registry.get('nope')).toBeNull()
    expect(registry.getByName('nope')).toBeNull()
  })

  it('matches a name regardless of case, because scripts pass names typed by hand', () => {
    const agent = createAgent({ name: 'Researcher' })
    seed(agent)

    expect(AgentRegistry.getInstance().getByName('researcher')?.id).toBe(agent.id)
  })

  it('resolves either an id or a name through one entry point', () => {
    const agent = createAgent({ name: 'Researcher' })
    seed(agent)
    const registry = AgentRegistry.getInstance()

    expect(registry.resolve(agent.id)?.id).toBe(agent.id)
    expect(registry.resolve('Researcher')?.id).toBe(agent.id)
    expect(registry.resolve('')).toBeNull()
  })

  it('hides utility agents from the list unless they are asked for', () => {
    seed(createAgent({ name: 'Default' }), createAgent({ name: 'Titler', utility: true }))
    const registry = AgentRegistry.getInstance()

    expect(registry.list().map((a) => a.name)).toEqual(['Default'])
    expect(registry.list({ includeUtility: true }).map((a) => a.name)).toEqual([
      'Default',
      'Titler',
    ])
  })

  it('returns the configured default agent, falling back to the first when the id is stale', () => {
    const first = createAgent({ name: 'Default' })
    const config = seed(first, createAgent({ name: 'Other' }))
    const registry = AgentRegistry.getInstance()

    expect(registry.defaultAgent()?.id).toBe(first.id)

    config.ai.defaultAgentId = 'deleted-long-ago'
    expect(registry.defaultAgent()?.id).toBe(first.id)
  })
})

describe('AgentRegistry mutation', () => {
  beforeEach(() => {
    seed(createAgent({ name: 'Default' }))
  })

  it('creates an agent and appends it to settings', () => {
    const registry = AgentRegistry.getInstance()

    const created = registry.create({ name: 'Janitor' })

    expect(AbeleConfig.getInstance().ai.agents.map((a) => a.name)).toEqual(['Default', 'Janitor'])
    expect(registry.get(created.id)?.name).toBe('Janitor')
  })

  it('patches only the named fields and leaves the rest alone', () => {
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({ name: 'Janitor', modelId: 'gpt-4o' })

    registry.update(agent.id, { name: 'Tidier' })

    expect(registry.get(agent.id)?.name).toBe('Tidier')
    expect(registry.get(agent.id)?.modelId).toBe('gpt-4o')
  })

  it('mutates the stored object in place so live chats reading it see the change', () => {
    const registry = AgentRegistry.getInstance()
    const stored = registry.get(AbeleConfig.getInstance().ai.agents[0].id)!

    registry.update(stored.id, { name: 'Renamed' })

    // The very object a session is holding must be the one that changed — the whole point of
    // live resolution is that nobody has to be told an agent was edited.
    expect(stored.name).toBe('Renamed')
  })

  it('duplicates an agent with a new id and a distinguishable name', () => {
    const registry = AgentRegistry.getInstance()
    const source = registry.create({ name: 'Janitor', modelId: 'gpt-4o', utility: true })

    const copy = registry.duplicate(source.id)!

    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toBe('Janitor (copy)')
    expect(copy.modelId).toBe('gpt-4o')
    expect(copy.utility).toBe(true)
    // Collections are copied, not shared.
    copy.skills.push('x')
    expect(source.skills).toEqual([])
  })

  it('removes an agent and hands the default over when the default was removed', () => {
    const registry = AgentRegistry.getInstance()
    const first = AbeleConfig.getInstance().ai.agents[0]
    const second = registry.create({ name: 'Other' })
    registry.setDefault(first.id)

    expect(registry.remove(first.id)).toBe(true)

    expect(registry.get(first.id)).toBeNull()
    expect(AbeleConfig.getInstance().ai.defaultAgentId).toBe(second.id)
  })

  it('refuses to remove the last agent, so there is always something to chat with', () => {
    const registry = AgentRegistry.getInstance()
    const only = AbeleConfig.getInstance().ai.agents[0]

    expect(registry.remove(only.id)).toBe(false)
    expect(AbeleConfig.getInstance().ai.agents).toHaveLength(1)
  })
})
