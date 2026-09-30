import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCurrentLocationTool } from '@/ai/tools/CurrentLocationTool'
import { createAgent } from '@/ai/agents/types'
import { migrateAgents } from '@/ai/agents/migration'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { createAgentTools, getToolRegistry } from '@/ai/tools'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
})
afterEach(() => vi.unstubAllGlobals())

const tool = () => createCurrentLocationTool()

describe('current_location', () => {
  it('returns coordinates, accuracy in metres, provider time and the answering platform', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({
            coords: { latitude: 12.345, longitude: 67.89, accuracy: 24 },
            timestamp: 1234567890000,
          } as GeolocationPosition),
      },
    })
    const result = await tool().execute('sample-call', {})
    const answer = JSON.parse(result.content[0].text!)
    expect(answer).toMatchObject({
      latitude: 12.345,
      longitude: 67.89,
      accuracy: 24,
      timestamp: 1234567890000,
    })
    expect(answer.device).toMatch(/Obsidian on .+\(device running this chat\)/)
  })

  it('explains unavailable geolocation instead of guessing a position', async () => {
    vi.stubGlobal('navigator', {})
    await expect(tool().execute('sample-call', {})).rejects.toThrow(/not available on this device/)
  })

  it('warns the model to use personal location only for answers that depend on it', () => {
    expect(tool().description).toMatch(/personal/i)
    expect(tool().description).toMatch(/only.*answer depends/i)
    expect(tool().description).toMatch(/geocode/)
  })

  it('is in the standard registry, grouped under Maps, and defaults to Ask', () => {
    expect(createAgentTools().some((t) => t.name === 'current_location')).toBe(true)
    expect(getToolRegistry().find((t) => t.name === 'current_location')?.category).toBe('Maps')
    expect(createAgent().toolModes.current_location).toBe('ask')
    expect(DEFAULT_AI_SETTINGS.toolModes.current_location).toBe('ask')
  })

  it('adds Ask to existing agents once, preserving deliberate Off and On modes', () => {
    const ai = structuredClone(DEFAULT_AI_SETTINGS)
    ai.agents = ['off', 'auto', undefined].map((mode) =>
      createAgent({ toolModes: mode ? { current_location: mode as 'off' | 'auto' } : {} })
    )
    migrateAgents(ai)
    expect(ai.agents.slice(0, 3).map((a) => a.toolModes.current_location)).toEqual([
      'off',
      'auto',
      'ask',
    ])
    expect(migrateAgents(ai)).toBe(false)
  })

  it('goes through the normal per-agent Off / Ask / On filter', () => {
    const registry = AgentRegistry.getInstance()
    for (const mode of ['off', 'ask', 'auto'] as const) {
      const agent = createAgent({ toolModes: { current_location: mode } })
      expect(registry.filterTools(agent, [tool()]).some((t) => t.name === 'current_location')).toBe(
        mode !== 'off'
      )
    }
  })
})
