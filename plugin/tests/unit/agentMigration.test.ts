import { describe, it, expect } from 'vitest'
import { migrateAgents } from '@/ai/agents/migration'
import { createAgent } from '@/ai/agents/types'
import {
  DEFAULT_AI_SETTINGS,
  EDIT_SELECTION_TOOL,
  GITHUB_TOOLS,
  GITHUB_TOOL_MODES,
  MAP_TOOL_MODES,
  type AiSettings,
} from '@/ai/types'

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
    // Plus the map tools, which every agent is handed — see the block at the bottom.
    expect(agent.toolModes).toMatchObject({ web_search: 'auto', fetch: 'ask' })
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

  /**
   * Migration only mutates memory, so `AbeleConfig` has to be told when to write. Without
   * this every launch on a vault that already has agents mints another Comment agent with a
   * new id, and every comment file written before then points at one that is gone.
   */
  it('reports that it changed the settings, so they get saved', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' } as AiSettings

    expect(migrateAgents(ai)).toBe(true)
  })

  it('reports no change on the next run, so nothing is written for nothing', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' } as AiSettings
    migrateAgents(ai)

    expect(migrateAgents(ai)).toBe(false)
  })

  it('leaves settings that already name a comment agent alone', () => {
    // Both carry the map tools already, so the only thing that could report a change here
    // is the comment agent being seeded again — which is what the test is about.
    const modes = { ...MAP_TOOL_MODES, ...GITHUB_TOOL_MODES, remember: 'auto' as const }
    const existing = createAgent({ id: 'comment-1', name: 'My commenter', toolModes: modes })
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [createAgent({ id: 'existing', name: 'Default', toolModes: { ...modes } }), existing],
      defaultAgentId: 'existing',
      commentAgentId: 'comment-1',
    } as AiSettings

    const changed = migrateAgents(ai)

    expect(changed).toBe(false)
    expect(ai.commentAgentId).toBe('comment-1')
    expect(ai.agents).toHaveLength(2)
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

/**
 * The map tools arrived in 1.25 and need no key, so an agent made before them should not
 * have to be edited before it can answer «where is this».
 */
describe('the map tools', () => {
  it('are handed to agents that existed before them', () => {
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [createAgent({ id: 'existing', name: 'Default', toolModes: { fetch: 'ask' } })],
      defaultAgentId: 'existing',
    } as AiSettings

    const changed = migrateAgents(ai)

    expect(changed).toBe(true)
    expect(ai.agents[0].toolModes).toMatchObject({
      fetch: 'ask',
      geocode: 'auto',
      places: 'auto',
      route: 'auto',
    })
  })

  it('stay off where someone turned them off', () => {
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [createAgent({ id: 'existing', name: 'Default', toolModes: { geocode: 'off' } })],
      defaultAgentId: 'existing',
    } as AiSettings

    migrateAgents(ai)

    expect(ai.agents[0].toolModes.geocode).toBe('off')
    expect(ai.agents[0].toolModes.route).toBe('auto')
  })

  it('leaves nothing to change on the second run', () => {
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [createAgent({ id: 'existing', name: 'Default' })],
      defaultAgentId: 'existing',
    } as AiSettings
    migrateAgents(ai)

    expect(migrateAgents(ai)).toBe(false)
  })
})

/**
 * Memory arrived after the agents did, and the owner wants it on by default — so an agent
 * saved before it gets `remember` switched on, unless somebody already said otherwise.
 */
describe('the remember tool', () => {
  it('is switched on for agents that existed before it', () => {
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [createAgent({ id: 'existing', name: 'Default', toolModes: { fetch: 'ask' } })],
      defaultAgentId: 'existing',
    } as AiSettings

    expect(migrateAgents(ai)).toBe(true)
    expect(ai.agents[0].toolModes.remember).toBe('auto')
  })

  it('stays off where someone turned it off', () => {
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [createAgent({ id: 'existing', name: 'Default', toolModes: { remember: 'off' } })],
      defaultAgentId: 'existing',
    } as AiSettings

    migrateAgents(ai)

    expect(ai.agents[0].toolModes.remember).toBe('off')
  })

  it('is on for the agents a fresh vault starts with', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' } as AiSettings

    migrateAgents(ai)

    for (const agent of ai.agents) expect(agent.toolModes.remember).toBe('auto')
  })
})

