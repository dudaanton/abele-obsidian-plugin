import { t } from '@/i18n'
import type { NodeClient } from '@abele/node-client'

/** Translate public delegation identities before scope checks or durable enqueueing. */
export async function resolveManagerTargets(
  client: NodeClient,
  method: string,
  raw: Record<string, unknown>,
  integrationContext = false
): Promise<Record<string, unknown>> {
  const params = { ...raw }
  if (!['command.v1.run', 'git.v1.integrate'].includes(method)) return params
  if (method === 'git.v1.integrate' && !integrationContext && !params.session_id)
    throw new Error(`session_required: ${t('node.manager.integrationContextUpdate')}`)
  for (const [alias, key] of [
    ['workspace_id', 'worktree_id'],
    ['source_workspace_id', 'source_worktree_id'],
  ]) {
    const workspace = params[alias]
    if (typeof workspace !== 'string') continue
    const project = await client.getWorkspace(workspace)
    let cursor: string | undefined
    let resolved: string | undefined
    for (let page = 0; page < 64; page++) {
      const rows = await client.repository.worktrees({
        project_id: project.project_id,
        cursor,
        limit: 256,
      })
      resolved = rows.entries.find((row) => row.workspace_id === workspace)?.worktree_id
      if (resolved || !rows.cursor || rows.cursor === cursor) break
      cursor = rows.cursor
    }
    if (!resolved)
      throw new Error(
        'worktree_not_found: No worktree is bound to this workspace. Read the delegation status before trying again.'
      )
    if (params[key] && params[key] !== resolved)
      throw new Error(
        'invalid_params: The workspace and worktree identify different targets. Supply one target.'
      )
    params[key] = resolved
    delete params[alias]
  }
  if (method === 'command.v1.run' && !params.project_id && !params.worktree_id) {
    if (typeof params.session_id !== 'string')
      throw new Error(
        'invalid_params: Supply an explicit project_id or worktree_id for this command.'
      )
    const binding = await client.nodePath.sessionWorktreeGet({
      session_id: params.session_id,
    })
    if (binding.target.kind === 'worktree') params.worktree_id = binding.target.worktree_id
    else
      throw new Error(
        'invalid_params: Supply project_id or a delegated workspace_id for this command.'
      )
  }
  // A specific worktree is the unambiguous target; the project is contextual metadata.
  if (params.worktree_id) delete params.project_id
  return params
}
