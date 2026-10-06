import { beforeEach, describe, expect, it } from 'vitest'
import { createMcpServer } from '@/ai/mcp/types'
import { createMcpTools } from '@/ai/mcp/tools'
import {
  mcpPermissionKey,
  migrateMcpModes,
  migrateMcpPermissions,
  unresolvedMcpPermissionKey,
} from '@/ai/mcp/permissions'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { createAgent } from '@/ai/agents/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { Notice } from 'obsidian'

const server = (id: string, name: string, names: string[], enabled = true) =>
  createMcpServer({
    id,
    name,
    enabled,
    url: 'https://sample.example/mcp',
    tools: names.map((name) => ({ name, description: '', inputSchema: {} })),
  })

beforeEach(() => {
  Notice.shown.length = 0
})

describe('MCP permission identities', () => {
  it('offers every distinct pair even when provider names collide', () => {
    const servers = [
      server('a', 'One', ['part_echo', 'a.b', 'a b']),
      server('b', 'One_part', ['echo']),
    ]
    const tools = createMcpTools(servers)
    expect(tools).toHaveLength(4)
    expect(new Set(tools.map((t) => t.name)).size).toBe(4)
    expect(new Set(tools.map((t) => t.permissionKey)).size).toBe(4)
    for (const tool of tools) expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
    expect(tools.map((t) => t.permissionKey)).toEqual([
      mcpPermissionKey('a', 'part_echo'),
      mcpPermissionKey('a', 'a.b'),
      mcpPermissionKey('a', 'a b'),
      mcpPermissionKey('b', 'echo'),
    ])
  })

  it('reserves real suffix names and keeps aliases stable when a server is switched off', () => {
    const servers = [
      server('a', 'Shared', ['echo', 'echo_2', 'echo_3']),
      server('b', 'Shared', ['echo']),
    ]
    const tools = createMcpTools(servers)
    expect(tools.map((t) => t.name)).toEqual([
      'mcp_shared_echo',
      'mcp_shared_echo_2',
      'mcp_shared_echo_3',
      'mcp_shared_echo_4',
    ])
    servers[0].enabled = false
    expect(createMcpTools(servers)[0].name).toBe('mcp_shared_echo_4')
  })

  it('keeps long aliases within the provider limit even when a hash name repeats', () => {
    const servers = [
      server('a', 'Shared', ['x'.repeat(200)]),
      server('b', 'Shared', ['x'.repeat(200)]),
    ]
    const tools = createMcpTools(servers)
    expect(tools[0].name).not.toBe(tools[1].name)
    expect(tools.map((t) => t.name.length)).toEqual([64, 64])
    expect(tools[0].permissionKey).not.toBe(tools[1].permissionKey)
  })

  it('encodes the full identity without cleaning, truncation or delimiter collisions', () => {
    const pairs = [
      ['a:b', 'c'],
      ['a', 'b:c'],
      ['A', 'x'],
      ['a', 'x'],
      ['a', 'x'.repeat(1000)],
    ]
    expect(new Set(pairs.map(([id, name]) => mcpPermissionKey(id, name))).size).toBe(pairs.length)
  })

  it('renames only the label, leaving both servers permissions in place', () => {
    const a = server('a', 'One', ['part_echo'])
    const b = server('b', 'One_part', ['echo'])
    const modes = {
      [mcpPermissionKey('a', 'part_echo')]: 'auto' as const,
      [mcpPermissionKey('b', 'echo')]: 'off' as const,
    }
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      mcpServers: [a, b],
      toolModes: modes,
      agents: [createAgent({ toolModes: modes })],
    }
    const next = migrateMcpPermissions(ai).ai
    expect(next.toolModes).toEqual(modes)
    expect(next.agents[0].toolModes).toEqual(modes)
    a.name = 'Other'
    expect(createMcpTools([a, b]).map((t) => t.permissionKey)).toEqual(Object.keys(modes))
  })
})

describe('legacy permissions', () => {
  it('migrates exactly one matching pair, including a disabled server', () => {
    const servers = [server('a', 'One', ['echo'], false)]
    const result = migrateMcpModes({ mcp_one_echo: 'auto', fetch: 'ask' }, servers)
    expect(result.modes).toEqual({ [mcpPermissionKey('a', 'echo')]: 'auto', fetch: 'ask' })
    expect(result.reset).toEqual([])
  })

  it('resets all ambiguous matches to ask and removes unmatched entries', () => {
    const servers = [server('a', 'One', ['part_echo']), server('b', 'One_part', ['echo'], false)]
    const result = migrateMcpModes({ mcp_one_part_echo: 'auto', mcp_removed_echo: 'auto' }, servers)
    expect(result.modes).toEqual({
      [mcpPermissionKey('a', 'part_echo')]: 'ask',
      [mcpPermissionKey('b', 'echo')]: 'ask',
      [unresolvedMcpPermissionKey('mcp_removed_echo')]: 'ask',
    })
    expect(result.reset).toEqual(
      expect.arrayContaining(['One / part_echo', 'One_part / echo', 'mcp_removed_echo'])
    )
    expect(migrateMcpModes(result.modes, servers).reset).toEqual([])
  })

  it('also resets cleaned-name collisions within the same server', () => {
    const result = migrateMcpModes({ mcp_one_a_b: 'auto' }, [server('a', 'One', ['a.b', 'a b'])])
    expect(result.modes).toEqual({
      [mcpPermissionKey('a', 'a.b')]: 'ask',
      [mcpPermissionKey('a', 'a b')]: 'ask',
    })
    expect(result.reset).toEqual(['One / a.b', 'One / a b'])
  })

  it('keeps explicit identity-based choices instead of overwriting them from legacy entries', () => {
    const key = mcpPermissionKey('a', 'echo')
    expect(
      migrateMcpModes({ [key]: 'off', mcp_one_echo: 'auto' }, [server('a', 'One', ['echo'])]).modes
    ).toEqual({ [key]: 'off' })
  })

  it('saves the migration and gives one notice listing all reset tools across agents', () => {
    const config = AbeleConfig.getInstance()
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      mcpServers: [server('a', 'One', ['part_echo']), server('b', 'One_part', ['echo'])],
      toolModes: { mcp_one_part_echo: 'auto' as const },
      agents: [createAgent({ toolModes: { mcp_one_part_echo: 'auto', mcp_missing_x: 'auto' } })],
    }
    expect(config.applySettings({ ai } as any)).toBe(true)
    expect(config.ai.agents[0].toolModes[mcpPermissionKey('a', 'part_echo')]).toBe('ask')
    expect(Notice.shown).toHaveLength(1)
    expect(Notice.shown[0]).toContain('One / part_echo')
    expect(Notice.shown[0]).toContain('One_part / echo')
    expect(Notice.shown[0]).toContain('mcp_missing_x')
    Notice.shown.length = 0
    config.applySettings(config.exportSettings())
    expect(Notice.shown).toEqual([])
  })
})
