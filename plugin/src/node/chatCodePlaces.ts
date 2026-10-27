import { NodeService } from './NodeService'
import { NodePathService } from './NodePathService'
import { wirePathTarget } from './nodePathChat'
import type { ChatCodePlace } from './openChatCodeLink'
import {
  coversNodeScope,
  nodeTargetId,
  type NodeScopeEntry,
  type NodeScopeTarget,
} from '@/ai/nodeScope'

/** Cached folder identities only; rendering a citation never reads file contents. */
export function chatCodePlaces(
  scopes: NodeScopeEntry[],
  current?: NodeScopeTarget
): ChatCodePlace[] {
  if (!scopes.length) return []
  const places: ChatCodePlace[] = []
  const selected = (target: NodeScopeTarget) =>
    !!current &&
    target.node_id === current.node_id &&
    target.project_id === current.project_id &&
    target.target.kind === current.target.kind &&
    nodeTargetId(target.target) === nodeTargetId(current.target)
  for (const node of NodeService.getInstance().nodes.value) {
    if (!scopes.some((scope) => scope.node_id === node.expectedNodeId)) continue
    try {
      const model = NodePathService.getInstance().model(node.id)
      for (const path of model.targets.value) {
        const target = {
          node_id: path.nodeId,
          project_id: path.projectId,
          target: wirePathTarget(path),
        }
        if (!scopes.some((scope) => coversNodeScope(scope, target, 'read'))) continue
        places.push({
          target,
          root:
            model.copy(path)?.path ??
            (path.kind === 'workspace'
              ? model.folders.value.find((folder) => folder.id === path.projectId)?.path
              : undefined),
          current: selected(target),
        })
      }
    } catch {
      // An unavailable registration cannot resolve an absolute filesystem path.
    }
  }
  for (const scope of scopes) {
    if (scope.kind !== 'target') continue
    const target = { node_id: scope.node_id, project_id: scope.project_id, target: scope.target }
    if (!places.some((place) => JSON.stringify(place.target) === JSON.stringify(target)))
      places.push({ target, current: selected(target) })
  }
  return places
}
