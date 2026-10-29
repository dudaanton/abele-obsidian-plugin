import { describe, expect, it, vi } from 'vitest'
import { ChannelError } from '@abele/channel-protocol'
import { NodePathClient, RepositoryClient, MemoryClientStore } from '@abele/node-client'
import { ProjectSchema, SessionSchema, WorkspaceSchema } from '@abele/node-protocol'
import { NodePathClientPort, reverseNodePatch } from '@/node/NodePathClientPort'
import { nodeRepositoryFixture, identity, HEAD, BASE } from '../helpers/nodeRepositoryFixture'
import { NodePathHistoryModel } from '@/node/NodePathHistoryModel'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveNodeCodeLink } from '@/node/codeLinks'

const project = ProjectSchema.parse({
  project_id: identity.project,
  root_path: '/sample/repo',
  repository_path: '/sample/repo',
  git_common_dir: '/sample/repo/.git',
  trust: 'untrusted',
  use_repository_claude_permissions: false,
  created_at: '2025-01-01T00:00:00.000Z',
})
const session = SessionSchema.parse({
  session_id: 'session-demo',
  title: 'Demo chat',
  provider: 'fake',
  workspace_id: 'workspace-fixture',
  created_at: '2025-01-01T00:00:00.000Z',
})
const workspace = WorkspaceSchema.parse({
  workspace_id: 'workspace-fixture',
  project_id: identity.project,
  kind: 'root',
  path: '/sample/repo',
  branch: 'main',
  base_commit: null,
  state: 'ready',
  created_at: '2025-01-01T00:00:00.000Z',
  provenance: {
    node_id: identity.node,
    installation_id: identity.installation,
    operation_id: 'operation-demo',
  },
})
function fake() {
  const f = nodeRepositoryFixture()
  const client = {
    ...f.client,
    store: new MemoryClientStore(),
    describe: vi.fn(async () => ({})),
    nodePath: new NodePathClient(f.request, async () => {
      throw new Error('No mutation in this read fixture')
    }),
    listProjects: vi.fn(async (after?: string) => (after ? [] : [project])),
    listSessions: vi.fn(async (after?: string) => (after ? [] : [session])),
    listWorkspaces: vi.fn(async (_project: string, after?: string) => (after ? [] : [workspace])),
    listFiles: vi.fn(),
    readFile: vi.fn(),
    readContent: vi.fn(),
  }
  const port = new NodePathClientPort(client, {
    nodeId: identity.node,
    registrationId: identity.installation,
  })
  return { ...f, client, port }
}
describe('validated node path reads', () => {
  it.each(['rebase', 'merge', 'cherry-pick', 'detached'])(
    'opens a chat citation from working bytes during %s',
    async (operation) => {
      const root = mkdtempSync(join(tmpdir(), 'code-link-'))
      const env = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
        ),
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      }
      const git = (...args: string[]) =>
        execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: 'pipe' }).trim()
      try {
        git('init', '-b', 'main')
        git('config', 'user.name', 'Sample')
        git('config', 'user.email', 'sample@example.invalid')
        git('config', 'commit.gpgsign', 'false')
        writeFileSync(join(root, 'app.ts'), 'base\n')
        git('add', 'app.ts')
        git('commit', '-m', 'Initial sample')
        git('checkout', '-b', 'topic')
        writeFileSync(join(root, 'app.ts'), 'topic\n')
        git('commit', '-am', 'Topic sample')
        git('checkout', 'main')
        writeFileSync(join(root, 'app.ts'), 'main\n')
        git('commit', '-am', 'Main sample')
        if (operation === 'detached') git('checkout', '--detach')
        else {
          const args = operation === 'rebase' ? ['rebase', 'main'] : [operation, 'topic']
          if (operation === 'rebase') git('checkout', 'topic')
          expect(() => git(...args)).toThrow()
          expect(git('status', '--porcelain')).toContain('UU app.ts')
          const marker =
            operation === 'rebase'
              ? 'rebase-merge'
              : operation === 'merge'
                ? 'MERGE_HEAD'
                : 'CHERRY_PICK_HEAD'
          expect(existsSync(join(root, '.git', marker))).toBe(true)
        }
        const text = readFileSync(join(root, 'app.ts'), 'utf8')
        const { port, client, calls } = fake()
        const worktrees = client.repository.worktrees.bind(client.repository)
        vi.spyOn(client.repository, 'worktrees').mockImplementation(async (params) => {
          const page = await worktrees(params)
          const branch = git('branch', '--show-current')
          page.entries[0] = {
            ...page.entries[0],
            branch: branch ? `refs/heads/${branch}` : null,
            detached: !branch,
            head: git('rev-parse', 'HEAD'),
          }
          return page
        })
        const { targets } = await port.catalogue()
        const target = targets[0]
        const destination = resolveNodeCodeLink('app.ts:1-3', target)!
        expect(destination).toEqual({ path: 'app.ts', line: 1, endLine: 3 })
        vi.spyOn(client.repository, 'status').mockResolvedValue({
          entries: operation === 'detached' ? [] : [{ path: 'app.ts', index: 'U', worktree: 'U' }],
          cursor: null,
          incomplete: false,
          omissions: [],
        })
        const contentId = 'c'.repeat(64)
        vi.spyOn(client.repository, 'blob').mockResolvedValue({
          content_id: contentId,
          size: Buffer.byteLength(text),
          binary: false,
          requires_larger_load: false,
          too_large: false,
        })
        vi.spyOn(client.repository, 'content').mockResolvedValue({
          offset: 0,
          total: Buffer.byteLength(text),
          base64: Buffer.from(text).toString('base64'),
        })
        const file = await port.file(target, destination.path)
        expect(file.text).toBe(text)
        expect(file.change).toBeUndefined()
        expect(file.revision?.kind).toBe('working')
        expect(calls.some((call) => call.method === 'repository.v1.patch')).toBe(false)
        if (operation !== 'detached')
          await expect(port.file(target, destination.path, 'staged')).rejects.toThrow(
            'a single comparison would omit a side'
          )
        expect(readFileSync(join(root, 'app.ts'), 'utf8')).toBe(text)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )
  it('requests canonical worktree identities from new nodes while displaying the branch-named physical folder', async () => {
    const { port, client } = fake()
    Object.assign(client, {
      channel: { channel: { welcome: { methods: ['repository.v1.file.directory'] } } },
    })
    client.describe.mockResolvedValue({
      capabilities: { capabilities: { node_path_v2: { status: 'supported' } } },
    })
    const worktrees = vi.spyOn(client.repository, 'worktrees').mockResolvedValue({
      entries: [
        {
          worktree_id: 'sample-external',
          project_id: project.project_id,
          workspace_id: null,
          kind: 'external',
          path_label: 'repo-topic',
          identity: { canonical_path: '/sample/repo-topic', fingerprint: 'a'.repeat(64) },
          branch: 'refs/heads/topic',
          detached: false,
          head: HEAD,
          availability: 'available',
          locked: false,
          prunable: false,
          dirty: false,
          listed: true,
        },
      ],
      cursor: null,
      incomplete: false,
      omissions: [],
    })
    const catalogue = await port.catalogue()
    expect(worktrees).toHaveBeenCalledWith(expect.objectContaining({ include_identity: true }))
    expect(catalogue.folders[0].copies[0].path).toBe('repo-topic')
    expect(catalogue.targets[0].location?.path).toBe('/sample/repo-topic')
  })
  it('retains an external worktree absolute path for recovery and Copy path separately from its display name', async () => {
    const { port, client } = fake()
    client.describe.mockResolvedValue({
      capabilities: { capabilities: { node_path_v2: { status: 'supported' } } },
    })
    vi.spyOn(client.repository, 'worktrees').mockResolvedValue({
      entries: [
        {
          worktree_id: 'sample-external',
          project_id: project.project_id,
          workspace_id: null,
          kind: 'external',
          path_label: '/sample/12345678-1234-1234-1234-123456789abc',
          branch: 'refs/heads/topic',
          detached: false,
          head: HEAD,
          availability: 'available',
          locked: false,
          prunable: false,
          dirty: false,
          listed: true,
        },
      ],
      cursor: null,
      incomplete: false,
      omissions: [],
    })
    const catalogue = await port.catalogue()
    expect(catalogue.folders[0].copies[0].path).toBe('topic')
    expect(catalogue.targets[0].location).toEqual({
      root: project.root_path,
      path: '/sample/12345678-1234-1234-1234-123456789abc',
      kind: 'external',
    })
  })
  it('opens a committed change against the chosen base without reading working changes', async () => {
    const { port, client, calls } = fake()
    const { targets } = await port.catalogue()
    const compare = vi.spyOn(client.repository, 'compare')
    const blob = client.repository.blob.bind(client.repository)
    vi.spyOn(client.repository, 'blob').mockImplementation((params) =>
      blob({
        ...params,
        revision: {
          kind: 'working',
          head: HEAD,
          observation_id: 'sample',
          observed_at: '2025-01-01T00:00:00Z',
        },
      })
    )
    const result = await port.file(targets[0], 'app.ts', { kind: 'committed', base: 'feature' })
    expect(compare).toHaveBeenCalledWith(
      expect.objectContaining({
        base: { kind: 'commit', commit: BASE },
        head: { kind: 'commit', commit: HEAD },
        mode: 'merge-base',
      })
    )
    expect(result.change).toMatchObject({ kind: 'modified', before: 'export const answer = 1\n' })
    expect(calls.filter((c) => c.method === 'repository.v1.status')).toEqual([])
  })
  it.each([
    ['A', 'added', '', 'new\n', '@@ -0,0 +1 @@\n+new\n'],
    ['D', 'deleted', 'old\n', '', '@@ -1 +0,0 @@\n-old\n'],
    [
      'R100',
      'renamed',
      'same\n',
      'same\n',
      'similarity index 100%\nrename from old.txt\nrename to new.txt\n',
    ],
    ['R90', 'renamed', 'old\n', 'new\n', '@@ -1 +1 @@\n-old\n+new\n'],
  ])(
    'reads a committed %s using HEAD and the captured comparison patch',
    async (status, kind, before, after, patch) => {
      const { port, client } = fake()
      const { targets } = await port.catalogue()
      const compare = client.repository.compare.bind(client.repository)
      vi.spyOn(client.repository, 'compare').mockImplementation(async (params) => ({
        ...(await compare(params)),
        entries: [{ path: 'new.txt', status }],
      }))
      const metadata = (content_id: string) => ({
        content_id,
        size: 10,
        binary: false,
        requires_larger_load: false,
        too_large: false,
      })
      const blob = vi.spyOn(client.repository, 'blob').mockResolvedValue(metadata('file'))
      vi.spyOn(client.repository, 'patch').mockResolvedValue(metadata('patch'))
      vi.spyOn(client.repository, 'content').mockImplementation(async (params) => {
        const text = params.content_id === 'patch' ? patch : after
        return { offset: 0, total: text.length, base64: btoa(text) }
      })
      const result = await port.file(targets[0], 'new.txt', { kind: 'committed', base: 'feature' })
      expect(result.change).toMatchObject({ kind, before, after })
      if (kind === 'deleted') expect(blob).not.toHaveBeenCalled()
      else
        expect(blob).toHaveBeenCalledWith({
          worktree_id: targets[0].id,
          revision: { kind: 'commit', commit: HEAD },
          path: 'new.txt',
        })
    }
  )
  it.each(['repository_unavailable', 'stale_resource'])(
    'retains a registered repository with catalogue error %s as a removable folder without losing other projects',
    async (code) => {
      const { client, port } = fake()
      client.listProjects.mockResolvedValueOnce([
        project,
        { ...project, project_id: 'other-project', repository_path: null },
      ])
      vi.spyOn(client.repository, 'worktrees').mockRejectedValueOnce(new ChannelError(code))
      const catalogue = await port.catalogue()
      expect(catalogue.folders).toHaveLength(2)
      expect(catalogue.folders[0]).toMatchObject({
        id: project.project_id,
        missing: true,
        path: project.root_path,
      })
      expect(catalogue.targets[0]).toMatchObject({
        projectId: project.project_id,
        kind: 'workspace',
        id: workspace.workspace_id,
      })
    }
  )
  it('retains an unavailable repository when listing its workspaces fails before worktree enumeration', async () => {
    const { client, port } = fake()
    await port.catalogue()
    client.listProjects.mockResolvedValueOnce([
      project,
      { ...project, project_id: 'other-project', repository_path: null },
    ])
    client.listWorkspaces.mockRejectedValueOnce(new ChannelError('repository_unavailable'))
    const catalogue = await port.catalogue()
    expect(catalogue.folders).toHaveLength(2)
    expect(catalogue.folders[0]).toMatchObject({ id: project.project_id, missing: true })
    expect(catalogue.targets[0]).toMatchObject({
      projectId: project.project_id,
      kind: 'workspace',
      id: workspace.workspace_id,
    })
    expect(catalogue.folders[1].missing).not.toBe(true)
  })
  it('lists the root first, does not attach external worktrees implicitly, and binds legacy chats by workspace', async () => {
    const { port } = fake()
    const data = await port.catalogue()
    expect(data.folders[0].copies.map((c) => c.id)).toEqual([identity.workspace])
    expect(data.sessions[0].target?.id).toBe(identity.workspace)
    expect(data.capabilities).not.toContain('node_path_v2')
    expect(data.targets[0].location).toEqual({
      root: project.root_path,
      path: project.root_path,
      kind: 'root',
    })
  })
  it('maps untracked, partly staged and deleted raw status without claiming change stamps on legacy nodes', async () => {
    const { port } = fake()
    const catalogue = await port.catalogue()
    const view = await port.inspect(catalogue.targets[0])
    expect(view.changes).toEqual([
      expect.objectContaining({ path: 'app.ts', kind: 'modified', stage: 'partly' }),
      expect.objectContaining({ path: 'new.txt', kind: 'added', stage: 'unstaged' }),
      expect.objectContaining({ path: 'gone.txt', kind: 'deleted', stage: 'unstaged' }),
    ])
    expect(view.changes.some((c) => c.changeId)).toBe(false)
    expect(view.ahead).toBeUndefined()
    expect(view.behind).toBeUndefined()
  })
  it('freezes a history page on the observed HEAD instead of following later branch movement', async () => {
    const { port, calls } = fake()
    const catalogue = await port.catalogue()
    const first = await port.history(catalogue.targets[0])
    expect(first.revision?.kind).toBe('commit')
    expect(calls.find((c) => c.method === 'repository.v1.history')?.params.revision.kind).toBe(
      'commit'
    )
  })
})
describe('bounded tree reads', () => {
  it('loads sibling directories concurrently with no more than four requests in flight', async () => {
    const f = fake()
    const catalogue = await f.port.catalogue()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let active = 0,
      peak = 0
    f.client.repository = new RepositoryClient(async (method, params: any) => {
      if (method !== 'repository.v1.tree') return f.request(method, params)
      if (!params.path)
        return {
          entries: Array.from({ length: 12 }, (_, i) => ({
            name: `folder-${i}`,
            path: `folder-${i}`,
            kind: 'directory',
            oid: null,
            size: null,
          })),
          cursor: null,
          incomplete: false,
          omissions: [],
        }
      active++
      peak = Math.max(peak, active)
      await gate
      active--
      return {
        entries: [
          { name: 'sample.ts', path: `${params.path}/sample.ts`, kind: 'file', oid: null, size: 5 },
        ],
        cursor: null,
        incomplete: false,
        omissions: [],
      }
    })
    const inspection = f.port.commit(catalogue.targets[0], BASE)
    try {
      for (let i = 0; i < 100; i++) await Promise.resolve()
      expect(peak).toBe(4)
    } finally {
      release()
    }
    const result = await inspection
    expect(result.files).toHaveLength(12)
    expect(result.files?.map((entry) => entry.path)).toEqual(
      Array.from({ length: 12 }, (_, i) => `folder-${i}/sample.ts`)
    )
    expect(peak).toBe(4)
  })
})

