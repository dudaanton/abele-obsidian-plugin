import { describe, expect, it, vi } from 'vitest'
import { NodePathClient, RepositoryClient, MemoryClientStore } from '@abele/node-client'
import { ProjectSchema, SessionSchema, WorkspaceSchema } from '@abele/node-protocol'
import { NodePathClientPort, reverseNodePatch } from '@/node/NodePathClientPort'
import { nodeRepositoryFixture, identity, BASE } from '../helpers/nodeRepositoryFixture'

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
  it('lists the root first, does not attach external worktrees implicitly, and binds legacy chats by workspace', async () => {
    const { port } = fake()
    const data = await port.catalogue()
    expect(data.folders[0].copies.map((c) => c.id)).toEqual([identity.workspace])
    expect(data.sessions[0].target?.id).toBe(identity.workspace)
    expect(data.capabilities).not.toContain('node_path_v2')
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
