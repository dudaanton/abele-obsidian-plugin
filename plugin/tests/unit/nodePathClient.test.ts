import { describe, expect, it, vi } from 'vitest'
import { ProjectSchema, SessionSchema, WorkspaceSchema } from '@abele/node-protocol'
import { NodePathClientPort, reverseNodePatch } from '@/node/NodePathClientPort'
import { nodeRepositoryFixture, identity } from '../helpers/nodeRepositoryFixture'

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
    describe: vi.fn(async () => ({})),
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
  it('refuses stale patches rather than rendering a plausible but false comparison', () => {
    expect(() => reverseNodePatch('different\n', '@@ -1 +1 @@\n-old\n+new\n')).toThrow(
      'does not match'
    )
  })
})
