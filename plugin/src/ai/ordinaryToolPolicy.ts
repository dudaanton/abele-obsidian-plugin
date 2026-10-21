import { NODE_AGENT_TOOL_NAMES, NODE_EDIT_TOOLS, NODE_FILE_OPERATIONS } from './tools/node/agent'
import { needsSecretApproval } from './tools/secretUtils'
import { REPLY_REVISION_TOOL } from './tools/ReplyRevisionTool'
import { isSectionToolName } from './toolSections'
import { READ_RESULT } from './resultStore'
import {
  BOOK_READ_TOOLS,
  DECK_WRITE_TOOLS,
  EDIT_SELECTION_TOOL,
  NODE_ACTION_TOOLS,
  WRITE_TOOLS,
  type PermissionMode,
  type ToolMode,
} from './types'

export interface OrdinaryToolPolicy {
  permissionMode: PermissionMode
  toolModes: Record<string, ToolMode>
  getToolMode(name: string): ToolMode
  outOfScopePath(name: string, args?: Record<string, unknown>): string | null
  bookAnchored: boolean
  skillNeedsApproval(name: unknown): boolean
}

/** Core reads remain available when no feature-tool mode was saved. Scope still applies. */
export const ORDINARY_READ_TOOLS = [
  'read',
  READ_RESULT,
  'ls',
  'find',
  'workspace',
  'skill',
  'query_docs',
  'list_templates',
]
export const ORDINARY_SCOPED_TOOLS = [
  'read',
  'edit',
  'replace',
  'write',
  'rm',
  'mv',
  'cp',
  'read_image',
  'look_at_drawing',
  'deck_read',
  'deck_edit',
  'deck_check',
  'present',
  'canvas_read',
  'canvas_edit',
  'canvas_layout',
  'canvas_steps',
  'canvas_export',
  'look_at_canvas',
  'ls',
  'find',
]

export function ordinaryNeedsApproval(
  policy: OrdinaryToolPolicy,
  toolName: string,
  args?: Record<string, unknown>,
  permissionKey?: string
): boolean {
  if (toolName === 'node_git_commit' || toolName === 'node_worktree_remove') return true
  // The node asks once with the resolved folder and exact command before execution.
  if (toolName === 'node_command_run') return false
  if (NODE_ACTION_TOOLS.includes(toolName))
    return (
      !['node_delegations', 'node_delegation_status', 'node_command_status'].includes(toolName) &&
      policy.getToolMode(toolName) !== 'auto'
    )
  if (toolName === 'node_propose_edit' || needsSecretApproval(toolName, args)) return true
  const mode = policy.permissionMode
  if (NODE_EDIT_TOOLS.includes(toolName)) return mode !== 'allow-edit' && mode !== 'allow-all'
  if (NODE_FILE_OPERATIONS.includes(toolName)) return mode !== 'allow-all'
  if (NODE_AGENT_TOOL_NAMES.includes(toolName)) return false

  // This tool only records a proposal. Accepting it is a separate owner action, never a
  // permission mode, tool call or automatic approval.
  if (toolName === REPLY_REVISION_TOOL || isSectionToolName(toolName)) return false

  // Listing is filtered by the tool itself, including ancestors of scoped files. It never
  // grants access to the directory or needs approval to extend the scope.
  if (toolName === 'ls') return false

  // Out-of-scope file access always requires approval, whatever the mode says about writes.
  if (policy.outOfScopePath(toolName, args)) return true

  if (toolName === 'skill' && policy.skillNeedsApproval(args?.name)) return true

  // Core read tools: never need approval
  if (ORDINARY_READ_TOOLS.includes(toolName)) return false
  // The book tools a discussion in a book comes with only read, and only that book.
  if (policy.bookAnchored && BOOK_READ_TOOLS.has(toolName)) return false
  if (toolName === 'read_image' || toolName === 'look_at_drawing' || toolName === 'questions')
    return false

  // The one write with a mode of its own. It touches a single passage the person pointed
  // at, so letting it run unattended is a reasonable thing to want without opening up
  // `edit` on the whole vault. Anything short of `auto` falls through to the write rule.
  if (toolName === EDIT_SELECTION_TOOL) {
    if ((policy.toolModes[EDIT_SELECTION_TOOL] ?? 'ask') === 'auto') return false
  }

  // Feature writes need both their own mode and the ordinary write permission.
  if (DECK_WRITE_TOOLS.includes(toolName) && policy.getToolMode(toolName) !== 'auto') return true

  // Core edit tools: governed by permissionMode
  if (WRITE_TOOLS.includes(toolName)) {
    if (mode === 'allow-edit' || mode === 'allow-all') return false
    return true
  }
  if (['rm', 'mv', 'cp'].includes(toolName)) {
    if (mode === 'allow-all') return false
    return true
  }

  // Feature tools: governed by toolModes
  return (permissionKey ? policy.toolModes[permissionKey] : policy.getToolMode(toolName)) !== 'auto'
}
