import type { ClientState, NodeClient, Project } from '@abele/node-client'
import {
  NodePathMethodSchemas,
  MethodSchemas,
  ResourceMethodSchemas,
  WorkspaceJobResultSchema,
  type WorktreeEntry,
} from '@abele/node-protocol'
import { wirePathTarget } from './nodePathChat'
import type { PathTarget } from './NodePathModel'
interface PathIntent {
  id: string
  method: string
  params: unknown
  result?: unknown
}
type IntentState = ClientState & { nodePathIntents?: Record<string, PathIntent> }

/** Owner actions use the client's durable receipts and keep uncertain IDs across dialog reopen. */
export class NodePathMutations {
  constructor(
    readonly client: Pick<NodeClient, 'store' | 'nodePath'> &
      Partial<Pick<NodeClient, 'removeWorkspace' | 'flush' | 'operationResult'>>
  ) {}
  private async intent<T>(
    method: string,
    params: unknown,
    send: (id: string, retained: unknown) => Promise<T>,
    logicalKey: unknown = params
  ): Promise<T> {
    const key = JSON.stringify([method, logicalKey])
    const intent = await this.client.store.transaction((raw) => {
      const intents = ((raw as IntentState).nodePathIntents ??= {})
      return (intents[key] ??= { id: crypto.randomUUID(), method, params })
    })
    if (intent.method !== method)
      throw new Error('The retained folder operation has changed. Inspect it before retrying.')
    const result = await send(intent.id, intent.params)
    // A typed receipt is known, not just an operation ID. Failed/unknown calls keep their intent.
    await this.client.store.transaction((raw) => {
      delete (raw as IntentState).nodePathIntents?.[key]
    })
    return result
  }
  mkdir(directory: string, name: string, parentPath?: string): Promise<string> {
    const params = { directory_id: directory, name }
    return this.intent(
      'filesystem.v1.mkdir',
      params,
      async (id, retained) =>
        (
          await this.client.nodePath.mkdir(
            NodePathMethodSchemas['filesystem.v1.mkdir'].parse(retained),
            id
          )
        ).path,
      parentPath ? { parentPath, name } : params
    )
  }
  register(path: string): Promise<Project> {
    const params = { path, trust: 'untrusted' as const, exact_root: true }
    return this.intent('project.register', params, (id) =>
      this.client.nodePath.register(params, id)
    )
  }
  init(project_id: string, initial_branch: string): Promise<Project> {
    const params = { project_id, initial_branch }
    return this.intent('project.git_init', params, (id) => this.client.nodePath.gitInit(params, id))
  }
  selection(project_id: string, worktree_id: string, listed: boolean) {
    const params = { project_id, worktree_id, listed }
    return this.intent('project.worktree_selection', params, (id) =>
      this.client.nodePath.worktreeSelection(params, id)
    )
  }
  create(project_id: string, branch: string, base_ref: string) {
    const params = { project_id, branch, base_ref }
    return this.intent('workspace.create', params, (id) =>
      this.client.nodePath.createWorkspace(params, id)
    )
  }
  trust(project_id: string) {
    const params = { project_id, trust: 'trusted' as const }
    return this.intent('project.trust', params, (id) => this.client.nodePath.trust(params, id))
  }
  execution(target: PathTarget) {
    const params = { project_id: target.projectId, target: wirePathTarget(target), enabled: true }
    return this.intent('project.execution', params, (id) =>
      this.client.nodePath.execution(params, id)
    )
  }
  session(target: PathTarget, title: string, provider: 'fake' | 'claude' | 'pi') {
    const params = { title, provider, target: wirePathTarget(target) }
    return this.intent(
      'session.create',
      params,
      (id, retained) =>
        this.client.nodePath.createSession(MethodSchemas['session.create'].parse(retained), id),
      { target: params.target, provider }
    )
  }
  switch(session_id: string, expected: PathTarget, target: PathTarget) {
    const params = {
      session_id,
      expected_target: wirePathTarget(expected),
      target: wirePathTarget(target),
    }
    return this.intent(
      'session.worktree.set',
      params,
      (id, retained) =>
        this.client.nodePath.sessionWorktreeSet(
          NodePathMethodSchemas['session.worktree.set'].parse(retained),
          id
        ),
      { session_id, target: params.target }
    )
  }
  async removeManaged(workspaceId: string) {
    const matches = (request: { method: string; params: unknown }) => {
      if (request.method !== 'workspace.remove') return false
      const parsed = ResourceMethodSchemas['workspace.remove'].safeParse(request.params)
      return parsed.success && parsed.data.workspace_id === workspaceId
    }
    const retained = await this.client.store.transaction((state) => {
      const pending = state.outbox.find(matches)
      if (pending) return { id: pending.operation_id, pending: true }
      const receipt = Object.entries(state.results).find(
        ([, result]) => result.request && matches(result.request)
      )
      return receipt ? { id: receipt[0], pending: false } : undefined
    })
    if (retained) {
      if (retained.pending) await this.client.flush?.()
      const receipt = await this.client.operationResult?.(retained.id)
      if (!receipt)
        throw new Error('Deletion outcome unknown. Reconnect and check the original removal.')
      if (receipt.error)
        throw new Error(
          `The original removal was refused: ${receipt.error}. Its receipt is retained.`
        )
      return WorkspaceJobResultSchema.parse(receipt.result)
    }
    if (!this.client.removeWorkspace)
      throw new Error('Managed worktree removal is not available in this client.')
    return this.client.removeWorkspace(workspaceId)
  }
  async delete(target: PathTarget, row: WorktreeEntry, observation: string) {
    const params = {
      worktree_id: target.id,
      expected_head: row.head,
      expected_observation_id: observation,
    }
    const result = await this.intent(
      'repository.v1.worktree.delete',
      params,
      async (id, retained) => {
        const result = await this.client.nodePath.deleteWorktree(
          NodePathMethodSchemas['repository.v1.worktree.delete'].parse(retained),
          id
        )
        if (result.state === 'outcome_unknown')
          throw new Error(
            'Deletion outcome unknown. Keep the target and check the same operation before trying again.'
          )
        return result
      },
      { worktree_id: target.id }
    )
    if (result.state === 'conflict')
      throw new Error('The worktree changed. Refresh and review it before deleting.')
    return result
  }
}
