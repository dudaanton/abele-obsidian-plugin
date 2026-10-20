import type { NodeClient } from '@abele/node-client'
import {
  type NodeScopeEntry,
  type NodeScopeTarget,
  coversNodeScope,
  nodeTargetId,
} from '../../nodeScope'
import { NodeAccessRefusalError } from './accessRefusal'

// What the node file tools tell a model: what each one does, where the IDs come from, and,
// when it cannot reach a file, what the person does about it.

export const NODE_EDIT_TOOLS = ['node_edit', 'node_replace', 'node_write']
export const NODE_FILE_OPERATIONS = ['node_mv', 'node_cp', 'node_rm']
export const NODE_MUTATION_TOOLS = [...NODE_EDIT_TOOLS, ...NODE_FILE_OPERATIONS]
/** Where the person gives a chat node access, said in every answer that lacks it. */
export const GIVE_ACCESS =
  'The person gives it with Give this chat access under a refused node call, or in this chat: the access button at the bottom left of the message box, then Node access, choose the node, folder and worktree, Add access. Or in the Node panel: open the place’s … menu, Give a chat access, choose this chat, Give access.'
export const NO_NODE_ACCESS = `This chat has no node access yet, so it can see no node, folder or file. ${GIVE_ACCESS} Then call node_nodes again.`
export const NODE_ACCESS_NOT_APPROVED =
  "This chat's node access is configured but has no approval on this device; copied or synced settings do not count. The person approves it in this chat: the access button at the bottom left of the message box, then Node access, Approve on this device. Then call node_nodes again."
export const CHOOSE_TARGET =
  'Call node_folders with a node ID from node_nodes, then pass node, project and workspace: the worktree_id with target_kind worktree for a Git folder, the workspace_id with target_kind workspace for a plain folder.'

/**
 * Models take the ID they were shown: a Git folder's root workspace ID instead of its
 * worktree ID, or a plain folder's workspace ID with the default worktree kind. Each names
 * one place, so it is read there; an ID the folder does not have gets the list it does.
 */
