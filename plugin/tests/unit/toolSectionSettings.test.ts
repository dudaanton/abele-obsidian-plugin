import { describe, expect, it } from 'vitest'
import { emulatedTools, offerSections, type SectionOfferInput } from '@/ai/ToolDiscovery'
import { getToolRegistry } from '@/ai/tools'
import {
  LEGACY_NODE_TOOLS,
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
    expect(nodeAction('http_send')).toBe('debugger')
    expect(nodeAction('http_requests')).toBe('debugger')
  })
})

describe('what each node action holds', () => {
  const nodeTools = () =>
    getToolRegistry()
      .filter((t) => t.category === 'Nodes')
      .map((t) => t.name)
  const members = (id: string) =>
    nodeTools()
      .filter((n) => !LEGACY_NODE_TOOLS.has(n) && nodeAction(n) === id)
      .sort()

  it('reads and searches node files under Read, and nothing that delegates or debugs', () => {
    expect(members('read')).toEqual(
      [
        'node_changes',
        'node_commit',
        'node_compare',
        'node_folders',
        'node_git_blame',
        'node_git_branches',
        'node_git_diff',
        'node_git_log',
        'node_git_status',
        'node_ls',
        'node_nodes',
        'node_open',
        'node_read',
        'node_search',
        'node_views',
      ].sort()
    )
  })

  it('pins every other action to its own tools', () => {
    // A manager commit writes the repository, so it needs the edit scope like file writes.
    expect(members('edit')).toEqual(
      [
        'node_cp',
        'node_edit',
        'node_git_commit',
        'node_mv',
        'node_propose_edit',
        'node_replace',
        'node_rm',
        'node_write',
      ].sort()
    )
    // Removing a managed worktree sits with the other worktree actions.
    expect(members('worktrees')).toEqual([
      'list_node_worktrees',
      'node_worktree_remove',
      'node_worktree_switch',
    ])
    expect(members('delegate')).toEqual(
      [
        'node_command_run',
        'node_command_status',
        'node_command_cancel',
        'node_git_integrate',
        'node_delegate',
        'node_delegation_cancel',
        'node_delegation_send',
        'node_delegation_status',
        'node_delegations',
      ].sort()
    )
    // Removing a record point belongs beside placing it in Debugger; both require folder edit access.
    expect(members('debugger')).toEqual(
      [
        'http_import',
        'http_request_read',
        'http_request_save',
        'http_requests',
        'http_send',
        'http_send_result',
        'trace_diff',
        'trace_find',
        'trace_follow',
        'trace_mark',
        'trace_note',
        'trace_point_add',
        'trace_point_remove',
        'trace_runs',
        'trace_shape',
        'trace_slice',
        'trace_timeline',
      ].sort()
    )
  })

  it('keeps the old names that do what a file tool does out of every action, reading where they are called', () => {
    expect([...LEGACY_NODE_TOOLS].sort()).toEqual(
      ['node_blame', 'node_commits', 'node_file', 'node_grep', 'node_tree'].sort()
    )
    for (const name of LEGACY_NODE_TOOLS) {
      expect(nodeTools()).toContain(name)
      expect(nodeAction(name)).toBe('read')
    }
  })

  it('leaves no node tool without an action, and no action reaching outside the node group', () => {
    const ids = NODE_ACTIONS.map((a) => a.id)
    for (const name of nodeTools()) expect(ids).toContain(nodeAction(name))
    expect(ids).toEqual(['read', 'edit', 'worktrees', 'delegate', 'debugger'])
  })
})
