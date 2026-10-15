import { describe, expect, it, vi } from 'vitest'
import {
  closedSectionHint,
  emulatedTools,
  offerSections,
  openSectionsOnPath,
  type SectionOfferInput,
} from '@/ai/ToolDiscovery'
import { nodeSectionLive, sectionIdOfGroup, sectionsOfLegacyGroups } from '@/ai/toolSections'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { AgentTool, ModelConfig, AssistantMessage } from '@/ai/client'

const tool = (
  name: string,
  description = `${name} does one sample thing. More detail.`
): AgentTool => ({
  name,
  label: name,
  description,
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ content: [{ type: 'text', text: name }] }),
})
const allowed = [
  tool('read'),
  tool('geocode'),
  tool('route'),
  tool('read_transactions'),
  tool('analyze_data'),
  tool('sample_server_lookup'),
]
const metadata = [
  { name: 'read', label: 'Read file', category: 'Files' },
  { name: 'geocode', label: 'Geocode', category: 'Maps' },
  { name: 'route', label: 'Build route', category: 'Maps' },
  { name: 'read_transactions', label: 'Read transactions', category: 'Finance' },
  { name: 'analyze_data', label: 'Analyze data', category: 'Notes data' },
  { name: 'sample_server_lookup', label: 'Sample lookup', category: 'MCP · Sample server' },
]
const input = (over: Partial<SectionOfferInput> = {}): SectionOfferInput => ({
  allowed,
  metadata,
  context: new Set(),
  open: [],
  ...over,
})
const names = (tools: AgentTool[]) => tools.map((t) => t.name)
const guide = async (tools: AgentTool[], name: string) =>
  (await tools.find((t) => t.name === name)!.execute('sample-open', {})).content[0].text as string

describe('section offer', () => {
  it('starts with the always-loaded tools and one open tool per section with an allowed tool', () => {
    expect(names(emulatedTools(offerSections(input())))).toEqual([
      'read',
      'open_finance',
      'open_notes_data',
      'open_maps',
      'open_mcp_sample_server',
    ])
  })

  it('lists no section whose tools are all Off', () => {
    const only = input({ allowed: [tool('read'), tool('geocode')] })
    expect(names(emulatedTools(offerSections(only)))).toEqual(['read', 'open_maps'])
  })

  it('appends an open section after every section tool, in the order opened', () => {
    const start = emulatedTools(offerSections(input()))
    const maps = emulatedTools(offerSections(input({ open: ['maps'] })))
    expect(names(maps)).toEqual([...names(start), 'geocode', 'route'])
    const both = emulatedTools(offerSections(input({ open: ['maps', 'finance'] })))
    expect(names(both)).toEqual([...names(maps), 'read_transactions', 'analyze_data'])
    // Descriptions do not change when a section opens, so the cached prefix survives.
    expect(both.slice(0, start.length).map((t) => t.description)).toEqual(
      start.map((t) => t.description)
    )
  })

  it('opens the tools a section borrows from another group without repeating them', () => {
    const tools = emulatedTools(offerSections(input({ open: ['finance', 'notes_data'] })))
    expect(names(tools).filter((n) => n === 'analyze_data')).toHaveLength(1)
  })

  it('keeps context tools loaded whatever their group', () => {
    const tools = emulatedTools(offerSections(input({ context: new Set(['geocode']) })))
    expect(names(tools).slice(0, 2)).toEqual(['read', 'geocode'])
    expect(names(tools)).not.toContain('route')
  })

  it('says what a section is for, and which tools it opens', () => {
    const tools = emulatedTools(offerSections(input()))
    const maps = tools.find((t) => t.name === 'open_maps')!
    expect(maps.description).toContain('Places and routes')
    expect(maps.description).toContain('Opens: geocode, route.')
    expect(maps.parameters).toEqual({ type: 'object', properties: {}, additionalProperties: false })
    expect(tools.find((t) => t.name === 'open_mcp_sample_server')!.description).toContain(
      'Sample lookup'
    )
  })

  it("takes the person's own words for a section", () => {
    const tools = emulatedTools(
      offerSections(input({ overrides: { open_maps: 'Sample words for maps.' } }))
    )
    expect(tools.find((t) => t.name === 'open_maps')!.description).toBe(
      'Sample words for maps.\n\nOpens: geocode, route.'
    )
  })

  it('returns the tools, the how-to and the live state when opened', async () => {
    const live = vi.fn(() => 'Sample live line')
    const tools = emulatedTools(offerSections(input({ asks: (t) => t.name === 'route', live })))
    const text = await guide(tools, 'open_maps')
    expect(text).toContain('- geocode: geocode does one sample thing.')
    expect(text).toContain('- route (asks the person first): route does one sample thing.')
    expect(text).not.toContain('More detail')
    expect(text).toContain('How to use them:')
    expect(text).toContain('Right now:\nSample live line')
    expect(live).toHaveBeenCalledWith('maps')
  })

  it("points a call to a closed section's tool at the section to open", () => {
    const offer = offerSections(input())
    expect(closedSectionHint('route', offer)).toContain('Call open_maps first')
    expect(closedSectionHint('read', offer)).toBeUndefined()
    expect(closedSectionHint('sample_unknown', offer)).toBeUndefined()
    expect(closedSectionHint('route', offerSections(input({ open: ['maps'] })))).toBeUndefined()
  })
})