export async function resolveNodeTarget(
  client: NodeClient,
  target: NodeScopeTarget,
  scopes: NodeScopeEntry[],
  guard: () => void
): Promise<void> {
  const project = await client.getProject(target.project_id)
  guard()
  const id = nodeTargetId(target.target)
  if (!project.repository_path) {
    if (target.target.kind === 'worktree') target.target = { kind: 'workspace', workspace_id: id }
    return
  }
  const worktrees = []
  let cursor: string | undefined
  for (let page = 0; page < 64; page++) {
    const result = await client.repository.worktrees({
      project_id: target.project_id,
      cursor,
      limit: 256,
    })
    guard()
    worktrees.push(...result.entries)
    if (!result.cursor || result.cursor === cursor) break
    cursor = result.cursor
  }
  const exact = worktrees.find((entry) => entry.worktree_id === id)
  if (exact && target.target.kind === 'worktree') return
  const owned = exact ?? worktrees.find((entry) => entry.workspace_id === id)
  if (owned) {
    target.target = { kind: 'worktree', worktree_id: owned.worktree_id }
    return
  }
  const allowed = worktrees.filter(
    (entry) =>
      entry.availability === 'available' &&
      scopes.some((scope) =>
        coversNodeScope(
          scope,
          { ...target, target: { kind: 'worktree', worktree_id: entry.worktree_id } },
          'read'
        )
      )
  )
  throw new NodeAccessRefusalError(
    `Worktree ${JSON.stringify(id)} is not in folder ${JSON.stringify(target.project_id)}. ${
      allowed.length
        ? `Its worktrees this chat may use: ${allowed
            .map(
              (entry) => `${entry.worktree_id} (${entry.branch ?? 'detached'}, ${entry.path_label})`
            )
            .join('; ')}. Pass one as workspace with target_kind worktree.`
        : 'This chat may use none of its worktrees.'
    } node_folders lists every folder and worktree this chat may use.`,
    {
      kind: 'no-worktree',
      node_id: target.node_id,
      project_id: target.project_id,
      wanted: id,
      known: allowed.map(
        (entry) => entry.branch?.replace(/^refs\/heads\//, '') || entry.worktree_id
      ),
    }
  )
}

const PLACE =
  'Name the place with node (from node_nodes), project and workspace (from node_folders): a Git folder takes its worktree_id with target_kind worktree, a plain folder its workspace_id with target_kind workspace. Omit all three when this chat was given exactly one folder or worktree, or after node_worktree_switch. Paths are relative to that place. When discussing code, always cite clickable Markdown links such as [src/sample.ts:42-48](src/sample.ts:42-48). These open current working-tree content, including uncommitted edits; no GitHub upload is needed. With multiple places, use abele-node-code: followed by URI-encoded JSON {"scope":[node_id,project_id,"worktree",worktree_id],"path":"src/sample.ts","line":42,"endLine":48}; use "workspace" and workspace_id for a plain folder. Never cite a place outside this chat’s access.'
const NODE_TOOL_DOING: Record<string, string> = {
  node_nodes:
    'Start here. Lists the nodes (computers running AbeleNode) this chat has node access to: node ID, label, whether connected. Next: node_folders.',
  node_folders:
    'Lists the folders on one node this chat may use (pass node from node_nodes): project ID, whether it is Git, and the worktree_id or workspace_id each file tool takes.',
  list_node_worktrees:
    "Lists one Git folder's worktrees this chat may use (pass node and project from node_folders): worktree_id, branch, path.",
  node_ls:
    'Lists the entries of the folder at path (empty for the top) in one node folder or worktree.',
  node_read:
    'Reads one UTF-8 text file (up to 2 MB) at path: its text and content_id, the SHA-256 every edit passes back as expected_content_id. start_line and end_line narrow it; ref reads a Git revision.',
  node_edit:
    'Replaces the one exact occurrence of old_text with new_text in a node file. Pass expected_content_id from node_read.',
  node_replace:
    'Replaces every exact occurrence of old_text with new_text in a node file. Pass expected_content_id from node_read.',
  node_write:
    'Writes the complete text of a node file. expected_content_id is the one from node_read, or null to create a file that must not exist yet.',
  node_mv:
    'Moves one regular file from from to to (which must not exist) inside the same place. Pass the content_id node_read gave for from as expected_content_id.',
  node_cp:
    'Copies one regular file from from to to (which must not exist) inside the same place. Pass the content_id node_read gave for from as expected_content_id.',
  node_rm:
    'Removes one regular file at path, never a folder. Pass expected_content_id from node_read.',
  node_search:
    'Searches the files of a node folder or worktree: mode literal or regex over contents, filename over names; glob narrows paths.',
  node_git_status: "Lists a Git worktree's changed files (index and working tree).",
  node_git_commit:
    'Commit already staged changes in a scoped Git worktree. Always asks the owner. Pass message, expected_head from node_git_status and a stable operation_id. Preserve the exact arguments and operation_id on uncertain retries. Does not stage files or push.',
  node_worktree_remove:
    'Remove a clean developer worktree after explicit owner approval. Pass expected_head and expected_observation_id from node_git_status and a stable operation_id; preserve the exact body and ID on uncertain retries. The node refuses dirty, busy or protected worktrees. Does not remove the branch.',
  node_git_diff:
    'Shows Git changes: staged or unstaged, or between base and ref; with path, that file’s patch.',
  node_git_branches: "Lists a Git folder's branches and tags.",
  node_git_log:
    'Lists up to 50 Git commits from ref (default the worktree head), optionally for one path. For the next page call node_git_log with only the returned cursor. Oversized messages may be marked truncated.',
  node_git_blame: 'Shows who last changed each line of path; start and count narrow it.',
  node_worktree_switch:
    "Makes another worktree of the same Git folder this chat's default place, so later calls may omit node, project and workspace.",
}
export function nodeToolDescription(name: string): string {
  const writes = NODE_MUTATION_TOOLS.includes(name)
    ? ' Acts at once on the real file; asks first only when the chat permission mode says so. Never retried automatically: after an unknown outcome repeat the call with its operation_id.'
    : ''
  const place = name === 'node_nodes' || name === 'node_folders' ? '' : ` ${PLACE}`
  return `${NODE_TOOL_DOING[name]}${place}${writes} Long results continue with the same tool and cursor alone. Works only on what this chat was given node access to; without it the result says how the person gives it. No shell, staging or push. Committing staged changes and removing a developer worktree each require explicit owner approval.`
}
