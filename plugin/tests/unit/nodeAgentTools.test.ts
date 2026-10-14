import { describe, it, expect, vi } from 'vitest'
import {
  FileContentSchema,
  ContentChunkSchema,
  FileMutationResultSchema,
  ProjectSchema,
  WorkspaceSchema,
  WorktreePageSchema,
  RepositoryObservationSchema,
  RepositoryBlobSchema,
  RepositoryStatusPageSchema,
  RepositoryRefsPageSchema,
  RepositoryComparisonSchema,
  RepositoryHistoryPageSchema,
  RepositoryBlameSchema,
  FilePageSchema,
  RepositoryMutationResultSchema,
  RepositorySearchPageSchema,
} from '@abele/node-protocol'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import * as protocol from '@abele/node-protocol'
import type { ChatSession } from '@/ai/ChatSession'
import { NodeScopeLedger } from '@/ai/nodeScope'
import { createNodeAgentTools, type NodeAgentHost } from '@/ai/tools/node/agent'

import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
const digest = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value)))
const hash = digest('old')
const project = ProjectSchema.parse({
  project_id: 'sample-project',
  root_path: '/sample',
  repository_path: null,
  git_common_dir: null,
  trust: 'untrusted',
  use_repository_claude_permissions: false,
  created_at: '2026-01-01T00:00:00Z',
})
const workspace = WorkspaceSchema.parse({
  workspace_id: 'sample-workspace',
  project_id: project.project_id,
  kind: 'root',
  path: '/sample',
  branch: null,
  base_commit: null,
  state: 'ready',
  provenance: {
    installation_id: 'sample-installation',
    node_id: 'sample-node',
    operation_id: 'sample-operation',
  },
  created_at: '2026-01-01T00:00:00Z',
})
function setup(mode = 'allow-edit') {
  const ledger = new NodeScopeLedger()
  const session = {
    nodeScopeIdentity: 'sample-chat',
    overrides: {
      value: {
        nodeScope: [
          {
            kind: 'project',
            node_id: 'sample-node',
            project_id: project.project_id,
            access: 'edit',
          },
        ],
      },
    },
    conversationVersion: { value: 0 },
    branchSelectionVersion: 0,
    permissionMode: { value: mode },
    noteNodeWorktreeSwitch: vi.fn(),
    save: vi.fn(),
    saveForRelease: vi.fn(),
  } as unknown as ChatSession
  let principal = 'sample-pin:0',
    generation = 0
  const client = {
    store: new MemoryClientStore(),
    connected: true,
    describe: vi.fn(async () => ({ node_id: 'sample-node', capabilities: { capabilities: {} } })),
    getProject: vi.fn(async () => project),
    getWorkspace: vi.fn(async () => workspace),
    listProjects: vi.fn(async () => [project]),
    listWorkspaces: vi.fn(async () => [workspace]),
    readFile: vi.fn(async () =>
      FileContentSchema.parse({
        workspace_id: workspace.workspace_id,
        path: 'sample.txt',
        content_id: hash,
        size: 3,
        binary: false,
        large: false,
        too_large: false,
      })
    ),
    readContent: vi.fn(async () =>
      ContentChunkSchema.parse({ offset: 0, total: 3, base64: btoa('old') })
    ),
    writeFile: vi.fn(async () => ({ operation_id: 'sample-write' })),
    fileMutationResult: vi.fn(async () =>
      FileMutationResultSchema.parse({
        workspace_id: workspace.workspace_id,
        path: 'sample.txt',
        operation_id: 'sample-write',
        state: 'saved',
        content_id: digest('new'),
        expected_content_id: hash,
        recovery_path: null,
        predecessor_content_id: hash,
      })
    ),
  }
  let operationCount = 0
  const host: NodeAgentHost = {
    newOperationId: () => {
      const base = 'repository' in client ? 'sample-git-write' : 'sample-write'
      return ++operationCount === 1 ? base : `${base}-${operationCount}`
    },
    ledger,
    nodes: () => [{ id: 'sample-node', label: 'Sample node' }],
    connection: () => ({
      client: client as unknown as NodeClient,
      principal: () => principal,
      get authorizationGeneration() {
        return generation
      },
    }),
  }
  ledger.approve(session, { 'sample-node': principal })
  const factory = () => host
  const tools = createNodeAgentTools(factory)
  const call = (name: string, params: Record<string, unknown> = {}, approved = false) =>
    tools
      .find((t) => t.name === name)!
      .execute(
        'sample-call',
        {
          node: 'sample-node',
          project: project.project_id,
          workspace: workspace.workspace_id,
          target_kind: 'workspace',
          ...params,
        },
        undefined,
        { session, approved, interactive: true }
      )
  return {
    client,
    session,
    ledger,
    host,
    factory,
    call,
    advanceGeneration: () => {
      generation++
    },
    principal: (value: string) => {
      principal = value
    },
  }
}
function setupGit() {
  const fixture = setup()
  const tip = '1'.repeat(40)
  const worktree = {
    worktree_id: 'sample-tree',
    project_id: project.project_id,
    workspace_id: workspace.workspace_id,
    kind: 'root',
    path_label: '/sample',
    branch: 'sample-branch',
    detached: false,
    head: tip,
    availability: 'available',
    locked: false,
    prunable: false,
    dirty: true,
  }
  const page = WorktreePageSchema.parse({
    entries: [
      worktree,
      { ...worktree, worktree_id: 'other-tree', branch: 'other-branch', kind: 'external' },
    ],
    cursor: null,
    incomplete: false,
    omissions: [],
  })
  const revision = RepositoryObservationSchema.parse({
    revision: {
      kind: 'working',
      observation_id: 'sample-observation',
      head: tip,
      observed_at: '2026-01-01T00:00:00Z',
    },
    atomic: false,
  }).revision
  const repository = {
    worktrees: vi.fn(async () => page),
    observe: vi.fn(async () => ({ revision, atomic: false })),
    resolve: vi.fn(async () => ({ kind: 'commit', commit: tip })),
    blob: vi.fn(async () =>
      RepositoryBlobSchema.parse({
        size: 3,
        content_id: hash,
        binary: false,
        requires_larger_load: false,
        too_large: false,
      })
    ),
    content: vi.fn(async () =>
      ContentChunkSchema.parse({ offset: 0, total: 3, base64: btoa('old') })
    ),
    status: vi.fn(async () =>
      RepositoryStatusPageSchema.parse({
        entries: [{ path: 'sample.txt', index: 'M', worktree: 'M' }],
        cursor: null,
        incomplete: false,
        omissions: [],
      })
    ),
    refs: vi.fn(async () =>
      RepositoryRefsPageSchema.parse({
        entries: [{ name: 'sample-branch', commit: tip, symbolic: null }],
        default_branch: 'sample-branch',
        cursor: null,
        incomplete: false,
        omissions: [],
      })
    ),
    compare: vi.fn(async () =>
      RepositoryComparisonSchema.parse({
        comparison_id: 'sample-comparison',
        base: { kind: 'commit', commit: tip },
        head: revision,
        mode: 'unstaged',
        entries: [{ path: 'sample.txt', status: 'M' }],
        cursor: null,
        incomplete: false,
        omissions: [],
      })
    ),
    patch: vi.fn(async () =>
      RepositoryBlobSchema.parse({
        size: 3,
        content_id: hash,
        binary: false,
        requires_larger_load: false,
        too_large: false,
      })
    ),
  }
  fixture.client.getProject.mockResolvedValue({
    ...project,
    repository_path: '/sample',
    git_common_dir: '/sample/.git',
  })
  Object.assign(fixture.client, { repository })
  const call = (name: string, params: Record<string, unknown> = {}, approved = false) =>
    fixture.call(name, { target_kind: 'worktree', workspace: 'sample-tree', ...params }, approved)
  return { ...fixture, call, repository, revision }
}