describe('interactive read priority', () => {
  it('pauses queued background tree reads until an interactive file read settles', async () => {
    const f = fake()
    const catalogue = await f.port.catalogue()
    let releaseTrees!: () => void, releaseFile!: () => void
    const treeGate = new Promise<void>((resolve) => {
      releaseTrees = resolve
    })
    const fileGate = new Promise<void>((resolve) => {
      releaseFile = resolve
    })
    let trees = 0
    f.client.repository = new RepositoryClient(async (method, params: any) => {
      if (method !== 'repository.v1.tree') return f.request(method, params)
      if (!params.path)
        return {
          entries: Array.from({ length: 12 }, (_, i) => ({
            name: `folder-${i}`,
            path: `folder-${i}`,
            kind: 'directory',
            oid: null,
            size: null,
          })),
          cursor: null,
          incomplete: false,
          omissions: [],
        }
      trees++
      await treeGate
      return { entries: [], cursor: null, incomplete: false, omissions: [] }
    })
    const inspection = f.port.commit(catalogue.targets[0], BASE)
    for (let i = 0; i < 100; i++) await Promise.resolve()
    const observe = f.client.repository.observe.bind(f.client.repository)
    vi.spyOn(f.client.repository, 'observe').mockImplementation(async (params) => {
      await fileGate
      return observe(params)
    })
    const file = f.port.file(catalogue.targets[0], 'README.md')
    releaseTrees()
    try {
      for (let i = 0; i < 100; i++) await Promise.resolve()
      expect(trees).toBe(4)
    } finally {
      releaseFile()
    }
    await Promise.all([inspection, file])
    expect(trees).toBe(12)
  })
})