/**
 * The GitHub tools came after the agents too. They only read, and only exist while the GitHub
 * integration is on, so an agent with no opinion gets them and an `off` stays.
 */
describe('the GitHub tools', () => {
  it('are switched on for agents that existed before them', () => {
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [createAgent({ id: 'existing', name: 'Default', toolModes: { fetch: 'ask' } })],
      defaultAgentId: 'existing',
    } as AiSettings

    expect(migrateAgents(ai)).toBe(true)
    for (const tool of GITHUB_TOOLS) expect(ai.agents[0].toolModes[tool]).toBe('auto')
  })

  it('stay off, or ask, where someone said so', () => {
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [
        createAgent({
          id: 'existing',
          name: 'Default',
          toolModes: { github_search: 'off', github_open: 'ask' },
        }),
      ],
      defaultAgentId: 'existing',
    } as AiSettings

    migrateAgents(ai)

    expect(ai.agents[0].toolModes.github_search).toBe('off')
    expect(ai.agents[0].toolModes.github_open).toBe('ask')
    expect(ai.agents[0].toolModes.github_read).toBe('auto')
  })

  it('are on for a new agent and for the agents a fresh vault starts with', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' } as AiSettings

    migrateAgents(ai)

    for (const agent of [...ai.agents, createAgent()])
      for (const tool of GITHUB_TOOLS) expect(agent.toolModes[tool]).toBe('auto')
  })
})

/**
 * The agent's own reviewer. Hand-edited files and settings from another device can say
 * anything, and a reviewer that is the agent itself would review its own drafts.
 */
describe('the interceptor an agent carries', () => {
  /** Settled first, so only the interceptor step is left to report anything. */
  const withAgent = (fields: Record<string, unknown>) => {
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [createAgent({ id: 'a1', name: 'A' })],
      defaultAgentId: 'a1',
      commentAgentId: 'a1',
    } as AiSettings
    migrateAgents(ai)
    Object.assign(ai.agents[0], fields)
    return ai
  }

  it('is filled in as none for agents saved before it existed, without a rewrite', () => {
    const ai = withAgent({})
    const raw = ai.agents[0] as unknown as Record<string, unknown>
    delete raw.interceptorAgentId
    delete raw.interceptorContextDepth

    expect(migrateAgents(ai)).toBe(false)
    expect(ai.agents[0].interceptorAgentId).toBe('')
    expect(ai.agents[0].interceptorContextDepth).toBe(0)
  })

  it('keeps a valid choice as it is', () => {
    const ai = withAgent({ interceptorAgentId: 'r1', interceptorContextDepth: -1 })

    expect(migrateAgents(ai)).toBe(false)
    expect(ai.agents[0].interceptorAgentId).toBe('r1')
    expect(ai.agents[0].interceptorContextDepth).toBe(-1)
  })

  it('drops the agent reviewing itself', () => {
    const ai = withAgent({ interceptorAgentId: 'a1' })

    expect(migrateAgents(ai)).toBe(true)
    expect(ai.agents[0].interceptorAgentId).toBe('')
  })

  it('drops values of the wrong shape', () => {
    const ai = withAgent({ interceptorAgentId: 42, interceptorContextDepth: 'lots' })

    expect(migrateAgents(ai)).toBe(true)
    expect(ai.agents[0].interceptorAgentId).toBe('')
    expect(ai.agents[0].interceptorContextDepth).toBe(0)
  })

  it('takes an impossible depth as the draft only', () => {
    const ai = withAgent({ interceptorAgentId: 'r1', interceptorContextDepth: -5 })

    migrateAgents(ai)

    expect(ai.agents[0].interceptorContextDepth).toBe(0)
  })
})
