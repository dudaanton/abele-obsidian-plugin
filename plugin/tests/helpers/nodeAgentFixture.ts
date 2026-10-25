import { vi } from 'vitest'
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
export const digest = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value)))
export const hash = digest('old')
export const project = ProjectSchema.parse({
  project_id: 'sample-project',
  root_path: '/sample',
  repository_path: null,
  git_common_dir: null,
  trust: 'untrusted',
  use_repository_claude_permissions: false,
  created_at: '2026-01-01T00:00:00Z',
})
export const workspace = WorkspaceSchema.parse({
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
export function setup(mode = 'allow-edit') {
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
export function setupGit() {
  const fixture = setup()
  // Manager actions now require the folder execution level.
  fixture.session.overrides.value.nodeScope![0].access = 'run'
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
