import { UiError, uiMessage } from '@/i18n/streamBErrors'
import type { ClientState, NodeClient, Project } from '@abele/node-client'
import { ChannelError } from '@abele/channel-protocol'
import {
  NodePathMethodSchemas,
  MethodSchemas,
  ResourceMethodSchemas,
  WorkspaceJobResultSchema,
  RepositoryWriteSchema,
  FileWriteSchema,
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
      Partial<
        Pick<
          NodeClient,
          | 'removeWorkspace'
          | 'getJob'
          | 'flush'
          | 'operationResult'
          | 'repository'
          | 'writeFile'
          | 'fileMutationResult'
        >
      >
  ) {}
  private async intent<T>(
    method: string,
    params: unknown,
    send: (id: string, retained: unknown) => Promise<T>,
    logicalKey: unknown = params,
    retainResult = false
  ): Promise<T> {
    const key = JSON.stringify([method, logicalKey])
    const intent = await this.client.store.transaction((raw) => {
      const intents = ((raw as IntentState).nodePathIntents ??= {})
      const previous = intents[key]
      const refusal = previous && raw.results[previous.id]?.error
      // Only a new explicit registration action retires a terminal refusal, including
      // receipts persisted before this policy. Keep receipts themselves for reconciliation.
      // Transport uncertainty has no definitive receipt and must retain the original intent.
      if (
        method === 'project.register' &&
        previous?.method === method &&
        refusal &&
        !['disconnected', 'outcome_unknown', 'storage_unavailable'].includes(refusal)
      )
        delete intents[key]
      return (intents[key] ??= { id: crypto.randomUUID(), method, params })
    })
    if (intent.method !== method) throw new UiError(uiMessage('streamBError.d7e2b0292d'))
    if (retainResult && intent.result !== undefined) return intent.result as T
    let result: T
    try {
      result = await send(intent.id, intent.params)
    } catch (error) {
      // A terminal stale-handle or busy refusal performed no write. Unknown outcomes keep
      // their original identity; a later explicit action may retire only a known refusal.
      if (
        error instanceof ChannelError &&
        ((method === 'filesystem.v1.mkdir' && error.code === 'stale_resource') ||
          (method === 'repository.v1.worktree.delete' && error.code === 'resource_busy'))
      )
        await this.client.store.transaction((raw) => {
          const intents = (raw as IntentState).nodePathIntents
          if (intents?.[key]?.id === intent.id) delete intents[key]
        })
      throw error
    }
    // A typed receipt is known, not just an operation ID. Failed/unknown calls keep their intent.
    await this.client.store.transaction((raw) => {
      const intents = (raw as IntentState).nodePathIntents
      if (intents?.[key]?.id !== intent.id) return
      if (retainResult) intents[key].result = result
      else delete intents[key]
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
      parentPath ? { parentPath, name } : params,
      true
    )
  }
  async register(path: string): Promise<Project> {
    const params = { path, trust: 'untrusted' as const, exact_root: true }
    const project = await this.intent('project.register', params, (id, retained) =>
      this.client.nodePath.register(MethodSchemas['project.register'].parse(retained), id)
    )
    await this.client.store.transaction((raw) => {
      const intents = (raw as IntentState).nodePathIntents ?? {}
      for (const [key, intent] of Object.entries(intents))
        if (intent.method === 'filesystem.v1.mkdir' && intent.result === path) delete intents[key]
    })
    return project
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
  private fileTarget(target: PathTarget) {
    return target.kind === 'worktree' ? { worktree_id: target.id } : { workspace_id: target.id }
  }
  private async fileIntent(
    method: string,
    params: unknown,
    send: (id: string) => Promise<{ state: string }>
  ) {
    const result = await this.intent(method, params, async (id) => {
      const result = await send(id)
      if (result.state === 'outcome_unknown') throw new ChannelError('outcome_unknown')
      return result
    })
    if (result.state === 'conflict') throw new ChannelError('stale_revision')
  }
  fileMove(
    target: PathTarget,
    from: string,
    to: string,
    expected_content_id: string,
    directory = false
  ) {
    const params = {
      ...this.fileTarget(target),
      from,
      to,
      expected_content_id,
      ...(directory ? { directory: true } : {}),
    }
    return this.fileIntent(
      `${target.kind === 'worktree' ? 'repository.v1' : 'workspace'}.file.move`,
      params,
      (id) => this.client.nodePath.fileMove(params, id)
    )
  }
  fileRemove(target: PathTarget, path: string, expected_content_id: string, directory = false) {
    const params = {
      ...this.fileTarget(target),
      path,
      expected_content_id,
      ...(directory ? { directory: true } : {}),
    }
    return this.fileIntent(
      `${target.kind === 'worktree' ? 'repository.v1' : 'workspace'}.file.remove`,
      params,
      (id) => this.client.nodePath.fileRemove(params, id)
    )
  }
  fileMkdir(target: PathTarget, path: string) {
    const params = { ...this.fileTarget(target), path }
    return this.fileIntent(
      `${target.kind === 'worktree' ? 'repository.v1' : 'workspace'}.file.mkdir`,
      params,
      (id) => this.client.nodePath.fileMkdir(params, id)
    )
  }
  createFile(target: PathTarget, path: string) {
    const params = {
      ...this.fileTarget(target),
      path,
      text: '',
      expected_content_id: null as string | null,
    }
    return this.fileIntent(
      target.kind === 'worktree' ? 'repository.v1.write' : 'workspace.write',
      params,
      async (id) => {
        const result = await (async () => {
          if (target.kind === 'worktree') {
            const repository = this.client.repository
            if (!repository) throw new ChannelError('unsupported_method')
            await repository.write(RepositoryWriteSchema.parse(params), id)
            return repository.mutationResult(id)
          }
          if (!this.client.writeFile || !this.client.fileMutationResult)
            throw new ChannelError('unsupported_method')
          await this.client.writeFile(FileWriteSchema.parse(params), id)
          return this.client.fileMutationResult(id)
        })()
        if (!result || result.state === 'outcome_unknown') throw new ChannelError('outcome_unknown')
        const resultTarget = 'worktree_id' in result ? result.worktree_id : result.workspace_id
        if (
          result.operation_id !== id ||
          result.path !== path ||
          resultTarget !== target.id ||
          result.expected_content_id !== null
        )
          throw new UiError(uiMessage('streamBError.6077692b27'))
        return result
      }
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
  session(
    target: PathTarget,
    title: string,
    provider: 'fake' | 'claude' | 'pi' | 'codex' | 'acp',
    agent?: string
  ) {
    const params = { title, provider, target: wirePathTarget(target), ...(agent ? { agent } : {}) }
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
      const receipt = Object.entries(state.results)
        .reverse()
        .find(
          ([, result]) =>
            result.request && matches(result.request) && result.error !== 'resource_busy'
        )
      return receipt ? { id: receipt[0], pending: false } : undefined
    })
    if (retained) {
      if (retained.pending) await this.client.flush?.()
      const receipt = await this.client.operationResult?.(retained.id)
      if (!receipt) throw new UiError(uiMessage('streamBError.a0a1c7d80c'))
      if (receipt.error)
        throw new UiError(uiMessage('streamBError.fcff0cdbbc', { v0: String(receipt.error) }))
      const reservation = WorkspaceJobResultSchema.parse(receipt.result)
      // Acceptance is not completion: a busy removal job did not remove the worktree.
      // A later explicit Delete may start a new job; uncertain jobs keep their receipt.
      const job = await this.client.getJob?.(reservation.job_id)
      if (!(job?.state === 'failed' && job.error === 'resource_busy')) return reservation
    }
    if (!this.client.removeWorkspace) throw new UiError(uiMessage('streamBError.96b7c749ee'))
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
          throw new UiError(uiMessage('streamBError.35eb88371d'))
        return result
      },
      { worktree_id: target.id }
    )
    if (result.state === 'conflict') throw new UiError(uiMessage('streamBError.8d6b5aefb7'))
    return result
  }
}