describe('Obsidian chat node tools', () => {
  it('reads exact plain-folder content without an open human tab', async () => {
    const { call } = setup()
    const result = await call('node_read', { path: 'sample.txt' })
    expect(result.content[0].text).toContain('old')
    expect(result.content[0].text).toContain(hash)
  })
  it('preserves a UTF-8 BOM when retaining exact file content identities', async () => {
    const { call, client } = setup()
    const value = '\ufeffold',
      bytes = new TextEncoder().encode(value)
    client.readFile.mockResolvedValue({
      ...(await client.readFile()),
      size: bytes.length,
      content_id: digest(value),
    })
    client.readContent.mockResolvedValue({
      offset: 0,
      total: bytes.length,
      base64: btoa(String.fromCharCode(...bytes)),
    })
    expect(JSON.parse((await call('node_read', { path: 'sample.txt' })).content[0].text).text).toBe(
      value
    )
  })
  it('requires an explicit node_write text argument and never treats omission as an empty edit', async () => {
    const { call, client, factory } = setup()
    await expect(
      call('node_write', { path: 'sample.txt', expected_content_id: hash })
    ).rejects.toThrow()
    expect(client.writeFile).not.toHaveBeenCalled()
    expect(
      createNodeAgentTools(factory).find((tool) => tool.name === 'node_write')!.parameters.required
    ).toContain('text')
  })
  it('accepts an explicit empty node_write string as an intentional empty-file edit', async () => {
    const { call, client } = setup()
    client.fileMutationResult.mockResolvedValueOnce({
      ...(await client.fileMutationResult()),
      content_id: digest(''),
    })
    expect(
      (await call('node_write', { path: 'sample.txt', expected_content_id: hash, text: '' }))
        .details
    ).toMatchObject({ diff: { old: 'old', new: '' }, state: 'saved' })
  })
  it('writes immediately with exact preconditions and a retained chat Diff', async () => {
    const { call, client } = setup()
    const result = await call('node_edit', {
      path: 'sample.txt',
      expected_content_id: hash,
      old_text: 'old',
      new_text: 'new',
    })
    expect(client.writeFile).toHaveBeenCalledWith(
      {
        workspace_id: workspace.workspace_id,
        path: 'sample.txt',
        expected_content_id: hash,
        text: 'new',
      },
      'sample-write'
    )
    expect(result.details).toMatchObject({
      operation_id: 'sample-write',
      diff: { old: 'old', new: 'new' },
      state: 'saved',
    })
  })
  it('asks in confirm-all, rejects stale text and never labels an operation ID as saved', async () => {
    const { call, client } = setup('confirm-all')
    const params = { path: 'sample.txt', expected_content_id: hash, text: 'new' }
    await expect(call('node_write', params)).rejects.toThrow(/approval/)
    await expect(
      call('node_write', { ...params, expected_content_id: 'c'.repeat(64) }, true)
    ).rejects.toThrow(/content|changed/)
    expect(client.writeFile).not.toHaveBeenCalled()
    client.fileMutationResult.mockResolvedValueOnce(undefined!)
    const result = await call('node_write', params, true)
    expect(result.details).not.toHaveProperty('diff')
    expect(result.content[0].text).toMatch(/pending|unknown/)
  })
  it('fences bytes and writes after revocation or principal replacement during a read', async () => {
    const { call, client, session, ledger } = setup()
    client.readContent.mockImplementationOnce(async () => {
      ledger.revoke(session)
      return { offset: 0, total: 3, base64: btoa('old') }
    })
    await expect(call('node_read', { path: 'sample.txt' })).rejects.toThrow(/revoked|approval/)
    expect(client.writeFile).not.toHaveBeenCalled()
  })
  it('does not admit offline writes, traversal, or expansion by switching selection', async () => {
    const { call, client } = setup()
    await expect(call('node_read', { path: '../sample.txt' })).rejects.toThrow()
    client.connected = false
    await expect(
      call('node_write', { path: 'sample.txt', text: 'new', expected_content_id: hash })
    ).rejects.toThrow(/offline/i)
    expect(client.writeFile).not.toHaveBeenCalled()
  })
  it('lists plain-folder entries and replaces all exact matches without changing the target', async () => {
    const { call, client } = setup()
    Object.assign(client, {
      listFiles: vi.fn(async () =>
        FilePageSchema.parse({
          entries: [{ name: 'sample.txt', path: 'sample.txt', kind: 'file', size: 7 }],
          next: null,
        })
      ),
    })
    expect((await call('node_ls')).content[0].text).toContain('sample.txt')
    const value = 'old old',
      expected = digest(value)
    client.readFile.mockResolvedValue({
      ...(await client.readFile()),
      size: value.length,
      content_id: expected,
    })
    client.readContent.mockResolvedValue({ offset: 0, total: value.length, base64: btoa(value) })
    client.fileMutationResult.mockResolvedValue({
      ...(await client.fileMutationResult()),
      expected_content_id: expected,
      predecessor_content_id: expected,
      content_id: digest('new new'),
    })
    const result = await call('node_replace', {
      path: 'sample.txt',
      expected_content_id: expected,
      old_text: 'old',
      new_text: 'new',
    })
    expect(result.details).toMatchObject({ diff: { old: value, new: 'new new' } })
    expect(client.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: workspace.workspace_id,
        text: 'new new',
        expected_content_id: expected,
      }),
      'sample-write'
    )
  })
  it('reads Git history and blame and writes Git text through exact typed receipts', async () => {
    const { call, repository } = setupGit()
    const tip = '1'.repeat(40)
    Object.assign(repository, {
      history: vi.fn(async () =>
        RepositoryHistoryPageSchema.parse({
          entries: [
            {
              commit: tip,
              parents: [],
              author: 'Example author',
              email: 'sample@example.invalid',
              authored_at: '2026-01-01T00:00:00Z',
              subject: 'Sample change',
              message: 'Sample change',
            },
          ],
          cursor: null,
          incomplete: false,
          omissions: [],
        })
      ),
      blame: vi.fn(async () =>
        RepositoryBlameSchema.parse({
          content_id: hash,
          entries: [
            { line: 1, original_line: 1, commit: tip, author: 'Example author', text: 'old' },
          ],
          cursor: null,
          incomplete: false,
          omissions: [],
        })
      ),
      write: vi.fn(async () => ({ operation_id: 'sample-git-write' })),
      mutationResult: vi.fn(async () =>
        RepositoryMutationResultSchema.parse({
          operation_id: 'sample-git-write',
          worktree_id: 'sample-tree',
          path: 'sample.txt',
          expected_content_id: hash,
          predecessor_content_id: hash,
          content_id: digest('new'),
          state: 'saved',
          recovery_path: null,
        })
      ),
    })
    expect((await call('node_git_log')).content[0].text).toContain('Sample change')
    expect(
      (await call('node_git_blame', { path: 'sample.txt', start: 1, count: 10 })).content[0].text
    ).toContain('Example author')
    expect(
      (await call('node_write', { path: 'sample.txt', expected_content_id: hash, text: 'new' }))
        .details
    ).toMatchObject({ state: 'saved', diff: { old: 'old', new: 'new' } })
  })
  it('enumerates Git worktrees without selection or a tab and filters target-only scope', async () => {
    const { session, ledger, call } = setupGit()
    session.overrides.value.nodeScope = [
      {
        kind: 'target',
        node_id: 'sample-node',
        project_id: project.project_id,
        target: { kind: 'worktree', worktree_id: 'sample-tree' },
        access: 'read',
      },
    ]
    ledger.approve(session, { 'sample-node': 'sample-pin:0' })
    const result = await call('list_node_worktrees', { workspace: '' })
    expect(
      JSON.parse(result.content[0].text).entries.map(
        (entry: { worktree_id: string }) => entry.worktree_id
      )
    ).toEqual(['sample-tree'])
    await expect(call('node_worktree_switch', { workspace: 'other-tree' })).rejects.toThrow(
      /scope|approval/
    )
    expect(session.noteNodeWorktreeSwitch).not.toHaveBeenCalled()
  })
  it('pins Git file reads, status and diff to one observed revision', async () => {
    const { call, repository, revision } = setupGit()
    expect((await call('node_read', { path: 'sample.txt' })).content[0].text).toContain(hash)
    await call('node_git_status')
    expect(repository.status).toHaveBeenCalledWith(
      expect.objectContaining({ revision, worktree_id: 'sample-tree' })
    )
    const diff = await call('node_git_diff', { path: 'sample.txt', mode: 'unstaged' })
    expect(repository.patch).toHaveBeenCalledWith({
      worktree_id: 'sample-tree',
      comparison_id: 'sample-comparison',
      path: 'sample.txt',
    })
    expect(JSON.parse(diff.content[0].text).patch).toBe('old')
  })
  it('uses a protocol-gated empty base for unborn Git instead of inventing a commit', async () => {
    const { call, client, repository, revision } = setupGit()
    const unborn = { ...revision, head: null }
    repository.observe.mockResolvedValue({ revision: unborn, atomic: false })
    client.describe.mockResolvedValue({
      node_id: 'sample-node',
      capabilities: {
        capabilities: { node_path_v2: { status: 'supported', evidence: 'sample schema fixture' } },
      },
    } as never)
    const comparison = {
      comparison_id: 'sample-unborn',
      base: { kind: 'empty' },
      head: unborn,
      mode: 'unstaged',
      entries: [{ path: 'sample.txt', status: 'A' }],
      cursor: null,
      incomplete: false,
      omissions: [],
    }
    const parsed = RepositoryComparisonSchema.safeParse(comparison)
    if (!parsed.success) await expect(call('node_git_diff')).rejects.toThrow(/unborn|update/)
    else {
      repository.compare.mockResolvedValue(parsed.data)
      const result = JSON.parse((await call('node_git_diff')).content[0].text)
      expect(result.base).toEqual({ kind: 'empty' })
      expect(repository.compare).toHaveBeenCalledWith(
        expect.objectContaining({ base: { kind: 'empty' }, head: unborn })
      )
    }
    expect(repository.resolve).not.toHaveBeenCalled()
  })
  it('fully paginates branch reads and preserves catalogue metadata', async () => {
    const { call, repository } = setupGit()
    const first = await repository.refs()
    repository.refs
      .mockResolvedValueOnce({ ...first, cursor: 'sample-next' })
      .mockResolvedValueOnce({ ...first, entries: [{ ...first.entries[0], name: 'other-branch' }] })
    const result = JSON.parse((await call('node_git_branches')).content[0].text)
    expect(result.entries).toHaveLength(2)
    expect(result.default_branch).toBe('sample-branch')
    expect(repository.refs).toHaveBeenLastCalledWith({
      worktree_id: 'sample-tree',
      cursor: 'sample-next',
    })
  })
  it('switches only this Obsidian chat within one scoped folder and records a line', async () => {
    const { call, session } = setupGit()
    await call('node_worktree_switch', { workspace: 'other-tree' })
    expect(session.overrides.value.nodeTarget).toMatchObject({
      target: { kind: 'worktree', worktree_id: 'other-tree' },
    })
    expect(session.noteNodeWorktreeSwitch).toHaveBeenCalledWith('other-branch')
    expect(session.saveForRelease).toHaveBeenCalled()
    await expect(call('node_worktree_switch', { project: 'other-project' })).rejects.toThrow()
  })
  it('never grants scope from an approved generic call or leaks unrelated catalogue entries', async () => {
    const { call, session, ledger, client } = setup()
    client.listProjects.mockResolvedValue([
      project,
      { ...project, project_id: 'private-project', root_path: '/private-sample' },
    ])
    const result = await call('node_folders')
    expect(result.content[0].text).not.toContain('private-project')
    ledger.revoke(session)
    await expect(call('node_read', { path: 'sample.txt', approved: true }, true)).rejects.toThrow(
      /approval/
    )
  })
  it('fences retained read continuations after scope revocation, replacement and branch switches', async () => {
    const { call, client, session, ledger, principal } = setup()
    const value = 'sample '.repeat(8000),
      bytes = new TextEncoder().encode(value)
    client.readFile.mockResolvedValue({
      ...(await client.readFile()),
      content_id: digest(value),
      size: bytes.length,
    })
    client.readContent.mockResolvedValue(
      ContentChunkSchema.parse({ offset: 0, total: bytes.length, base64: btoa(value) })
    )
    const first = await call('node_read', { path: 'sample.txt' })
    const cursor = (first.details as { cursor: string }).cursor
    expect(cursor).toBeTruthy()
    session.branchSelectionVersion++
    await expect(call('node_read', { cursor })).rejects.toThrow()
    session.branchSelectionVersion--
    ledger.revoke(session)
    ledger.approve(session, { 'sample-node': 'sample-pin:0' })
    await expect(call('node_read', { cursor })).rejects.toThrow()
    principal('replacement-pin:0')
    await expect(call('node_read', { path: 'sample.txt' })).rejects.toThrow()
  })
  it('fences retained read continuations on reauthorization without changing the durable principal', async () => {
    const { call, client, advanceGeneration } = setup()
    vi.mocked(client.listProjects).mockImplementation(async () =>
      Array.from({ length: 99 }, (_, index) => ({
        ...project,
        root_path: `sample-${index}-${'x'.repeat(512)}`,
      }))
    )
    const first = await call('node_folders')
    const cursor = (first.details as { cursor: string }).cursor
    expect(cursor).toBeTruthy()
    advanceGeneration()
    await expect(call('node_folders', { cursor })).rejects.toThrow(/approval|identity/)
  })

  it('fences node enumeration when reauthorization occurs during describe', async () => {
    const { call, client, advanceGeneration } = setup()
    vi.mocked(client.describe).mockImplementation(async () => {
      advanceGeneration()
      return { node_id: 'sample-node', capabilities: { capabilities: {} } }
    })
    await expect(call('node_nodes')).rejects.toThrow(/approval|identity/)
  })

  it('can resume a retained read after the chat rebuilds its toolset for the next turn', async () => {
    const { call, client, session, factory } = setup()
    const value = 'sample '.repeat(8000),
      bytes = new TextEncoder().encode(value)
    client.readFile.mockResolvedValue({
      ...(await client.readFile()),
      content_id: digest(value),
      size: bytes.length,
    })
    client.readContent.mockResolvedValue({ offset: 0, total: bytes.length, base64: btoa(value) })
    const result = await call('node_read', { path: 'sample.txt' })
    const cursor = (result.details as { cursor: string }).cursor
    const next = createNodeAgentTools(factory).find((tool) => tool.name === 'node_read')!
    expect(
      (await next.execute('sample-next-call', { cursor }, undefined, { session })).content[0].text
    ).toContain('sample')
  })
  it('rechecks a stricter permission mode before mutation admission', async () => {
    const { call, client, session } = setup()
    client.readContent.mockImplementationOnce(async () => {
      session.permissionMode.value = 'confirm-all'
      return { offset: 0, total: 3, base64: btoa('old') }
    })
    await expect(
      call('node_write', { path: 'sample.txt', expected_content_id: hash, text: 'new' })
    ).rejects.toThrow(/approval/)
    expect(client.writeFile).not.toHaveBeenCalled()
  })
  it('conflict/unknown receipts render no saved Diff and are never retried', async () => {
    const { call, client } = setup()
    const receipt = await client.fileMutationResult()
    for (const state of ['conflict', 'outcome_unknown'] as const) {
      client.fileMutationResult.mockResolvedValueOnce({ ...receipt, state })
      const result = await call('node_write', {
        path: 'sample.txt',
        expected_content_id: hash,
        text: 'new',
      })
      expect(result.details).not.toHaveProperty('diff')
      expect(result.content[0].text).toContain(state)
    }
    expect(client.writeFile).toHaveBeenCalledTimes(2)
  })
  it('dispatches supported file operations through the schema-validated NodePathClient and never widens authority', async () => {
    const { call, client } = setup('allow-all')
    const owner = new NodeClient(
      { url: 'ws://127.0.0.1:1/channel', profile: 'local-token-v1', token: 'sample-token' },
      new MemoryClientStore()
    )
    const nodePath = Reflect.get(owner, 'nodePath')
    if (!nodePath) {
      await expect(
        call('node_cp', { from: 'sample.txt', to: 'copy.txt', expected_content_id: hash })
      ).rejects.toThrow(/does not support/)
      return
    }
    const schemas = Reflect.get(protocol, 'NodePathMethodSchemas') as Record<
      string,
      { parse(value: unknown): unknown }
    >
    const calls: { method: string; params: unknown }[] = []
    vi.spyOn(
      owner as unknown as {
        mutation(method: string, params: unknown, operation?: string): Promise<unknown>
      },
      'mutation'
    ).mockImplementation(async (method, params, operation) => {
      calls.push({ method, params: schemas[method].parse(params) })
      return {
        operation_id: operation ?? 'sample-operation',
        state: 'applied',
        recovery_path: null,
      }
    })
    Object.assign(client, { nodePath })
    const capabilities = {
      node_path_file_operations: { status: 'supported', evidence: 'sample schema fixture' },
      node_path_v2: { status: 'supported', evidence: 'sample schema fixture' },
    }
    client.describe.mockResolvedValue({
      node_id: 'sample-node',
      capabilities: { capabilities },
    } as never)
    for (const name of ['node_mv', 'node_cp', 'node_rm']) {
      const result = await call(name, {
        from: 'sample.txt',
        to: 'copy.txt',
        path: 'sample.txt',
        expected_content_id: hash,
      })
      expect(result.details).toHaveProperty('diff')
    }
    expect(calls.map((call) => call.method)).toEqual([
      'workspace.file.move',
      'workspace.file.copy',
      'workspace.file.remove',
    ])
    expect(calls[0].params).toEqual({
      workspace_id: workspace.workspace_id,
      from: 'sample.txt',
      to: 'copy.txt',
      expected_content_id: hash,
    })
    let searchPage = 0
    const searches: unknown[] = []
    vi.spyOn(owner, 'request').mockImplementation(async (method, params) => {
      expect(method).toBe('workspace.search')
      searches.push(schemas[method].parse(params))
      return RepositorySearchPageSchema.parse({
        entries: [{ path: 'sample.txt', line: ++searchPage, text: 'old', content_id: hash }],
        cursor: searchPage === 1 ? 'sample-next' : null,
        incomplete: false,
        omissions: [],
      })
    })
    const search = await call('node_search', { query: 'old', mode: 'regex' })
    expect(JSON.parse(search.content[0].text).entries).toHaveLength(2)
    expect(searches[1]).toMatchObject({
      workspace_id: workspace.workspace_id,
      cursor: 'sample-next',
      mode: 'regex',
    })
    client.describe.mockResolvedValue({
      node_id: 'sample-node',
      capabilities: { capabilities: {} },
    })
    await expect(
      call('node_cp', { from: 'sample.txt', to: 'copy.txt', expected_content_id: hash })
    ).rejects.toThrow(/does not support/)
    expect(calls).toHaveLength(3)
  })
  it('fails explicitly when a new file operation is unsupported instead of using owner RPC or shell', async () => {
    const { call, client } = setup('allow-all')
    await expect(
      call('node_mv', { from: 'sample.txt', to: 'copy.txt', expected_content_id: hash })
    ).rejects.toThrow(/does not support/)
    expect(client.writeFile).not.toHaveBeenCalled()
  })
})

