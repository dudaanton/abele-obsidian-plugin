import type { ChatSession } from '../../ChatSession'
import { nodeScopeEntries } from '../../nodeScope'

/** Delegation uses the chat's existing node chips, including read access. */
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