describe('open sections of a branch', () => {
  const call = (toolName: string, extra: Record<string, unknown> = {}) => ({
    role: 'tool-call',
    toolName,
    toolStatus: 'approved',
    toolResult: 'opened',
    ...extra,
  })

  it('are the open calls on the path that ran, in order and without repeats', () => {
    expect(
      openSectionsOnPath([
        { role: 'user' },
        call('open_maps'),
        call('geocode'),
        call('open_finance'),
        call('open_maps'),
        call('open_canvas', { toolStatus: 'rejected' }),
        call('open_books', { toolResult: undefined }),
      ])
    ).toEqual(['maps', 'finance'])
  })
})

describe('section names', () => {
  it('maps groups revealed before sections onto the sections they became', () => {
    expect(sectionsOfLegacyGroups(['Maps', 'Vault data', 'Node files', 'Nodes', 42])).toEqual([
      'maps',
      'tasks',
      'finance',
      'notes_data',
      'nodes',
    ])
  })

  it('gives a group without a definition a section name a provider accepts', () => {
    expect(sectionIdOfGroup('MCP · Sample server')).toBe('mcp_sample_server')
    expect(`open_${sectionIdOfGroup('x'.repeat(100))}`.length).toBeLessThanOrEqual(64)
  })
})

describe('node section live state', () => {
  it('says what the chat may reach, what is selected and how writes go', () => {
    const text = nodeSectionLive(
      [
        {
          kind: 'target',
          node_id: 'sample-node',
          project_id: 'sample-project',
          access: 'edit',
          target: { kind: 'worktree', worktree_id: 'sample-worktree' },
        },
        { kind: 'node', node_id: 'other-node', access: 'read' },
      ],
      {
        node_id: 'sample-node',
        project_id: 'sample-project',
        target: { kind: 'worktree', worktree_id: 'sample-worktree' },
      },
      'allow-edit'
    )
    expect(text).toContain(
      '- worktree sample-worktree of project sample-project on sample-node (read and edit)'
    )
    expect(text).toContain('- the whole node other-node (read only)')
    expect(text).toContain('Selected: worktree sample-worktree')
    expect(text).toContain('Writes: edits run without asking')
    expect(text).toContain('Only the person changes this scope.')
  })

  it('says plainly when the chat has no node access, and where the person gives it', () => {
    const text = nodeSectionLive(undefined, undefined, 'confirm-all')
    expect(text).toContain('no node access')
    expect(text).toContain('Give a chat access')
  })

  it('says calls without IDs reach the one folder a chat was given', () => {
    const text = nodeSectionLive(
      [
        {
          kind: 'target',
          node_id: 'sample-node',
          project_id: 'sample-project',
          access: 'read',
          target: { kind: 'workspace', workspace_id: 'sample-folder' },
        },
      ],
      undefined,
      'confirm-all'
    )
    expect(text).toContain('leave node, project and workspace out use this one folder')
    expect(text).not.toContain('Nothing is selected')
  })
})

it('opens a section and uses its tool within the same agent loop', async () => {
  const open: string[] = []
  const offered: string[][] = []
  const stream = vi
    .spyOn(OpenAIClient.prototype, 'stream')
    .mockImplementation(async function* (_m, _s, _history, tools) {
      offered.push(tools.map((t) => t.name))
      const n = offered.length
      const content: AssistantMessage['content'] =
        n === 1
          ? [
              { type: 'toolCall', id: 'sample-early', name: 'geocode', arguments: {} },
              { type: 'toolCall', id: 'sample-open', name: 'open_maps', arguments: {} },
            ]
          : n === 2
            ? [{ type: 'toolCall', id: 'sample-use', name: 'geocode', arguments: {} }]
            : [{ type: 'text', text: 'done' }]
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content,
          model: 'sample',
          timestamp: 1,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: n < 3 ? 'toolUse' : 'stop',
        },
      }
    })
  try {
    const offer = () => offerSections(input({ open }))
    const loop = new AgentLoop()
    loop.subscribe((event) => {
      // What the session derives from the finished call on its branch.
      if (event.type === 'tool_end' && !event.isError && event.toolName === 'open_maps')
        open.push('maps')
    })
    const result = await loop.run({
      model: { id: 'sample' } as ModelConfig,
      systemPrompt: '',
      messages: [],
      tools: emulatedTools(offer()),
      getTools: () => emulatedTools(offer()),
      missingTool: (name) => closedSectionHint(name, offer()),
    })
    expect(offered[0]).not.toContain('geocode')
    expect(offered[1]).toContain('geocode')
    const results = result.messages.filter((m) => m.role === 'toolResult')
    expect(results[0].content[0].text).toContain('Call open_maps first')
    expect(results[1].content[0].text).toContain('Maps is open')
    expect(results[2].content).toEqual([{ type: 'text', text: 'geocode' }])
  } finally {
    stream.mockRestore()
  }
})
