import type { ChatSession } from '../../ChatSession'
import { coversNodeScope, nodeScopeEntries } from '../../nodeScope'
import { nodeToolAccess } from '../../nodeAccess'
import { nodeAgentHost } from './owner'
import type { NodeAgentHostFactory } from './agent'

/** Open project panes supply location, never permission. */
export async function nodeProjectGuard(
  session: ChatSession | undefined,
  name: string,
  place: { registrationId?: string; projectId: string; worktreeId?: string; workspaceId?: string },
  factory: NodeAgentHostFactory = nodeAgentHost,
  approved = false
): Promise<() => void> {
  if (!session || !place.registrationId)
    throw new Error('An executing chat with node folder access is required')
  const host = await factory(),
    node = host.nodeId?.(place.registrationId) ?? place.registrationId
  const connection = host.connection(place.registrationId, session)
  const principal = connection.principal(),
    generation = connection.authorizationGeneration
  const scopeGuard = host.ledger.guardNode(session, node, principal)
  const access =
    name === 'http_send'
      ? 'run'
      : ['http_request_save', 'http_import', 'trace_point_add', 'trace_note'].includes(name)
        ? 'edit'
        : 'read'
  const guard = () => {
    scopeGuard()
    const mode = session.permissionMode?.value ?? 'confirm-all'
    if (
      access !== 'read' &&
      mode !== 'allow-all' &&
      !(access === 'edit' && mode === 'allow-edit') &&
      !approved
    )
      throw new Error('This project change requires approval in the chat permission mode')
    if (
      !connection.client.connected ||
      connection.principal() !== principal ||
      connection.authorizationGeneration !== generation
    )
      throw new Error('Node connection changed during project tool execution')
    const entries = nodeScopeEntries(session)
    const target = place.worktreeId
      ? { kind: 'worktree' as const, worktree_id: place.worktreeId }
      : place.workspaceId
        ? { kind: 'workspace' as const, workspace_id: place.workspaceId }
        : undefined
    if (
      !nodeToolAccess(name, entries) ||
      !entries.some((entry) =>
        target
          ? coversNodeScope(entry, { node_id: node, project_id: place.projectId, target }, access)
          : entry.node_id === node &&
            entry.kind !== 'target' &&
            (entry.kind === 'node' || entry.project_id === place.projectId) &&
            (access === 'read' ||
              entry.access === 'run' ||
              (access === 'edit' && entry.access === 'edit'))
      )
    )
      throw new Error('This project tool is outside the chat node folder access level')
  }
  guard()
  return guard
}
