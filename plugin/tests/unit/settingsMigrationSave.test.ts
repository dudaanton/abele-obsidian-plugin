/**
 * Migration writes to memory; something has to write it to disk.
 *
 * Before this, a vault that already had agents seeded a fresh Comment agent on every launch,
 * because nothing persisted the one made last time. Any comment file written in between then
 * named an agent id that would not exist at the next start.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, GITHUB_TOOL_MODES, MAP_TOOL_MODES } from '@/ai/types'
import { createAgent } from '@/ai/agents/types'
import { useVault } from '../helpers/testEnv'

interface FakePlugin {
  loadData: () => Promise<unknown>
  saveData: (data: unknown) => Promise<void>
  syncAiFeatures: () => void
}

let saved: Array<Record<string, unknown>>

function install(stored: unknown): FakePlugin {
  saved = []
  const plugin: FakePlugin = {
    loadData: async () => stored,
    saveData: async (data) => void saved.push(data as Record<string, unknown>),
    syncAiFeatures: vi.fn(),
  }
  AbeleConfig.getInstance().init(plugin as never)
  return plugin
}

beforeEach(() => {
  useVault([])
})

describe('loading settings that still need migrating', () => {
  it('writes them back, so the migration only happens once', async () => {
    install({ ai: { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' } })

    await AbeleConfig.getInstance().loadSettings()

    expect(saved).toHaveLength(1)
    const ai = (saved[0] as { ai: { commentAgentId?: string } }).ai
    expect(ai.commentAgentId).toBeTruthy()
  })

  it('gives the same Comment agent back on the next load', async () => {
    install({ ai: { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' } })
    await AbeleConfig.getInstance().loadSettings()
    const first = AbeleConfig.getInstance().ai.commentAgentId

    install(saved[0])
    await AbeleConfig.getInstance().loadSettings()

    expect(AbeleConfig.getInstance().ai.commentAgentId).toBe(first)
    expect(AbeleConfig.getInstance().ai.agents.filter((a) => a.name === 'Comment')).toHaveLength(1)
  })

  it('carries header buttons through a migration save', async () => {
    const button = {
      id: 'make-task',
      name: 'Create task',
      icon: 'list-plus',
      noteTypes: ['project'],
      scriptName: 'Create task for note',
      params: { source: '{{path}}' },
    }
    install({
      headerButtons: [button],
      ai: { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' },
    })

    await AbeleConfig.getInstance().loadSettings()

    expect(saved[0].headerButtons).toMatchObject([button])
  })

  it('reads a header button saved before property conditions existed as having none', async () => {
    install({
      headerButtons: [
        { id: 'old', name: 'Old', icon: 'play', noteTypes: ['task'], scriptName: 'S', params: {} },
        {
          id: 'hand',
          name: 'Hand-written',
          icon: 'play',
          noteTypes: [],
          scriptName: 'S',
          params: {},
          conditions: [{ property: 'rating', test: 'bigger', value: 5 }, null],
        },
      ],
      ai: { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' },
    })

    await AbeleConfig.getInstance().loadSettings()

    const [old, hand] = AbeleConfig.getInstance().headerButtons
    expect(old.conditions).toEqual([])
    expect(old.conditionMode).toBe('all')
    expect(hand.conditions).toEqual([{ property: 'rating', test: 'equals', value: '5' }])
  })

  /** A save during load must not register the AI features early; `onload` does that itself. */
  it('does not sync the AI features from inside the load', async () => {
    const plugin = install({ ai: { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' } })

    await AbeleConfig.getInstance().loadSettings()

    expect(plugin.syncAiFeatures).not.toHaveBeenCalled()
  })
})

describe('loading settings with nothing to migrate', () => {
  it('writes nothing', async () => {
    // Including the map tools: an agent without them is an agent the migration has something
    // to say about, which would make this a test of that instead.
    const toolModes = { ...MAP_TOOL_MODES, ...GITHUB_TOOL_MODES, remember: 'auto' as const }
    install({
      ai: {
        ...DEFAULT_AI_SETTINGS,
        agents: [
          createAgent({ id: 'a1', name: 'Default', toolModes }),
          createAgent({ id: 'c1', toolModes: { ...toolModes } }),
        ],
        defaultAgentId: 'a1',
        commentAgentId: 'c1',
      },
    })

    await AbeleConfig.getInstance().loadSettings()

    expect(saved).toEqual([])
  })
})
