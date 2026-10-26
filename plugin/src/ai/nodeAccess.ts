import type { NodeScopeEntry } from './nodeScope'
import type { ToolMode } from './types'
import { NODE_ACTION_TOOLS } from './types'
import { NODE_AGENT_TOOL_NAMES, NODE_MANAGER_TOOLS } from './tools/node/agent'
import { NODE_MUTATION_TOOLS } from './tools/node/guidance'

export const NODE_REPOSITORY_READ_TOOLS = [
  'node_views',
  'node_tree',
  'node_file',
  'node_changes',
  'node_commits',
  'node_commit',
  'node_compare',
  'node_grep',
  'node_blame',
  'node_open',
]

/** New instructions to node agents also follow the ordinary Delegate permission. */
export function isNodeDelegateInstruction(name: string): boolean {
  return name === 'node_delegate' || name === 'node_delegation_send'
}

/** Folder access is required in addition to any ordinary tool permission. */
export function nodeToolAccess(
  name: string,
  entries: readonly NodeScopeEntry[]
): boolean | undefined {
  const run =
    NODE_ACTION_TOOLS.includes(name) || NODE_MANAGER_TOOLS.includes(name) || name === 'http_send'
  const edit =
    NODE_MUTATION_TOOLS.includes(name) ||
    [
      'node_propose_edit',
      'http_request_save',
      'http_import',
      'trace_point_add',
      'trace_note',
    ].includes(name)
  if (
    !run &&
    !edit &&
    !NODE_AGENT_TOOL_NAMES.includes(name) &&
    !NODE_REPOSITORY_READ_TOOLS.includes(name) &&
    !name.startsWith('http_') &&
    !name.startsWith('trace_')
  )
    return undefined
  return entries.some((entry) =>
    run ? entry.access === 'run' : edit ? entry.access !== 'read' : true
  )
}

/** Preserve previous command grants without widening read-only folders. */
export function migrateNodeAccess(
  entries: NodeScopeEntry[],
  modes: Record<string, ToolMode>,
  inherited: readonly NodeScopeEntry[] = []
): NodeScopeEntry[] {
  const execution = NODE_ACTION_TOOLS.some(
    (name) => modes[name] === 'ask' || modes[name] === 'auto'
  )
  return [
    ...entries.map(
      (entry): NodeScopeEntry =>
        execution && entry.access === 'edit' ? { ...entry, access: 'run' } : { ...entry }
    ),
    ...(execution
      ? inherited
          .filter((entry) => entry.access === 'edit')
          .map((entry): NodeScopeEntry => ({ ...entry, access: 'run' }))
      : []),
  ]
}
