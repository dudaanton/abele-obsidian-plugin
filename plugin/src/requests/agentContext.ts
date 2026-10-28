// The saved requests the agent's tools work on: the project the Requests view shows.
import type { RequestToolContext } from '@/ai/tools/RequestTools'
import { RequestsService } from './RequestsService'
import { outgoing, varsOf } from './resolve'
import type { ChatSession } from '@/ai/ChatSession'
import {
  coversNodeScope,
  nodeScopeEntries,
  nodeTargetId,
  type NodeScopeTarget,
} from '@/ai/nodeScope'
import { nodeAgentHost } from '@/ai/tools/node/owner'
import type { NodeAgentHostFactory } from '@/ai/tools/node/agent'
import { resolveNodeTarget } from '@/ai/tools/node/guidance'
import { nodeProjectGuard } from '@/ai/tools/node/projectAccess'

/** Chat scope chooses the location; a panel selection never supplies authority. */
export async function scopedRequestsContext(
  params: Record<string, unknown>,
  session?: ChatSession,
  factory: NodeAgentHostFactory = nodeAgentHost
): Promise<RequestToolContext | undefined> {
  if (!session) return activeRequestsContext()
  const scopes = nodeScopeEntries(session)
  const host = await factory()
  const requested = typeof params.node === 'string' ? params.node.trim() : ''
  const nodes = [...new Set(scopes.map((entry) => entry.node_id))]
  const selected = session.overrides.value.nodeTarget
  const aliases = host
    .nodes()
    .filter((node) => [node.id, node.node_id, node.label].includes(requested))
  const ids = [...new Set(aliases.map((node) => host.nodeId?.(node.id) ?? node.node_id ?? node.id))]
  const node = requested
    ? ids.length === 1
      ? ids[0]
      : (host.nodeId?.(requested) ?? requested)
    : selected
      ? selected.node_id
      : nodes.length === 1
        ? nodes[0]
        : undefined
  const panel = RequestsService.instance().context.value
  const candidates = scopes.filter((entry) => entry.node_id === node)
  const projects = [
    ...new Set(candidates.flatMap((entry) => (entry.kind === 'node' ? [] : [entry.project_id]))),
  ]
  const project =
    typeof params.project === 'string' && params.project
      ? params.project
      : selected && selected.node_id === node
        ? selected.project_id
        : projects.length === 1
          ? projects[0]
          : panel && (host.nodeId?.(panel.registrationId) ?? panel.registrationId) === node
            ? panel.projectId
            : undefined
  if (!node || !project)
    throw new Error(
      'Call node_folders and pass node, project and workspace to select a granted Requests project.'
    )
  const targets = candidates.filter(
    (entry) => entry.kind === 'target' && entry.project_id === project
  )
  const target =
    selected && selected.node_id === node && selected.project_id === project
      ? selected.target
      : targets.length === 1 && targets[0].kind === 'target'
        ? targets[0].target
        : undefined
  const workspace =
    typeof params.workspace === 'string' && params.workspace
      ? params.workspace
      : target
        ? nodeTargetId(target)
        : panel?.projectId === project &&
            (host.nodeId?.(panel.registrationId) ?? panel.registrationId) === node
          ? panel.worktreeId
          : undefined
  const place: NodeScopeTarget | undefined = workspace
    ? {
        node_id: node,
        project_id: project,
        target:
          target?.kind === 'workspace'
            ? { kind: 'workspace', workspace_id: workspace }
            : { kind: 'worktree', worktree_id: workspace },
      }
    : undefined
  if (!candidates.some((entry) => entry.kind === 'node' || entry.project_id === project))
    throw new Error(
      'Requests project is outside this chat node access. Call node_folders to select an allowed project.'
    )
  if (place) {
    const connection = host.connection(node, session)
    const guard = host.ledger.guardNode(session, node, connection.principal())
    guard()
    await resolveNodeTarget(connection.client, place, scopes, guard)
    guard()
  }
  if (
    !candidates.some((entry) =>
      place
        ? coversNodeScope(entry, place, 'read')
        : entry.kind === 'node' || (entry.kind === 'project' && entry.project_id === project)
    )
  )
    throw new Error(
      'Requests target is outside this chat node access. Call node_folders to select an allowed worktree.'
    )
  // Resolve the stable daemon ID to the local transport registration for RequestsService.
  const registrations = host
    .nodes()
    .filter((entry) => (host.nodeId?.(entry.id) ?? entry.node_id ?? entry.id) === node)
  const registrationId = registrations.length === 1 ? registrations[0].id : node
  const context = {
    registrationId,
    projectId: project,
    ...(place
      ? {
          worktreeId: nodeTargetId(place.target),
          ...(place.target.kind === 'workspace' ? { workspaceId: nodeTargetId(place.target) } : {}),
        }
      : {}),
  }
  return { ...context, model: RequestsService.instance().model(context), project }
}

export function activeRequestsContext(): RequestToolContext | undefined {
  const service = RequestsService.instance()
  const c = service.context.value
  if (!c) return undefined
  return {
    registrationId: c.registrationId,
    worktreeId: c.worktreeId,
    model: service.model(c),
    project: c.label ?? c.projectId,
  }
}

/** The request an agent's send would put on the wire, for the card asking the person: keys and
 * values kept in memory still by name. */
export async function sendPreview(
  id: string,
  environment?: string,
  params?: Record<string, unknown>,
  session?: ChatSession
): Promise<{ environment: string; text: string } | undefined> {
  const c =
    params && session ? await scopedRequestsContext(params, session) : activeRequestsContext()
  if (!c || !id) return undefined
  const guard = session
    ? await nodeProjectGuard(session, 'http_request_read', {
        ...c,
        ...(c.workspaceId ? { worktreeId: undefined } : {}),
        projectId: c.model.projectId,
      })
    : () => {}
  const m = c.model
  const name = environment ?? m.state.environment
  const fileEnvironment = m.files?.environments.find((e) => e.id === name)
  if (name && m.files?.wasEnvironment(name) && !fileEnvironment)
    throw new Error('The environment file is gone')
  const env =
    fileEnvironment?.doc ??
    (name && name !== m.state.environment
      ? await m.rpc.environment(m.projectId, name)
      : m.state.env)
  const doc = m.entry(id).doc ?? (await m.rpc.get(m.projectId, id))
  guard()
  const vars = varsOf(env, {})
  if (fileEnvironment)
    for (const exposed of fileEnvironment.exposed) {
      if (fileEnvironment.locations[exposed.key] === exposed.file) delete vars[exposed.key]
    }
  const out = outgoing(doc, vars)
  const plain = (t: string) => t.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
  const scripts = [
    doc.scripts.before
      ? `# The script ${plain(doc.scripts.before)} runs first and may change this.`
      : '',
    doc.scripts.after ? `# The script ${plain(doc.scripts.after)} reads the answer.` : '',
  ].filter(Boolean)
  return {
    environment: name ?? 'No environment',
    text: [
      ...scripts,
      `${out.method} ${out.url}`,
      ...Object.entries(out.headers).map(([k, v]) => `${k}: ${v}`),
      ...(out.body !== undefined ? ['', out.body] : []),
    ].join('\n'),
  }
}
