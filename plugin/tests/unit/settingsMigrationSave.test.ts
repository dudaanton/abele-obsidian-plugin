/**
 * Migration writes to memory; something has to write it to disk.
 *
 * Before this, a vault that already had agents seeded a fresh Comment agent on every launch,
 * because nothing persisted the one made last time. Any comment file written in between then
 * named an agent id that would not exist at the next start.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  DEFAULT_AI_SETTINGS,
  BOOK_TOOL_MODES,
  DOCX_TOOL_MODES,
  XLSX_TOOL_MODES,
  CANVAS_TOOL_MODES,
  LINT_TOOL_MODES,
  LOCATION_TOOL_MODES,
  ANALYTICS_TOOL_MODES,
  GITHUB_TOOL_MODES,
  MAP_TOOL_MODES,
} from '@/ai/types'
import { createAgent } from '@/ai/agents/types'
import { createMcpServer } from '@/ai/mcp/types'
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
  it('persists legacy MCP ownership once, even when only closed chats contain legacy modes', async () => {
    const original = createMcpServer({
      id: 'original',
      name: 'Archive',
      tools: [{ name: 'echo', description: '', inputSchema: {} }],
    })
    install({ ai: { ...DEFAULT_AI_SETTINGS, mcpServers: [original] } })
    const config = AbeleConfig.getInstance()
    await config.loadSettings()
    expect(saved).toHaveLength(1)
    expect((saved[0].ai as typeof config.ai).mcpLegacyToolMap).toEqual({
      mcp_archive_echo: [{ serverId: 'original', serverName: 'Archive', toolName: 'echo' }],
    })
    const stored = structuredClone(saved[0])
    const ai = stored.ai as typeof config.ai
    ai.mcpServers![0].name = 'Renamed'
    ai.mcpServers!.push(createMcpServer({ ...original, id: 'replacement' }))
    install(stored)
    await config.loadSettings()
    expect(saved).toEqual([])
    expect(config.ai.mcpLegacyToolMap?.mcp_archive_echo.map((tool) => tool.serverId)).toEqual([
      'original',
    ])
  })
  it('persists a GitHub connection using the existing secret slot without copying the token', async () => {
    install({
      github: { enabled: true, server: 'https://git.example.test', keyId: 'existing-key' },
    })
    await AbeleConfig.getInstance().loadSettings()
    expect(saved).toHaveLength(1)
    expect((saved[0] as { github: { connections: unknown[] } }).github.connections).toMatchObject([
      {
        id: 'github-legacy',
        keyId: 'existing-key',
        server: 'https://git.example.test',
        isDefault: true,
      },
    ])
    install(saved[0])
    await AbeleConfig.getInstance().loadSettings()
    expect(saved).toHaveLength(0)
  })

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
    // Including all current default tools: an agent without them gives the migration something
    // to say about, which would make this a test of that instead.
    const toolModes = {
      ...MAP_TOOL_MODES,
      ...GITHUB_TOOL_MODES,
      ...BOOK_TOOL_MODES,
      ...DOCX_TOOL_MODES,
      ...XLSX_TOOL_MODES,
      ...CANVAS_TOOL_MODES,
      ...LINT_TOOL_MODES,
      ...LOCATION_TOOL_MODES,
      ...ANALYTICS_TOOL_MODES,
      remember: 'auto' as const,
      forget: 'auto' as const,
    }
    install({
      ai: {
        ...DEFAULT_AI_SETTINGS,
        agents: [
          createAgent({ id: 'a1', name: 'Default', toolModes }),
          createAgent({ id: 'c1', toolModes: { ...toolModes } }),
        ],
        defaultAgentId: 'a1',
        commentAgentId: 'c1',
        mcpLegacyToolMap: {}, // Already captured at upgrade, even without connected servers.
      },
    })

    await AbeleConfig.getInstance().loadSettings()

    expect(saved).toEqual([])
  })
})
