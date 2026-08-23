import { describe, it, expect } from 'vitest'
import { migrateAgents } from '@/ai/agents/migration'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'

/** A settings object shaped like one saved by the pre-agent plugin. */
function legacySettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    activeProviderId: 'openai',
    activeModelId: 'gpt-4o',
    permissionMode: 'allow-edit',
    toolModes: { web_search: 'auto', fetch: 'ask' },
    defaultScope: [{ type: 'folder', path: 'Notes' }],
    defaultFullVaultAccess: false,
    prompts: { ...DEFAULT_AI_SETTINGS.prompts, system: 'You are helpful.' },
    ...overrides,
  }
}

describe('migrateAgents', () => {
  it('folds the global settings into one agent named Default', () => {
    const ai = legacySettings()

    migrateAgents(ai)

    expect(ai.agents).toHaveLength(1)
    const agent = ai.agents[0]
    expect(agent.name).toBe('Default')
    expect(agent.utility).toBe(false)
    expect(agent.providerId).toBe('openai')
    expect(agent.modelId).toBe('gpt-4o')
    expect(agent.permissionMode).toBe('allow-edit')
    expect(agent.toolModes).toEqual({ web_search: 'auto', fetch: 'ask' })
    expect(agent.scope).toEqual([{ type: 'folder', path: 'Notes' }])
    expect(agent.prompts).toEqual([{ type: 'text', value: 'You are helpful.' }])
    expect(ai.defaultAgentId).toBe(agent.id)
  })

  it('carries a note-backed system prompt across as a note block', () => {
    const ai = legacySettings({
      systemPromptFromNote: true,
      systemPromptNotePath: 'Prompts/Base.md',
    })

    migrateAgents(ai)

    expect(ai.agents[0].prompts).toEqual([{ type: 'note', value: 'Prompts/Base.md' }])
  })

  it('ignores the note path when the note toggle is off', () => {
    const ai = legacySettings({
      systemPromptFromNote: false,
      systemPromptNotePath: 'Prompts/Base.md',
    })

    migrateAgents(ai)

    expect(ai.agents[0].prompts).toEqual([{ type: 'text', value: 'You are helpful.' }])
  })

  it('turns each interceptor into a utility agent that keeps its model and prompt', () => {
    const ai = legacySettings({
      interceptors: [
        {
          id: 'i1',
          name: 'Reviewer',
          systemPrompt: 'Review this.',
          modelId: 'gpt-4o-mini',
          contextDepth: 3,
        },
      ],
    })

    migrateAgents(ai)

    const reviewer = ai.agents.find((a) => a.name === 'Reviewer')
    expect(reviewer).toBeDefined()
    expect(reviewer!.utility).toBe(true)
    expect(reviewer!.modelId).toBe('gpt-4o-mini')
    expect(reviewer!.prompts).toEqual([{ type: 'text', value: 'Review this.' }])
    // contextDepth describes a use, not the agent, so it is not carried onto the entity.
    expect(reviewer as unknown as Record<string, unknown>).not.toHaveProperty('contextDepth')
    // The Default agent is still the default, not the interceptor.
    expect(ai.defaultAgentId).toBe(ai.agents.find((a) => a.name === 'Default')!.id)
  })

  it('does nothing when agents already exist, so it never overwrites real configuration', () => {
    const ai = legacySettings()
    migrateAgents(ai)
    const firstId = ai.agents[0].id
    ai.agents[0].name = 'Renamed by the user'

    migrateAgents(ai)

    expect(ai.agents).toHaveLength(1)
    expect(ai.agents[0].id).toBe(firstId)
    expect(ai.agents[0].name).toBe('Renamed by the user')
  })

  it('still produces a usable Default when nothing was ever configured', () => {
    const ai: AiSettings = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }

    migrateAgents(ai)

    expect(ai.agents).toHaveLength(1)
    expect(ai.agents[0].name).toBe('Default')
    expect(ai.defaultAgentId).toBe(ai.agents[0].id)
    // Falls back to the built-in prompt rather than leaving the agent mute.
    expect(ai.agents[0].prompts[0].value).toBe(DEFAULT_AI_SETTINGS.prompts.system)
  })
})
