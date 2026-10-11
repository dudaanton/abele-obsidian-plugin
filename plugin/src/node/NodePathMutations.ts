import type { ClientState, NodeClient, Project } from '@abele/node-client'
import { NodePathMethodSchemas, type WorktreeEntry } from '@abele/node-protocol'
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
  constructor(readonly client: Pick<NodeClient, 'store' | 'nodePath'>) {}
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
  delete(target: PathTarget, row: WorktreeEntry, observation: string) {
    const params = {
      worktree_id: target.id,
      expected_head: row.head,
      expected_observation_id: observation,
    }
    return this.intent('repository.v1.worktree.delete', params, async (id) => {
      const result = await this.client.nodePath.deleteWorktree(params, id)
      if (result.state !== 'deleted')
        throw new Error(
          result.state === 'outcome_unknown'
            ? 'Deletion outcome unknown. Keep the target and check the same operation before trying again.'
            : 'The worktree changed. Refresh and review it before deleting.'
        )
      return result
    })
  }
}
