/**
 * The small rules behind the MCP settings screen: headers typed as lines, a server's name
 * standing in every tool name, and a rename that takes the agents' tool modes along.
 */
import { describe, it, expect } from 'vitest'
import {
  formatHeaders,
  parseHeaders,
  renameServerTools,
  nameClash,
  mcpKeyId,
} from '@/ai/mcp/settings'
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
  })
})

describe('renaming a server', () => {
  it('moves every agent’s and the default tool modes to the new names', () => {
    const agent = createAgent({
      toolModes: { mcp_old_echo: 'ask', mcp_old_add: 'auto', mcp_other_x: 'ask', fetch: 'ask' },
    })
    const ai = {
      ...DEFAULT_AI_SETTINGS,
      toolModes: { mcp_old_echo: 'ask' as const },
      agents: [agent],
    }

    const next = renameServerTools(ai, 'Old', 'New')

    expect(next.agents[0].toolModes).toMatchObject({
      mcp_new_echo: 'ask',
      mcp_new_add: 'auto',
      mcp_other_x: 'ask',
      fetch: 'ask',
    })
    expect(next.agents[0].toolModes.mcp_old_echo).toBeUndefined()
    expect(next.toolModes).toEqual({ mcp_new_echo: 'ask' })
  })

  it('changes nothing when the name gives the same tool names', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, agents: [createAgent({ toolModes: { mcp_a_x: 'ask' } })] }

    expect(renameServerTools(ai, 'A', 'a')).toBe(ai)
  })
})
