/**
 * The small rules behind the MCP settings screen: headers typed as lines, a server's name
 * standing in every tool name, and a rename that takes the agents' tool modes along.
 */
import { describe, it, expect } from 'vitest'
import { formatHeaders, parseHeaders, nameClash, mcpKeyId } from '@/ai/mcp/settings'
import { mcpPermissionKey, migrateMcpPermissions } from '@/ai/mcp/permissions'
import { createMcpServer } from '@/ai/mcp/types'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { createAgent } from '@/ai/agents/types'

describe('headers typed one to a line', () => {
  it('read as name and value, split at the first colon', () => {
    expect(parseHeaders('X-Team: blue\n\nAuthorization: Basic a:b\n  X-Empty:  \n')).toEqual({
      'X-Team': 'blue',
      Authorization: 'Basic a:b',
      'X-Empty': '',
    })
  })

  it('leave out a line with no name', () => {
    expect(parseHeaders(': nothing\nno colon here')).toEqual({})
  })

  it('come back as the same lines', () => {
    expect(formatHeaders({ 'X-Team': 'blue', 'X-Key': '${abele_key:k}' })).toBe(
      'X-Team: blue\nX-Key: ${abele_key:k}'
    )
  })
})

describe('a server name', () => {
  it('clashes with another server that gives the same tool names', () => {
    const servers = [createMcpServer({ id: 'a', name: 'Context' })]

    expect(nameClash(servers, 'context', 'b')).toBe(true)
    expect(nameClash(servers, 'Context', 'a')).toBe(false)
    expect(nameClash(servers, 'Other', 'b')).toBe(false)
  })

  it('has a keychain slot of its own for the token', () => {
    expect(mcpKeyId('abc')).toBe('abele-mcp-abc')
    expect(mcpKeyId('XD-0OXNKp8')).toMatch(/^[a-z0-9-]+$/)
    expect(mcpKeyId('A_B-C_D-E_').length).toBeLessThanOrEqual(64)
  })
})

describe('renaming a server', () => {
  it('keeps every agent’s and the default tool modes under identity keys after a rename', () => {
    const agent = createAgent({
      toolModes: { mcp_old_echo: 'ask', mcp_old_add: 'auto', mcp_other_x: 'ask', fetch: 'ask' },
    })
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      toolModes: { mcp_old_echo: 'ask' as const },
      agents: [agent],
      mcpServers: [
        createMcpServer({
          id: 'a',
          name: 'Old',
          tools: [
            { name: 'echo', description: '', inputSchema: {} },
            { name: 'add', description: '', inputSchema: {} },
          ],
        }),
        createMcpServer({
          id: 'b',
          name: 'Other',
          tools: [{ name: 'x', description: '', inputSchema: {} }],
        }),
      ],
    }

    const next = migrateMcpPermissions(ai).ai
    next.mcpServers![0].name = 'New'

    expect(next.agents[0].toolModes).toMatchObject({
      [mcpPermissionKey('a', 'echo')]: 'ask',
      [mcpPermissionKey('a', 'add')]: 'auto',
      [mcpPermissionKey('b', 'x')]: 'ask',
      fetch: 'ask',
    })
    expect(next.agents[0].toolModes.mcp_old_echo).toBeUndefined()
    expect(next.toolModes).toEqual({ [mcpPermissionKey('a', 'echo')]: 'ask' })
  })

  it('changes nothing when the name gives the same tool names', () => {
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      agents: [createAgent({ toolModes: { [mcpPermissionKey('a', 'x')]: 'ask' } })],
      mcpServers: [createMcpServer({ id: 'a', name: 'A' })],
    }
    ai.mcpServers[0].name = 'a'
    expect(migrateMcpPermissions(ai).ai).toBe(ai)
  })
})
