import { describe, expect, it } from 'vitest'
import { emulatedTools, offerSections, type SectionOfferInput } from '@/ai/ToolDiscovery'
import {
  NODE_ACTIONS,
  NODE_GROUP,
  agentSectionOverrides,
  alwaysOpenSections,
  nodeAction,
  sectionOpening,
} from '@/ai/toolSections'
import type { AgentTool } from '@/ai/client'

const tool = (name: string): AgentTool => ({
  name,
  label: name,
  description: `${name} does one sample thing.`,
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ content: [{ type: 'text', text: name }] }),
})
const input = (over: Partial<SectionOfferInput> = {}): SectionOfferInput => ({
  allowed: [tool('read'), tool('node_read'), tool('geocode')],
  metadata: [
    { name: 'read', label: 'Read file', category: 'Files' },
    { name: 'node_read', label: 'Read node file', category: 'Nodes' },
    { name: 'geocode', label: 'Geocode', category: 'Maps' },
  ],
  context: new Set(),
  open: [],
  ...over,
})
const names = (tools: AgentTool[]) => tools.map((t) => t.name)

describe('when an agent’s sections are open', () => {
  it('opens a section from the first request when the agent says Always open, and no other', () => {
    const agent = { toolSectionOpening: { nodes: 'always' as const, maps: 'on-request' as const } }
    expect(alwaysOpenSections(agent)).toEqual(['nodes'])
    const offered = names(emulatedTools(offerSections(input({ open: alwaysOpenSections(agent) }))))
    expect(offered).toContain('node_read')
    expect(offered).not.toContain('geocode')
  })

  it('keeps every section on request by default, and the always-loaded groups always open', () => {
    expect(alwaysOpenSections({})).toEqual([])
    expect(alwaysOpenSections(undefined)).toEqual([])
    expect(sectionOpening('Maps', {})).toBe('on-request')
    expect(sectionOpening(NODE_GROUP, { toolSectionOpening: { nodes: 'always' } })).toBe('always')
    expect(sectionOpening('Files', { toolSectionOpening: { files: 'on-request' } })).toBe('always')
  })

  it('reads the agent’s own words for a section in place of the default and the vault-wide words', () => {
    const agent = { toolSectionDescriptions: { maps: 'Sample agent words for maps.' } }
    const overrides = {
      open_maps: 'Sample vault words for maps.',
      ...agentSectionOverrides(agent),
    }
    const open = emulatedTools(offerSections(input({ overrides }))).find(
      (t) => t.name === 'open_maps'
    )!
    expect(open.description).toContain('Sample agent words for maps.')
    expect(open.description).not.toContain('vault words')
    expect(agentSectionOverrides({ toolSectionDescriptions: { maps: '  ' } })).toEqual({})
  })
})

describe('the node section in an agent’s tools', () => {
  it('puts each tool under what it does, reading where nothing else claims it', () => {
    expect(nodeAction('node_write')).toBe('edit')
    expect(nodeAction('node_rm')).toBe('edit')
    expect(nodeAction('node_propose_edit')).toBe('edit')
    expect(nodeAction('node_worktree_switch')).toBe('worktrees')
    expect(nodeAction('list_node_worktrees')).toBe('worktrees')
    expect(nodeAction('node_git_log')).toBe('read')
    expect(nodeAction('node_some_new_reader')).toBe('read')
    expect(NODE_ACTIONS.map((a) => a.id)).toEqual(['read', 'edit', 'worktrees'])
  })
})
