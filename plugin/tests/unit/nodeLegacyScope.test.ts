import { describe, it, expect, vi } from 'vitest'
import { createNodeTools, NodeRepositoryToolsHost } from '@/ai/tools/node'
import { NodeScopeLedger } from '@/ai/nodeScope'
import type { ChatSession } from '@/ai/ChatSession'
import type { RepositorySource } from '@/repository/source'
import type { NodeAgentHost } from '@/ai/tools/node/agent'
import { NodeAccessRefusalError } from '@/ai/tools/node/accessRefusal'

function setup() {
  const session = {
    nodeScopeIdentity: 'sample-chat',
    overrides: { value: {} },
    conversationVersion: { value: 0 },
    branchSelectionVersion: 0,
  } as unknown as ChatSession
  const legacy = new NodeRepositoryToolsHost(),
    ledger = new NodeScopeLedger()
  const source = {
    identity: {
      provider: 'node',
      installation: 'sample-installation',
      node: 'sample-registration',
      project: 'other-project',
      workspace: 'other-tree',
    },
    cacheNamespace: 'sample-source',
    assertCurrent: vi.fn(),
    text: vi.fn(async () => 'Private sample bytes'),
    home: vi.fn(async () => 'Private sample bytes'),
    workspaces: vi.fn(async () => ['Private sample bytes']),
    folder: vi.fn(async () => 'Private sample bytes'),
    status: vi.fn(async () => 'Private sample bytes'),
    compare: vi.fn(async () => 'Private sample bytes'),
    comparison: vi.fn(async () => ({ changes: [] })),
    comparisonFile: vi.fn(async () => 'Private sample bytes'),
    commit: vi.fn(async () => 'Private sample bytes'),
    search: vi.fn(async () => 'Private sample bytes'),
  } as unknown as RepositorySource
  const tab = { source, selection: () => 'Private sample bytes', open: vi.fn() }
  legacy.attach(tab)
  legacy.grant(session, 'sample-registration', 'other-project')
  let generation = 0
  const factory = (): NodeAgentHost => ({
    ledger,
    nodes: () => [],
    nodeId: () => 'sample-node',
    connection: () => ({
      client: { connected: true } as never,
      principal: () => 'sample-principal',
      get authorizationGeneration() {
        return generation
      },
    }),
  })
  const approve = vi.fn(async () => true)
  const tools = createNodeTools(legacy, approve, factory)
  const call = (name: string, params: Record<string, unknown> = {}) =>
    tools
      .find((tool) => tool.name === name)!
      .execute(
        'sample-call',
        {
          node: 'sample-registration',
          project: 'other-project',
          workspace: 'other-tree',
          path: 'sample.txt',
          ...params,
        },
        undefined,
        { session, interactive: true }
      )
  return {
    session,
    source,
    legacy,
    ledger,
    approve,
    call,
    tab,
    advanceGeneration: () => {
      generation++
    },
  }
}
describe('configured node scope is a ceiling for every legacy node tool', () => {
  for (const entries of [
    [],
    [{ kind: 'project', node_id: 'sample-node', project_id: 'allowed-project', access: 'read' }],
  ]) {
    it(`denies legacy reads and selections outside ${entries.length ? 'narrow' : 'empty'} scope`, async () => {
      const { session, ledger, call, approve, source } = setup()
      session.overrides.value.nodeScope = entries as never
      ledger.approve(session, { 'sample-node': 'sample-principal' })
      for (const name of [
        'node_read',
        'node_file',
        'node_search',
        'node_tree',
        'list_node_worktrees',
        'node_changes',
        'node_compare',
        'node_commit',
        'node_open',
      ])
        await expect(call(name)).rejects.toThrow()
      expect(JSON.stringify(await call('node_views'))).not.toContain('Private sample bytes')
      expect(approve).not.toHaveBeenCalled()
      expect(source.text).not.toHaveBeenCalled()
      expect(source.compare).not.toHaveBeenCalled()
    })
  }
  it('retains legacy repository behavior within the exact configured scope', async () => {
    const { session, legacy, ledger, call } = setup()
    session.overrides.value.nodeScope = [
      { kind: 'project', node_id: 'sample-node', project_id: 'other-project', access: 'read' },
    ]
    ledger.approve(session, { 'sample-node': 'sample-principal' })
    legacy.grant(session, 'sample-registration', 'other-project')
    for (const name of ['node_changes', 'node_compare', 'node_commit'])
      expect(JSON.stringify(await call(name))).toContain('Private sample bytes')
    expect(JSON.stringify(await call('node_views'))).toContain('Private sample bytes')
  })
  it('fences a scoped legacy read when the connection reauthorizes during the read', async () => {
    const { session, source, legacy, ledger, call, advanceGeneration } = setup()
    session.overrides.value.nodeScope = [
      { kind: 'project', node_id: 'sample-node', project_id: 'other-project', access: 'read' },
    ]
    ledger.approve(session, { 'sample-node': 'sample-principal' })
    legacy.grant(session, 'sample-registration', 'other-project')
    vi.mocked(source.compare).mockImplementation(async () => {
      advanceGeneration()
      return 'Private sample bytes' as never
    })
    await expect(call('node_compare')).rejects.toThrow(/authority/)
    expect(ledger.approvedNode(session, 'sample-node', 'sample-principal')).toBe(true)
  })

  it('revokes legacy authorization and retained cursors on configured-scope changes', async () => {
    const { session, legacy, call, source, tab } = setup()
    vi.mocked(source.compare).mockResolvedValue('sample '.repeat(9000) as never)
    const result = await call('node_compare')
    const cursor = (result.details as { cursor: string }).cursor
    session.overrides.value.nodeScope = []
    expect(legacy.authorized(session, tab)).toBe(false)
    await expect(call('node_compare', { cursor })).rejects.toThrow()
  })
})