it('ignores repository invalidations belonging to another watched target', async () => {
  const f = fake(),
    catalogue = await f.port.catalogue(),
    notify = vi.fn()
  const stop = await f.port.watch(catalogue.targets[0], notify)
  try {
    f.event('repository.invalidated', { worktree_id: 'other-worktree' })
    expect(notify).not.toHaveBeenCalled()
    f.event('repository.invalidated', { worktree_id: catalogue.targets[0].id })
    expect(notify).toHaveBeenCalledTimes(1)
  } finally {
    stop()
  }
})

describe('independent file reads', () => {
  it('preserves not_found after retrying a genuinely missing path once', async () => {
    const f = fake()
    const catalogue = await f.port.catalogue()
    const missing = new ChannelError('not_found')
    const request = vi.fn().mockRejectedValue(missing)
    Object.assign(f.client, { request })
    const blob = vi.spyOn(f.client.repository, 'blob').mockRejectedValue(missing)
    await expect(f.port.file(catalogue.targets[0], 'missing/sample.ts')).rejects.toBe(missing)
    expect(blob).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledOnce()
  })
  it.each(['unsafe_path', 'not_found'])(
    'opens an explicit path after an ordinary %s response',
    async (code) => {
      const f = fake()
      const catalogue = await f.port.catalogue()
      const request = vi.fn(f.request)
      Object.assign(f.client, { request })
      vi.spyOn(f.client.repository, 'blob').mockRejectedValueOnce(
        new ChannelError(code, 'Path excluded by folder policy')
      )
      const result = await f.port.file(catalogue.targets[0], 'generated/sample.ts')
      expect(result.text).toBeTruthy()
      expect(request).toHaveBeenCalledWith(
        'repository.v1.blob',
        expect.objectContaining({ path: 'generated/sample.ts', include_ignored: true })
      )
    }
  )
  it('retries ordinary visibility after an ignored scan exceeds the limit', async () => {
    const f = fake()
    const catalogue = await f.port.catalogue()
    const request = vi.fn().mockRejectedValue(new ChannelError('scan_limit', 'scan_limit'))
    Object.assign(f.client, { request })
    const blob = vi
      .spyOn(f.client.repository, 'blob')
      .mockRejectedValueOnce(new ChannelError('not_found', 'Path is ignored'))
    await f.port.file(catalogue.targets[0], 'app.ts')
    expect(request).toHaveBeenCalledWith(
      'repository.v1.blob',
      expect.objectContaining({ include_ignored: true })
    )
    expect(blob).toHaveBeenCalledTimes(2)
  })
  it('opens ordinary files without scanning ignored trees', async () => {
    const f = fake()
    const catalogue = await f.port.catalogue()
    const request = vi.fn().mockRejectedValue(new ChannelError('scan_limit', 'scan_limit'))
    Object.assign(f.client, { request })
    await f.port.file(catalogue.targets[0], 'app.ts')
    expect(request).not.toHaveBeenCalled()
  })

  it('retries without the ignored-file flag when an older node rejects that parameter', async () => {
    const f = fake()
    const catalogue = await f.port.catalogue()
    const request = vi
      .fn()
      .mockRejectedValue(new ChannelError('invalid_params', 'Unknown parameter'))
    Object.assign(f.client, { request })
    const blob = vi
      .spyOn(f.client.repository, 'blob')
      .mockRejectedValueOnce(new ChannelError('not_found', 'Path is ignored'))
    await f.port.file(catalogue.targets[0], 'app.ts')
    expect(request).toHaveBeenCalledWith(
      'repository.v1.blob',
      expect.objectContaining({ include_ignored: true })
    )
    expect(blob).toHaveBeenCalledTimes(2)
    expect(blob.mock.calls[1][0]).not.toHaveProperty('include_ignored')
  })
  it('reads file bytes while status is pending, without listing the tree', async () => {
    const f = fake()
    const catalogue = await f.port.catalogue()
    let finish!: (entries: []) => void
    const status = vi.spyOn(f.client.repository, 'status').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ entries: [], cursor: null, incomplete: false, omissions: [] })
        })
    )
    const blob = vi.spyOn(f.client.repository, 'blob')
    const tree = vi.spyOn(f.client.repository, 'tree')
    const file = f.port.file(catalogue.targets[0], 'app.ts')
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(status).toHaveBeenCalledTimes(1)
    expect(blob).toHaveBeenCalledTimes(1)
    finish([])
    await file
    expect(tree).not.toHaveBeenCalled()
  })
  it('captures a changed-file comparison while file content is still in flight', async () => {
    const f = fake()
    const catalogue = await f.port.catalogue()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const content = f.client.repository.content.bind(f.client.repository)
    vi.spyOn(f.client.repository, 'content').mockImplementation(async (params) => {
      await gate
      return content(params)
    })
    const compare = vi.spyOn(f.client.repository, 'compare')
    const file = f.port.file(catalogue.targets[0], 'app.ts')
    try {
      for (let i = 0; i < 100; i++) await Promise.resolve()
      expect(compare).toHaveBeenCalledTimes(1)
    } finally {
      release()
    }
    const document = await file
    expect(document.change).toMatchObject({
      before: 'export const answer = 1\n',
      after: 'export const answer = 42\n',
      stage: 'unstaged',
    })
  })
  it('loads capabilities for a direct file read without waiting for the catalogue', async () => {
    const f = fake()
    await f.port.file(
      {
        nodeId: identity.node,
        registrationId: identity.installation,
        projectId: identity.project,
        kind: 'worktree',
        id: identity.workspace,
      },
      'app.ts'
    )
    expect(f.client.describe).toHaveBeenCalledTimes(1)
    expect(f.client.listProjects).not.toHaveBeenCalled()
  })
})

