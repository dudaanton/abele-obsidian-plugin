import {
  coversNodeScope,
  nodeTargetId,
  type NodeScopeEntry,
  type NodeScopeTarget,
} from '@/ai/nodeScope'
import { openNodeToolFile } from './openToolFile'
import { resolveNodeCodeLink } from './codeLinks'

export interface ChatCodePlace {
  target: NodeScopeTarget
  root?: string
  current?: boolean
}
/** Resolve only within readable places, preferring the current folder for relative paths. */
export function chatCodeLinkTarget(
  resource: string,
  scopes: NodeScopeEntry[],
  places: ChatCodePlace[] = []
): NodeScopeTarget | undefined {
  const valid = (place: ChatCodePlace) => {
    const target = place.target
    return (
      scopes.some((scope) => coversNodeScope(scope, target, 'read')) &&
      !!resolveNodeCodeLink(
        resource,
        {
          nodeId: target.node_id,
          registrationId: '',
          projectId: target.project_id,
          kind: target.target.kind,
          id: nodeTargetId(target.target),
        },
        place.root
      )
    )
  }
  const candidates = places.filter(valid)
  const preferred = candidates.filter((place) => place.current)
  if (preferred.length === 1) return preferred[0].target
  if (candidates.length === 1) return candidates[0].target
  if (candidates.length > 1) return
  let target: NodeScopeTarget | undefined
  if (resource.startsWith('abele-node-code:')) {
    try {
      const data = JSON.parse(decodeURIComponent(resource.slice('abele-node-code:'.length)))
      const [node, project, kind, id] = data.scope
      if (
        ![node, project, id].every((value) => typeof value === 'string') ||
        !['worktree', 'workspace'].includes(kind)
      )
        return
      target = {
        node_id: node,
        project_id: project,
        target:
          kind === 'worktree' ? { kind, worktree_id: id } : { kind: 'workspace', workspace_id: id },
      }
    } catch {
      return
    }
  } else {
    const exact = scopes.filter((entry) => entry.kind === 'target')
    const unique = new Map(
      exact.map((entry) => [
        JSON.stringify([
          entry.node_id,
          entry.project_id,
          entry.target.kind,
          nodeTargetId(entry.target),
        ]),
        entry,
      ])
    )
    if (unique.size !== 1) return
    const entry = [...unique.values()][0]
    target = { node_id: entry.node_id, project_id: entry.project_id, target: entry.target }
  }
  if (!scopes.some((scope) => coversNodeScope(scope, target!, 'read'))) return
  const wire = target.target
  if (
    !resolveNodeCodeLink(resource, {
      nodeId: target.node_id,
      registrationId: '',
      projectId: target.project_id,
      kind: wire.kind,
      id: nodeTargetId(wire),
    })
  )
    return
  return target
}
export async function openChatCodeLink(
  resource: string,
  scopes: NodeScopeEntry[],
  places: ChatCodePlace[] = []
): Promise<void> {
  const target = chatCodeLinkTarget(resource, scopes, places)
  if (!target) return
  await openNodeToolFile(resource, target)
}
