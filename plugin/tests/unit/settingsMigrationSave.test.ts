/**
 * Migration writes to memory; something has to write it to disk.
 *
 * Before this, a vault that already had agents seeded a fresh Comment agent on every launch,
 * because nothing persisted the one made last time. Any comment file written in between then
 * named an agent id that would not exist at the next start.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
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

  /** A save during load must not register the AI features early; `onload` does that itself. */
  it('does not sync the AI features from inside the load', async () => {
    const plugin = install({ ai: { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' } })

    await AbeleConfig.getInstance().loadSettings()

    expect(plugin.syncAiFeatures).not.toHaveBeenCalled()
  })
})

describe('loading settings with nothing to migrate', () => {
  it('writes nothing', async () => {
    install({
      ai: {
        ...DEFAULT_AI_SETTINGS,
        agents: [createAgent({ id: 'a1', name: 'Default' }), createAgent({ id: 'c1' })],
        defaultAgentId: 'a1',
        commentAgentId: 'c1',
      },
    })

    await AbeleConfig.getInstance().loadSettings()

    expect(saved).toEqual([])
  })
})
