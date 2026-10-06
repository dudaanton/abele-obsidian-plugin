import { ref } from 'vue'
import type { NodeClient } from '@abele/node-client'
import { NodeWorkspaceModel } from '@/node/NodeWorkspaceModel'
import type { NodeConnection } from '@/node/NodeService'

/** Invented, non-executing data. Layout probes never start a provider or require a token. */
export function nodeWorkspaceFixture() {
  const project = {
    project_id: 'sample-project',
    root_path: '/sample/projects/a-repository-with-a-long-name',
    repository_path: '/sample/projects/repository',
    git_common_dir: '/sample/projects/repository/.git',
    trust: 'trusted' as const,
    use_repository_claude_permissions: false,
    created_at: '2025-01-01T00:00:00.000Z',
  }
  const workspace = {
    workspace_id: 'sample-workspace',
    project_id: project.project_id,
    path: '/sample/workspaces/isolated-coding-task',
    kind: 'managed' as const,
    state: 'ready' as const,
    branch: 'abele/sample-isolated-workspace',
    base_commit: 'a'.repeat(40),
    created_at: project.created_at,
    provenance: {
      node_id: 'sample-node',
      installation_id: 'sample-device',
      operation_id: 'sample-operation',
    },
  }
  const job = {
    job_id: 'sample-job',
    project_id: project.project_id,
    workspace_id: workspace.workspace_id,
    kind: 'workspace.create' as const,
    state: 'succeeded' as const,
    phase: 'worktree_created' as const,
    installation_id: 'sample-device',
    created_at: project.created_at,
    updated_at: project.created_at,
    error: null as string | null,
  }
  const client = {
    listProjects: async (after?: string) => (after ? [] : [project]),
    listWorkspaces: async (_id: string, after?: string) => (after ? [] : [workspace]),
    listSessions: async (): Promise<never[]> => [],
    listJobs: async (_id?: string, after?: string) => (after ? [] : [job]),
    subscribe: async () => {},
    onEvent: () => () => {},
    describe: async () => ({
      providers: [
        {
          provider: 'claude',
          available: true,
          configuration: { profile: 'inherited', setting_sources: ['user'] },
          capabilities: {
            steering: { status: 'unsupported', reason: 'Serialized follow-ups only' },
          },
        },
      ],
    }),
  } as unknown as NodeClient
  const model = new NodeWorkspaceModel(client)
  model.projects.value = [project]
  model.workspaces.value = [workspace]
  model.jobs.value = [job]
  model.projectId.value = project.project_id
  model.workspaceId.value = workspace.workspace_id
  model.status.value = [
    { index: ' ', worktree: 'M', path: 'src/sample-file-with-a-long-name.ts' },
    { index: '?', worktree: '?', path: 'sample-new-file.txt' },
  ]
  model.diff.value = {
    workspace_id: workspace.workspace_id,
    head_commit: 'a'.repeat(40),
    base_commit: 'b'.repeat(40),
    diff: 'diff --git a/sample.txt b/sample.txt\n--- a/sample.txt\n+++ b/sample.txt\n@@ -1 +1 @@\n-before\n+after',
  }
  const connection = {
    state: ref('connected'),
    client,
    connect: async () => {},
  } as unknown as NodeConnection
  return { model, connection, label: 'Sample local node' }
}
