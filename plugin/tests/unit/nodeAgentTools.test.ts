import { describe, it, expect, vi } from 'vitest'
import {
  ContentChunkSchema,
  RepositoryComparisonSchema,
  RepositoryHistoryPageSchema,
  RepositoryBlameSchema,
  FilePageSchema,
  RepositoryMutationResultSchema,
  RepositorySearchPageSchema,
} from '@abele/node-protocol'
import * as protocol from '@abele/node-protocol'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { createNodeAgentTools } from '@/ai/tools/node/agent'
import { nodeMutationKey } from '@/ai/tools/node/mutations'
import { digest, hash, project, workspace, setup, setupGit } from '../helpers/nodeAgentFixture'

describe('Obsidian chat node tools', () => {
  it('never replaces an unresolved legacy commit with a newly scoped operation', async () => {
    const f = setupGit()
    f.session.permissionMode.value = 'allow-all'
    const commit = vi.fn()
    Object.assign(f.repository, { git: { commit } })
    await f.client.store.transaction((s) => {
      s.outbox.push({
        operation_id: 'sample-legacy',
        method: 'repository.v1.git.commit',
        params: {
          worktree_id: 'sample-tree',
          expected_head: '1'.repeat(40),
          message: 'Sample change',
        },
      })
    })
    await expect(
      f.call('node_git_commit', {
        operation_id: 'sample-legacy',
        expected_head: '1'.repeat(40),
        message: 'Sample change',
      })
    ).rejects.toThrow(/earlier request.*unresolved/i)
    expect(commit).not.toHaveBeenCalled()
  })
  it('commits without a preliminary approval in bypass while retaining folder trust checks', async () => {
    const f = setupGit()
    f.session.permissionMode.value = 'allow-all'
    const configuredProject = await f.client.getProject()
    Object.assign(f.client, {
      getProject: vi.fn(async () => ({ ...configuredProject, trust: 'trusted' })),
    })
    const commit = vi.fn(async () => ({ state: 'committed', commit: '2'.repeat(40) }))
    Object.assign(f.repository, { git: { commit } })
    await f.call('node_git_commit', {
      message: 'Fix sample parser',
      expected_head: '1'.repeat(40),
      operation_id: 'sample-bypass-commit',
    })
    expect(commit).toHaveBeenCalledOnce()
  })
  it('requires folder trust before a manager commit can execute project hooks', async () => {
    const f = setupGit()
    const commit = vi.fn(async () => ({ state: 'committed', commit: '2'.repeat(40) }))
    Object.assign(f.repository, { git: { commit } })
    await expect(
      f.call(
        'node_git_commit',
        {
          message: 'Fix sample parser',
          expected_head: '1'.repeat(40),
          operation_id: 'sample-commit',
        },
        true
      )
    ).rejects.toThrow(/trust/i)
    expect(commit).not.toHaveBeenCalled()
  })
  it('rechecks node approval after awaiting inherited read authority before issuing a request', async () => {
    const f = setupGit()
    f.session.overrides.value.nodeScope = [
      {
        kind: 'target',
        node_id: 'sample-node',
        project_id: project.project_id,
        target: { kind: 'worktree', worktree_id: 'other-tree' },
        access: 'read',
      },
    ]
    f.ledger.approve(f.session, { 'sample-node': 'sample-pin:0' })
    Object.assign(f.host, {
      childReadGuard: async () => async () => {
        f.ledger.revoke(f.session)
      },
    })
    await expect(f.call('node_read', { path: 'sample.txt' })).rejects.toThrow(/revoked|approval/)
    expect(f.client.getProject).not.toHaveBeenCalled()
  })
  it('returns a retained removal receipt after the worktree disappeared without repeating deletion', async () => {
    const f = setupGit()
    const remove = vi.fn()
    Object.assign(f.client, {
      nodePath: { deleteWorktree: remove },
      operationResult: async () => ({
        request: {
          method: 'repository.v1.worktree.delete',
          params: {
            worktree_id: 'sample-tree',
            expected_head: '1'.repeat(40),
            expected_observation_id: 'sample-observation',
          },
        },
        result: { state: 'deleted', worktree_id: 'sample-tree' },
      }),
    })
    f.repository.worktrees.mockResolvedValue({
      entries: [],
      cursor: null,
      incomplete: false,
      omissions: [],
    })
    const result = await f.call(
      'node_worktree_remove',
      {
        expected_head: '1'.repeat(40),
        expected_observation_id: 'sample-observation',
        operation_id: 'sample-remove',
      },
      true
    )
    expect(result.content[0].text).toContain('deleted')
    expect(remove).not.toHaveBeenCalled()
  })
  it('reviews an inherited child target read-only and fences its retained bytes on revocation', async () => {
    const f = setupGit()
    f.session.overrides.value.nodeScope = [
      {
        kind: 'target',
        node_id: 'sample-node',
        project_id: project.project_id,
        target: { kind: 'worktree', worktree_id: 'other-tree' },
        access: 'edit',
      },
    ]
    f.ledger.approve(f.session, { 'sample-node': 'sample-pin:0' })
    let revoked = false
    const childReadGuard = vi.fn(async () => async () => {
      if (revoked) throw new Error('Child read grant revoked')
    })
    Object.assign(f.host, { childReadGuard })
    expect((await f.call('node_read', { path: 'sample.txt' })).content[0].text).toContain('old')
    await expect(
      f.call('node_write', { path: 'sample.txt', text: 'new', expected_content_id: hash }, true)
    ).rejects.toThrow()
    f.repository.content.mockImplementationOnce(async () => {
      revoked = true
      return ContentChunkSchema.parse({ offset: 0, total: 3, base64: btoa('old') })
    })
    await expect(f.call('node_read', { path: 'sample.txt' })).rejects.toThrow(/revoked/)
  })
  it('removes only a clean managed developer worktree after approval with exact preconditions', async () => {
    const f = setupGit()
    const remove = vi.fn(async () => ({ state: 'deleted', worktree_id: 'sample-tree' }))
    Object.assign(f.client, { nodePath: { deleteWorktree: remove } })
    const args = {
      expected_head: '1'.repeat(40),
      expected_observation_id: 'sample-observation',
      operation_id: 'sample-remove',
    }
    await expect(f.call('node_worktree_remove', args, true)).rejects.toThrow(/managed|clean/)
    expect(remove).not.toHaveBeenCalled()
    const catalogue = await f.repository.worktrees()
    f.repository.worktrees.mockResolvedValue({
      ...catalogue,
      entries: [{ ...catalogue.entries[0], kind: 'managed', dirty: false }],
    })
    await expect(f.call('node_worktree_remove', args)).rejects.toThrow(/approval/)
    await f.call('node_worktree_remove', args, true)
    expect(remove).toHaveBeenCalledWith(
      {
        worktree_id: 'sample-tree',
        expected_head: '1'.repeat(40),
        expected_observation_id: 'sample-observation',
      },
      nodeMutationKey(
        'sample-chat',
        'node_worktree_remove',
        {
          target: {
            node_id: 'sample-node',
            project_id: project.project_id,
            target: { kind: 'worktree', worktree_id: 'sample-tree' },
          },
          alias: args.operation_id,
        },
        {
          node: 'sample-node',
          project: project.project_id,
          workspace: 'sample-tree',
          target_kind: 'worktree',
          expected_head: args.expected_head,
          expected_observation_id: args.expected_observation_id,
        }
      )
    )
  })
  it('commits staged work only after explicit owner approval, preserving the operation and head', async () => {
    const f = setupGit()
    f.client.getProject.mockResolvedValue({ ...(await f.client.getProject()), trust: 'trusted' })
    const commit = vi.fn(async () => ({ state: 'committed', commit: '2'.repeat(40) }))
    Object.assign(f.repository, { git: { commit } })
    const args = {
      message: 'Fix sample parser',
      expected_head: '1'.repeat(40),
      operation_id: 'sample-commit',
    }
    expect(JSON.parse((await f.call('node_git_status')).content[0].text).revision).toMatchObject({
      head: '1'.repeat(40),
      observation_id: 'sample-observation',
    })
    await expect(f.call('node_git_commit', args)).rejects.toThrow(/approval/)
    expect(commit).not.toHaveBeenCalled()
    await f.call('node_git_commit', args, true)
    expect(commit).toHaveBeenCalledWith(
      { worktree_id: 'sample-tree', expected_head: '1'.repeat(40), message: 'Fix sample parser' },
      nodeMutationKey(
        'sample-chat',
        'node_git_commit',
        {
          target: {
            node_id: 'sample-node',
            project_id: project.project_id,
            target: { kind: 'worktree', worktree_id: 'sample-tree' },
          },
          alias: args.operation_id,
        },
        {
          node: 'sample-node',
          project: project.project_id,
          workspace: 'sample-tree',
          target_kind: 'worktree',
          expected_head: args.expected_head,
          message: args.message,
        }
      )
    )
    f.session.overrides.value.nodeScope![0].access = 'read'
    f.ledger.approve(f.session, { 'sample-node': 'sample-pin:0' })
    await expect(f.call('node_git_commit', args, true)).rejects.toThrow()
    expect(commit).toHaveBeenCalledTimes(1)
  })
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
  it('reads one bounded history page and continues only when asked', async () => {
    const { call, repository } = setupGit()
    const batch = { entries: [], cursor: 'history-next', incomplete: false, omissions: [] }
    Object.assign(repository, {
      history: vi
        .fn()
        .mockResolvedValueOnce(batch)
        .mockResolvedValueOnce({ ...batch, cursor: null }),
    })
    const first = await call('node_git_log')
    expect(repository.history).toHaveBeenCalledTimes(1)
    expect(repository.history).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50 }))
    expect(first.details?.cursor).toEqual(expect.any(String))
    await call('node_git_log', { cursor: first.details!.cursor })
    expect(repository.history).toHaveBeenCalledTimes(2)
    expect(repository.history).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 50, cursor: 'history-next' })
    )
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
    expect(nodes.content[0].text).toContain('Give a chat access')
    await expect(call('node_read', { path: 'sample.txt' })).rejects.toThrow(/Give a chat access/)
    await expect(call('node_folders', { node: 'sample-node' })).rejects.toThrow(
      /Give a chat access/
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
  it("asks the node nothing about a folder outside this chat's node access", async () => {
    const { call, client } = setupGit()
    client.getProject.mockClear()
    await expect(
      call('node_read', { project: 'other-project', path: 'sample.txt' })
    ).rejects.toThrow(/node_folders/)
    expect(client.getProject).not.toHaveBeenCalled()
  })
})