describe('enriched node path reads', () => {
  it('requests opt-in details, honours external selection and authoritative divergence', async () => {
    const f = fake()
    f.client.describe.mockResolvedValue({
      capabilities: { capabilities: { node_path_v2: { status: 'supported' } } },
    })
    const request = async (method: string, params: unknown) => {
      if (method === 'repository.v1.divergence')
        return {
          base_ref: 'trunk',
          base_commit: 'a'.repeat(40),
          head_commit: 'b'.repeat(40),
          ahead: 23,
          behind: 7,
          reason: 'ok',
        }
      const raw = await f.request(method, params)
      if (method === 'repository.v1.worktrees')
        return {
          ...(raw as object),
          entries: (raw as { entries: object[] }).entries.map((e) => ({ ...e, listed: true })),
        }
      if (method === 'repository.v1.status')
        return {
          ...(raw as object),
          entries: (raw as { entries: object[] }).entries.map((e, i) => ({
            ...e,
            kind: i === 1 ? 'A' : i === 2 ? 'D' : 'M',
            stage: i ? 'unstaged' : 'partly',
            change_id: `change-${i}`,
            changed_at: '2025-01-01T00:00:00Z',
            time_basis: 'observed',
          })),
        }
      return raw
    }
    f.client.repository = new RepositoryClient(request)
    f.client.nodePath = new NodePathClient(request, async () => {
      throw new Error('No mutation')
    })
    const port = new NodePathClientPort(f.client, {
      nodeId: identity.node,
      registrationId: identity.installation,
    })
    const catalogue = await port.catalogue()
    expect(catalogue.folders[0].copies).toHaveLength(2)
    const inspection = await port.inspect(catalogue.targets[0])
    expect(inspection).toMatchObject({ ahead: 23, behind: 7, base: 'trunk' })
    expect(inspection.changes[0]).toMatchObject({ changeId: 'change-0', stage: 'partly' })
    expect(
      f.calls.find((c) => c.method === 'repository.v1.status')?.params.include_change_details
    ).toBe(true)
  })
})
describe('binary-safe commit detail', () => {
  const target = {
    nodeId: identity.node,
    registrationId: identity.installation,
    projectId: identity.project,
    kind: 'worktree' as const,
    id: identity.workspace,
  }
  function mixed(initial = false) {
    const f = fake()
    const request = async (method: string, params: any) => {
      if (method === 'repository.v1.compare') {
        const page = (await f.request(method, params)) as object
        return {
          ...page,
          entries: [
            { path: 'asset.bin', status: 'M', index: ' ', worktree: ' ' },
            { path: 'README.md', status: 'M', index: ' ', worktree: ' ' },
            { path: 'removed.bin', status: 'D', index: ' ', worktree: ' ' },
            { path: 'created.bin', status: 'A', index: ' ', worktree: ' ' },
          ],
        }
      }
      if (method === 'repository.v1.tree' && initial) {
        const page = (await f.request(method, params)) as object
        return {
          ...page,
          entries: [
            { name: 'asset.bin', path: 'asset.bin', kind: 'file', oid: HEAD, size: 3 },
            { name: 'README.md', path: 'README.md', kind: 'file', oid: HEAD, size: 10 },
          ],
        }
      }
      if (method === 'repository.v1.blob' && params.path.endsWith('.bin'))
        return {
          content_id: 'c'.repeat(64),
          size: 3,
          binary: true,
          requires_larger_load: false,
          too_large: false,
        }
      return f.request(method, params)
    }
    f.client.repository = new RepositoryClient(request)
    return f
  }
  it('opens a mixed commit and leaves each binary as metadata without requesting its bytes', async () => {
    const f = mixed()
    const model = new NodePathHistoryModel(f.port, target)
    await model.open(HEAD)
    expect(model.openCommit.value).toBe(HEAD)
    expect(model.error.value).toBe('')
    const files = model.commits.value[0].files!
    expect(files.find((f) => f.path === 'README.md')?.after).toContain('# Sample project')
    expect(files.filter((f) => f.path.endsWith('.bin'))).toEqual([
      expect.objectContaining({
        path: 'asset.bin',
        binary: true,
        before: '',
        after: '',
        kind: 'modified',
      }),
      expect.objectContaining({ path: 'removed.bin', binary: true, kind: 'deleted' }),
      expect.objectContaining({ path: 'created.bin', binary: true, kind: 'added' }),
    ])
    expect(
      f.calls.some(
        (c) => c.method === 'repository.v1.content' && c.params.content_id === 'c'.repeat(64)
      )
    ).toBe(false)
  })
  it('lists the files of a commit without reading any of their contents, then reads one when asked', async () => {
    const f = mixed()
    const index = await f.port.commitIndex(target, HEAD)
    expect(index.files?.map((file) => [file.path, file.kind, file.pending])).toEqual([
      ['asset.bin', 'modified', true],
      ['README.md', 'modified', true],
      ['removed.bin', 'deleted', true],
      ['created.bin', 'added', true],
    ])
    expect(
      f.calls.filter((c) => ['repository.v1.blob', 'repository.v1.content'].includes(c.method))
    ).toEqual([])
    const readme = await f.port.commitFile(target, index, index.files![1]!)
    expect(readme.after).toContain('# Sample project')
    expect(readme.pending).toBeUndefined()
  })
  it('also opens binary entries in the initial commit', async () => {
    const f = mixed(true)
    const detail = await f.port.commit(target, BASE)
    expect(detail.files).toEqual([
      expect.objectContaining({ path: 'asset.bin', binary: true, kind: 'added' }),
      expect.objectContaining({
        path: 'README.md',
        after: expect.stringContaining('# Sample project'),
      }),
    ])
  })
  it('keeps oversized unclassified entries as honest metadata instead of failing the mixed commit', async () => {
    const f = mixed()
    const blob = f.client.repository.blob.bind(f.client.repository)
    vi.spyOn(f.client.repository, 'blob').mockImplementation(async (params) =>
      params.path.endsWith('.bin')
        ? {
            content_id: null,
            size: 2 * 1024 * 1024,
            binary: false,
            requires_larger_load: true,
            too_large: false,
          }
        : blob(params)
    )
    const detail = await f.port.commit(target, HEAD)
    expect(detail.files?.find((f) => f.path === 'asset.bin')).toMatchObject({
      before: '',
      after: '',
      previewNote: 'This file needs an explicit larger load in the repository browser.',
    })
    expect(detail.files?.find((f) => f.path === 'asset.bin')?.binary).not.toBe(true)
    expect(detail.files?.find((f) => f.path === 'README.md')?.after).toContain('# Sample project')
  })
  it('still reports a real text-read failure instead of disguising it as binary metadata', async () => {
    const f = mixed()
    vi.spyOn(f.client.repository, 'blob').mockRejectedValue(new Error('disconnected'))
    await expect(f.port.commit(target, HEAD)).rejects.toThrow('disconnected')
  })
})
describe('bounded node image reads', () => {
  const target = {
    nodeId: identity.node,
    registrationId: identity.installation,
    projectId: identity.project,
    kind: 'worktree' as const,
    id: identity.workspace,
  }
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3])
  function image(size = bytes.length) {
    const f = fake()
    const blob = {
      content_id: 'c'.repeat(64),
      size,
      binary: true,
      requires_larger_load: false,
      too_large: false,
    }
    vi.spyOn(f.client.repository, 'blob').mockResolvedValue(blob)
    const content = vi.spyOn(f.client.repository, 'content').mockResolvedValue({
      offset: 0,
      total: bytes.length,
      base64: btoa(String.fromCharCode(...bytes)),
    })
    return { ...f, content, blob }
  }
  it.each([false, true])(
    'returns raster bytes for the file pane, including changed images (changed=%s)',
    async (changed) => {
      const f = image()
      if (changed)
        vi.spyOn(f.client.repository, 'status').mockResolvedValue({
          cursor: null,
          incomplete: false,
          omissions: [],
          entries: [{ path: 'sample-image.png', index: ' ', worktree: 'M' }],
        })
      const file = await f.port.file(target, 'sample-image.png')
      expect(file.image).toEqual({ bytes, mime: 'image/png' })
      expect(file.text).toBe('')
      expect(f.calls.some((c) => c.method === 'repository.v1.patch')).toBe(false)
    }
  )
  it('reuses known revision and changes for an image without observing, listing, or loading text patches', async () => {
    const f = image()
    const observe = vi.spyOn(f.client.repository, 'observe')
    const status = vi.spyOn(f.client.repository, 'status')
    const tree = vi.spyOn(f.client.repository, 'tree')
    const patch = vi.spyOn(f.client.repository, 'patch')
    const revision = {
      kind: 'working' as const,
      observation_id: 'sample-observation',
      head: HEAD,
      observed_at: '2025-01-01T00:00:00Z',
    }
    const file = await f.port.file(target, 'sample-image.png', 'unstaged', undefined, {
      revision,
      changes: [
        {
          path: 'sample-image.png',
          kind: 'modified',
          stage: 'partly',
          before: '',
          after: '',
          added: 0,
          removed: 0,
        },
      ],
    })
    expect(file.image?.bytes).toEqual(bytes)
    expect(file.revision).toEqual(revision)
    expect(file.change?.stage).toBe('unstaged')
    expect(observe).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
    expect(tree).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
  })
  it('does not request text patches for a changed image above the initial blob threshold', async () => {
    const f = image()
    vi.mocked(f.client.repository.blob).mockResolvedValueOnce({
      ...f.blob,
      content_id: null,
      binary: false,
      size: 2 * 1024 * 1024,
      requires_larger_load: true,
    })
    vi.spyOn(f.client.repository, 'status').mockResolvedValue({
      cursor: null,
      incomplete: false,
      omissions: [],
      entries: [{ path: 'sample-image.png', index: ' ', worktree: 'M' }],
    })
    const patch = vi.spyOn(f.client.repository, 'patch')
    const file = await f.port.file(target, 'sample-image.png', 'unstaged')
    expect(file.image?.bytes).toEqual(bytes)
    expect(patch).not.toHaveBeenCalled()
  })
  function stagedImage(index: string, worktree: string) {
    const f = fake()
    const versions = {
      head: new Uint8Array([...bytes, 11]),
      index: new Uint8Array([...bytes, 22]),
      working: new Uint8Array([...bytes, 33]),
    }
    const ids = {
      head: 'head-image-content',
      index: 'index-image-content',
      working: 'working-image-content',
    }
    const request = async (method: string, params: any) => {
      if (method === 'repository.v1.status')
        return {
          cursor: null,
          incomplete: false,
          omissions: [],
          entries: [{ path: 'sample-image.png', index, worktree }],
        }
      if (method === 'repository.v1.blob') {
        // The pinned protocol exposes commit and working revisions only. The index's
        // distinct bytes cannot be recovered from a binary-diff metadata summary.
        const side =
          params.revision.kind === 'commit'
            ? 'head'
            : worktree === ' ' && index !== 'D'
              ? 'index'
              : 'working'
        return {
          content_id: ids[side],
          size: versions[side].length,
          binary: true,
          requires_larger_load: false,
          too_large: false,
        }
      }
      if (method === 'repository.v1.content' && Object.values(ids).includes(params.content_id)) {
        const side = Object.keys(ids).find(
          (side) => ids[side as keyof typeof ids] === params.content_id
        ) as keyof typeof ids
        const value = versions[side]
        return {
          offset: params.offset ?? 0,
          total: value.length,
          base64: btoa(String.fromCharCode(...value)),
        }
      }
      if (method === 'repository.v1.compare') {
        const page = (await f.request(method, params)) as object
        return {
          ...page,
          entries: [
            { path: 'sample-image.png', status: index === 'D' ? 'D' : 'M', index, worktree },
          ],
        }
      }
      if (method === 'repository.v1.patch') {
        const patch =
          'diff --git a/sample-image.png b/sample-image.png\nindex 1111111..2222222 100644\nBinary files a/sample-image.png and b/sample-image.png differ\n'
        return {
          content_id: 'binary-summary',
          size: patch.length,
          binary: false,
          requires_larger_load: false,
          too_large: false,
        }
      }
      if (method === 'repository.v1.content' && params.content_id === 'binary-summary') {
        const patch =
          'diff --git a/sample-image.png b/sample-image.png\nindex 1111111..2222222 100644\nBinary files a/sample-image.png and b/sample-image.png differ\n'
        return { offset: params.offset ?? 0, total: patch.length, base64: btoa(patch) }
      }
      return f.request(method, params)
    }
    f.client.repository = new RepositoryClient(request)
    return { ...f, versions, ids }
  }
  // BUG: The pinned repository protocol lacks index/comparison-side blob reads.
  it.fails(
    'shows index bytes for a partly staged image instead of its later working-tree bytes',
    async () => {
      const f = stagedImage('M', 'M')
      const file = await f.port.file(target, 'sample-image.png', 'staged')
      expect(file.image?.bytes).toEqual(f.versions.index)
      expect(file.contentId).toBe(f.ids.index)
      expect(file.change?.stage).toBe('staged')
    }
  )
  it('still previews current bytes for the unstaged side of a partly staged image', async () => {
    const f = stagedImage('M', 'M')
    const file = await f.port.file(target, 'sample-image.png', 'unstaged')
    expect(file.image?.bytes).toEqual(f.versions.working)
    expect(file.change?.stage).toBe('unstaged')
  })
  it.each(['staged', undefined] as const)(
    'previews a staged-only image when the working tree still equals the index (stage=%s)',
    async (stage) => {
      const f = stagedImage('M', ' ')
      const file = await f.port.file(target, 'sample-image.png', stage)
      expect(file.image?.bytes).toEqual(f.versions.index)
      expect(file.change?.stage).toBe('staged')
    }
  )
  it('refuses to substitute working-tree bytes when a staged image needs an unavailable index read', async () => {
    const f = stagedImage('M', 'M')
    await expect(f.port.file(target, 'sample-image.png', 'staged')).rejects.toThrow(
      'Git index blob'
    )
  })
  it('uses HEAD image bytes as the base preview of a staged deletion', async () => {
    const f = stagedImage('D', ' ')
    const blob = vi.spyOn(f.client.repository, 'blob')
    const file = await f.port.file(target, 'sample-image.png', 'staged')
    expect(file.image?.bytes).toEqual(f.versions.head)
    expect(file.contentId).toBe(f.ids.head)
    expect(file.change?.stage).toBe('staged')
    expect(blob).toHaveBeenCalledWith({
      worktree_id: target.id,
      revision: { kind: 'commit', commit: HEAD },
      path: 'sample-image.png',
    })
  })
  it('loads an image above the default text threshold only after checking the image cap', async () => {
    const f = image()
    vi.mocked(f.client.repository.blob).mockResolvedValueOnce({
      ...f.blob,
      content_id: null,
      binary: false,
      size: 2 * 1024 * 1024,
      requires_larger_load: true,
    })
    const file = await f.port.file(target, 'sample-image.png')
    expect(file.image?.mime).toBe('image/png')
    expect(f.client.repository.blob).toHaveBeenLastCalledWith(
      expect.objectContaining({ larger: true })
    )
  })
  it('also supports images in plain folders', async () => {
    const f = image()
    f.client.readFile.mockResolvedValue({ ...f.blob, large: false })
    f.client.readContent.mockResolvedValue({
      offset: 0,
      total: bytes.length,
      base64: btoa(String.fromCharCode(...bytes)),
    })
    const file = await f.port.file({ ...target, kind: 'workspace' }, 'sample-image.png')
    expect(file.image).toEqual({ bytes, mime: 'image/png' })
  })
  it('refuses oversized images before reading their bytes and retains arbitrary binary refusal', async () => {
    const f = image(4 * 1024 * 1024 + 1)
    await expect(f.port.file(target, 'sample-image.png')).rejects.toThrow('4 MiB')
    expect(f.content).not.toHaveBeenCalled()
    await expect(f.port.file(target, 'sample.bin')).rejects.toThrow('Binary file')
  })
  it('bounds actual content totals even when blob metadata undercounts', async () => {
    const f = image()
    f.content.mockResolvedValue({ offset: 0, total: 4 * 1024 * 1024 + 1, base64: 'AA==' })
    await expect(f.port.file(target, 'sample-image.png')).rejects.toThrow('too large')
  })
})
describe('exact reverse patch for staged and unstaged comparisons', () => {
  it('restores only the matched hunk and keeps unrelated whole-file lines', () => {
    const patch =
      'diff --git a/sample.txt b/sample.txt\n--- a/sample.txt\n+++ b/sample.txt\n@@ -2,2 +2,2 @@\n-old\n+new\n tail\n'
    expect(reverseNodePatch('prefix\nnew\ntail\nafter\n', patch)).toBe('prefix\nold\ntail\nafter\n')
  })
  it('handles empty added and deleted files and missing final newlines', () => {
    expect(reverseNodePatch('new', '@@ -0,0 +1 @@\n+new\n\\ No newline at end of file\n')).toBe('')
    expect(reverseNodePatch('', '@@ -1 +0,0 @@\n-old\n\\ No newline at end of file\n')).toBe('old')
  })
  it('keeps exact bytes for a metadata-only rename and preserves an untouched missing final newline', () => {
    expect(
      reverseNodePatch(
        'same bytes',
        'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n'
      )
    ).toBe('same bytes')
    expect(reverseNodePatch('new\ntail', '@@ -1 +1 @@\n-old\n+new\n')).toBe('old\ntail')
    expect(reverseNodePatch('new', '@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n')).toBe(
      'old\n'
    )
  })
  it('refuses stale patches rather than rendering a plausible but false comparison', () => {
    expect(() => reverseNodePatch('different\n', '@@ -1 +1 @@\n-old\n+new\n')).toThrow(
      'does not match'
    )
  })
})
describe('a branch as a pull request would see it', () => {
  const target = {
    nodeId: identity.node,
    registrationId: identity.installation,
    projectId: identity.project,
    kind: 'worktree' as const,
    id: identity.workspace,
  }
  function branchFake(upstream: boolean) {
    const f = fake()
    f.client.describe.mockResolvedValue({
      capabilities: { capabilities: { node_path_v2: { status: 'supported' } } },
    })
    const divergence = vi.fn(async (params: { base_ref?: string }) =>
      params.base_ref === 'refs/remotes/origin/main'
        ? {
            base_ref: params.base_ref,
            base_commit: BASE,
            head_commit: HEAD,
            ahead: 2,
            behind: 0,
            reason: 'ok',
          }
        : {
            base_ref: params.base_ref ?? 'refs/remotes/origin/trunk',
            base_commit: BASE,
            head_commit: HEAD,
            ahead: 3,
            behind: 1,
            reason: 'ok',
          }
    )
    const request = async (method: string, params: any) => {
      if (method === 'repository.v1.divergence') return divergence(params)
      if (method === 'repository.v1.refs')
        return {
          entries: [
            { name: 'refs/heads/main', commit: HEAD, symbolic: null },
            { name: 'refs/heads/other', commit: BASE, symbolic: null },
            ...(upstream
              ? [{ name: 'refs/remotes/origin/main', commit: BASE, symbolic: null }]
              : []),
            { name: 'refs/remotes/origin/trunk', commit: BASE, symbolic: null },
            {
              name: 'refs/remotes/origin/HEAD',
              commit: BASE,
              symbolic: 'refs/remotes/origin/trunk',
            },
          ],
          default_branch: 'refs/remotes/origin/trunk',
          cursor: null,
          incomplete: false,
          omissions: [],
        }
      if (method === 'repository.v1.compare') {
        const page = (await f.request(method, params)) as object
        return { ...page, entries: [{ path: 'src/sample.ts', status: 'M' }] }
      }
      return f.request(method, params)
    }
    f.client.repository = new RepositoryClient(request)
    f.client.nodePath = new NodePathClient(request, async () => {
      throw new Error('No mutation')
    })
    const port = new NodePathClientPort(f.client, {
      nodeId: identity.node,
      registrationId: identity.installation,
    })
    return { port, divergence, calls: f.calls }
  }
  it('says the base, ahead and behind, what is not pushed, and what the branch committed', async () => {
    const { port } = branchFake(true)
    await port.catalogue()
    const branch = await port.branch(target)
    expect(branch.state).toMatchObject({
      base: 'origin/trunk',
      baseRef: 'refs/remotes/origin/trunk',
      ahead: 3,
      behind: 1,
      upstream: 'origin/main',
      unpushed: 2,
    })
    expect(branch.committed.map((c) => [c.path, c.kind])).toEqual([['src/sample.ts', 'modified']])
    expect(branch.refs).toEqual([
      'refs/heads/other',
      'refs/remotes/origin/main',
      'refs/remotes/origin/trunk',
    ])
  })
  it('loads branch capabilities before a catalogue has finished opening', async () => {
    const { port } = branchFake(true)
    await expect(port.branch(target)).resolves.toMatchObject({ state: { base: 'origin/trunk' } })
  })
  it('publishes capabilities before a slow project listing finishes', async () => {
    const f = fake()
    f.client.describe.mockResolvedValue({
      capabilities: { capabilities: { node_path_v2: { status: 'supported' } } },
    })
    let release!: () => void
    f.client.listProjects.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([])
        })
    )
    const port = new NodePathClientPort(f.client, {
      nodeId: identity.node,
      registrationId: identity.installation,
    })
    const ready = vi.fn()
    const pending = port.catalogue(ready)
    await vi.waitFor(() =>
      expect(ready).toHaveBeenCalledWith(expect.arrayContaining(['node_path_v2']))
    )
    release()
    await pending
  })
  it('uses an available default ref when automatic base detection returns no base', async () => {
    const { port, divergence } = branchFake(false)
    divergence.mockImplementation(
      async (params) =>
        ({
          base_ref: params.base_ref ?? null,
          base_commit: params.base_ref ? BASE : null,
          head_commit: HEAD,
          ahead: 0,
          behind: 0,
          reason: params.base_ref ? 'ok' : 'default_branch_required',
        }) as never
    )
    await port.catalogue()
    expect((await port.branch(target)).state.base).toBe('origin/trunk')
  })
  it('has no upstream before the first push, and counts against a chosen base', async () => {
    const { port, divergence } = branchFake(false)
    await port.catalogue()
    const branch = await port.branch(target, 'refs/heads/other')
    expect(divergence).toHaveBeenCalledWith(
      expect.objectContaining({ base_ref: 'refs/heads/other' })
    )
    expect(branch.state.upstream).toBeUndefined()
    expect(branch.state.unpushed).toBe(0)
    expect(branch.state.base).toBe('other')
  })
})