describe('what the node file tools tell a model that cannot reach a file yet', () => {
  const none = { node: undefined, project: undefined, workspace: undefined, target_kind: undefined }
  it('says how the person gives this chat node access when it has none', async () => {
    const { call, session } = setup()
    session.overrides.value = {}
    const nodes = await call('node_nodes')
    expect(nodes.content[0].text).toMatch(/no node access/i)
    expect(nodes.content[0].text).toContain('Give the Obsidian chat access')
    await expect(call('node_read', { path: 'sample.txt' })).rejects.toThrow(
      /Give the Obsidian chat access/
    )
    await expect(call('node_folders', { node: 'sample-node' })).rejects.toThrow(
      /Give the Obsidian chat access/
    )
  })
  it('says the access needs approving on this device when it arrived with the chat', async () => {
    const { call, session, ledger } = setup()
    ledger.revoke(session)
    expect((await call('node_nodes')).content[0].text).toMatch(/Approve on this device/)
  })
  it('reads from the one target this chat was given when the call names none', async () => {
    const { call, session, ledger } = setup()
    session.overrides.value = {
      nodeScope: [
        {
          kind: 'target',
          node_id: 'sample-node',
          project_id: project.project_id,
          target: { kind: 'workspace', workspace_id: workspace.workspace_id },
          access: 'edit',
        },
      ],
    }
    ledger.approve(session, { 'sample-node': 'sample-pin:0' })
    const read = await call('node_read', { ...none, path: 'sample.txt' })
    expect(JSON.parse(read.content[0].text)).toMatchObject({ text: 'old', content_id: hash })
  })
  it('points at node_folders when the call names no target and the chat may reach several', async () => {
    const { call } = setup()
    await expect(call('node_read', { ...none, path: 'sample.txt' })).rejects.toThrow(/node_folders/)
  })
  it('describes each tool by what it does rather than one text shared by all of them', () => {
    const tools = createNodeAgentTools(() => setup().host)
    const descriptions = new Set(tools.map((tool) => tool.description))
    expect(descriptions.size).toBe(tools.length)
    for (const tool of tools) expect(tool.description).toMatch(/node_folders|node access/i)
  })
  it("reads the worktree a Git folder's workspace ID belongs to, the ID node_folders also shows", async () => {
    const { call, repository } = setupGit()
    const read = await call('node_read', { workspace: workspace.workspace_id, path: 'sample.txt' })
    expect(JSON.parse(read.content[0].text)).toMatchObject({ text: 'old' })
    expect(repository.blob).toHaveBeenCalledWith(
      expect.objectContaining({ worktree_id: 'sample-tree' })
    )
  })
  it('reads a plain folder when the call names its workspace but keeps the default worktree kind', async () => {
    const { call } = setup()
    const read = await call('node_read', { target_kind: undefined, path: 'sample.txt' })
    expect(JSON.parse(read.content[0].text)).toMatchObject({ text: 'old' })
  })
  it('names the worktrees this chat may use when the call names one outside the folder', async () => {
    const { call } = setupGit()
    const failure = call('node_read', { workspace: 'unknown-tree', path: 'sample.txt' })
    await expect(failure).rejects.toThrow(/sample-tree/)
    await expect(call('node_read', { workspace: 'unknown-tree', path: 'x' })).rejects.toThrow(
      /node_folders/
    )
  })
})