describe('the node tools a person switches on in the agent settings', () => {
  it('groups file reading, search and worktree listing with the node file tools that serve them', () => {
    const tools = createNodeTools(new NodeRepositoryToolsHost(), undefined, () => {
      throw new Error('unused')
    })
    const category = (name: string) => tools.find((tool) => tool.name === name)!.category
    for (const name of ['node_read', 'node_search', 'list_node_worktrees', 'node_ls', 'node_edit'])
      expect(category(name), name).toBe('Node files')
    expect(category('node_views')).toBe('Node repositories')
    const read = tools.find((tool) => tool.name === 'node_read')!
    expect(read.description).toMatch(/node_folders/)
    expect(Object.keys(read.parameters.properties)).toEqual(
      expect.arrayContaining(['path', 'start_line', 'ref', 'target_kind'])
    )
  })
  it('refuses with the place it wanted when a chat without node access names no open repository tab', async () => {
    const { call } = setup()
    const failure = await call('node_read', { project: 'unknown-project' }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(NodeAccessRefusalError)
    expect((failure as NodeAccessRefusalError).refusal).toEqual({
      kind: 'no-access',
      node_id: 'sample-node',
      project_id: 'unknown-project',
      target: { kind: 'worktree', worktree_id: 'other-tree' },
    })
  })
  it('says how the person gives node access when a chat without it names no open repository tab', async () => {
    const { call } = setup()
    await expect(call('node_read', { project: 'unknown-project' })).rejects.toThrow(
      /Give a chat access/
    )
  })
})

it('uses configured scope for an open repository without a second local grant', async () => {
  const { session, legacy, call, source, approve } = setup()
  session.overrides.value.nodeScope = [
    { kind: 'project', node_id: 'sample-node', project_id: 'other-project', access: 'read' },
  ]
  legacy.revoke(session, 'sample-registration', 'other-project')
  await call('node_changes', { path: '' })
  expect(source.status).toHaveBeenCalledOnce()
  expect(approve).not.toHaveBeenCalled()
})

it('fences a scoped repository read if its attached source changes', async () => {
  const { session, call, source, tab } = setup()
  session.overrides.value.nodeScope = [
    { kind: 'project', node_id: 'sample-node', project_id: 'other-project', access: 'read' },
  ]
  vi.mocked(source.compare).mockImplementation(async () => {
    tab.source = { ...source, cacheNamespace: 'replacement-source' }
    return 'Private sample bytes' as never
  })
  await expect(call('node_compare')).rejects.toThrow(/source|authority/)
})
