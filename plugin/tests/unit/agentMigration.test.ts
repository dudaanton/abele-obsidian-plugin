import { describe, it, expect } from 'vitest'
import { migrateAgents } from '@/ai/agents/migration'
import { createAgent } from '@/ai/agents/types'
import { DEFAULT_AI_SETTINGS, EDIT_SELECTION_TOOL, type AiSettings } from '@/ai/types'

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

/**
 * The agents the legacy fold produced. The Comment agent is seeded beside them by a step of
 * its own, so counting it here would say the fold made an agent it did not make.
 */
const migrated = (ai: AiSettings) => ai.agents.filter((a) => a.id !== ai.commentAgentId)

describe('migrateAgents', () => {
  it('folds the global settings into one agent named Default', () => {
    const ai = legacySettings()

    migrateAgents(ai)

    expect(migrated(ai)).toHaveLength(1)
    const agent = migrated(ai)[0]
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

  it('keeps the interceptor id, so a chat already pointing at it still resolves', () => {
    // Chats saved before agents existed store the interceptor id in their metadata. Minting a
    // fresh one here would silently detach every such chat from its interceptor.
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

    expect(ai.agents.find((a) => a.id === 'i1')?.name).toBe('Reviewer')
  })

  it('does nothing when agents already exist, so it never overwrites real configuration', () => {
    const ai = legacySettings()
    migrateAgents(ai)
    const firstId = ai.agents[0].id
    ai.agents[0].name = 'Renamed by the user'

    migrateAgents(ai)

    expect(migrated(ai)).toHaveLength(1)
    expect(migrated(ai)[0].id).toBe(firstId)
    expect(migrated(ai)[0].name).toBe('Renamed by the user')
  })

  it('still produces a usable Default when nothing was ever configured', () => {
    const ai: AiSettings = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }

    migrateAgents(ai)

    expect(migrated(ai)).toHaveLength(1)
    expect(migrated(ai)[0].name).toBe('Default')
    expect(ai.defaultAgentId).toBe(migrated(ai)[0].id)
    // Falls back to the built-in prompt rather than leaving the agent mute.
    expect(migrated(ai)[0].prompts[0].value).toBe(DEFAULT_AI_SETTINGS.prompts.system)
  })
})

describe('the Comment agent', () => {
  it('is created on a fresh install and pointed at by the setting', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' } as AiSettings

    migrateAgents(ai)

    const comment = ai.agents.find((a) => a.id === ai.commentAgentId)
    expect(comment?.name).toBe('Comment')
    expect(comment?.utility).toBe(true)
    expect(comment?.fullVaultAccess).toBe(false)
    expect(comment?.skillsMode).toBe('all')
    expect(comment?.maxDelegateDepth).toBe(0)
  })

  it('lets it search and fetch without asking, and ask before rewriting the passage', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' } as AiSettings

    migrateAgents(ai)

    const comment = ai.agents.find((a) => a.id === ai.commentAgentId)
    expect(comment?.toolModes.web_search).toBe('auto')
    expect(comment?.toolModes.fetch).toBe('auto')
    expect(comment?.toolModes[EDIT_SELECTION_TOOL]).toBe('ask')
    // Every other write is core, and `confirm-all` is what makes those ask.
    expect(comment?.permissionMode).toBe('confirm-all')
  })

  it('tells the model it is answering in place, briefly', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' } as AiSettings

    migrateAgents(ai)

    const prompt = ai.agents.find((a) => a.id === ai.commentAgentId)?.prompts[0]?.value ?? ''
    expect(prompt).toContain('edit_selection')
    expect(prompt.length).toBeGreaterThan(100)
  })

  /** Settings are saved after migration, but not always before the next load. */
  it('is not created a second time', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' } as AiSettings
    migrateAgents(ai)
    const first = ai.commentAgentId

    migrateAgents(ai)

    expect(ai.commentAgentId).toBe(first)
    expect(ai.agents.filter((a) => a.name === 'Comment')).toHaveLength(1)
  })

  it('is added to a vault that already has agents but no comment agent', () => {
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [createAgent({ id: 'existing', name: 'Default' })],
      defaultAgentId: 'existing',
    } as AiSettings

    migrateAgents(ai)

    expect(ai.commentAgentId).toBeTruthy()
    expect(ai.agents).toHaveLength(2)
  })
})
