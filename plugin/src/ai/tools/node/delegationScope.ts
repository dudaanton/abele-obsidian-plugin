import type { NodeClient } from '@abele/node-client'
import type { ChatSession } from '../../ChatSession'
import { nodeScopeEntries } from '../../nodeScope'

/** Target scope only. Callers separately require the device-local action tool permission. */
export function requireDelegationScope(
  chat: ChatSession,
  node: string,
  project?: string,
  workspace?: string,
  worktree?: string
): () => void {
  const check = () => {
    const allowed = nodeScopeEntries(chat).some(
      (entry) =>
        entry.node_id === node &&
        entry.access === 'run' &&
        (entry.kind === 'node' ||
          (entry.project_id === project &&
            (entry.kind === 'project' ||
              (entry.target.kind === 'workspace'
                ? workspace !== undefined && entry.target.workspace_id === workspace
                : worktree !== undefined && entry.target.worktree_id === worktree))))
    )
    if (!allowed)
      throw new Error(
        `This target is outside this chat's node access. Add ${project ? `project ${project} on ` : ''}node ${node} using the chat's node chips.`
      )
  }
  check()
  return check
}

/** A project command can use its scoped plain root without widening the grant. */
export async function scopedPlainCommandRoot(
  client: NodeClient,
  chat: ChatSession,
  node: string,
  project: string
): Promise<string | undefined> {
  const entries = nodeScopeEntries(chat).filter(
    (entry) => entry.node_id === node && entry.access === 'run'
  )
  let rootWorkspace: string | undefined
  const scopedRoots = entries.filter(
    (entry) =>
      entry.kind === 'target' && entry.project_id === project && entry.target.kind === 'workspace'
  )
  if (
    scopedRoots.length &&
    !entries.some((entry) => entry.kind === 'project' && entry.project_id === project) &&
    !(await client.getProject(project)).repository_path
  ) {
    for (const entry of scopedRoots) {
      if (entry.kind !== 'target' || entry.target.kind !== 'workspace') continue
      const workspace = await client.getWorkspace(entry.target.workspace_id)
      if (
        workspace.workspace_id === entry.target.workspace_id &&
        workspace.project_id === project &&
        workspace.kind === 'root' &&
        workspace.state === 'ready'
      ) {
        rootWorkspace = workspace.workspace_id
        break
      }
    }
  }
  return rootWorkspace
}
