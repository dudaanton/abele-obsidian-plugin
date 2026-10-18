import type { NodeScopeTarget } from '@/ai/nodeScope'
import { NodeService } from './NodeService'
import { bindPathTarget } from './nodePathChat'
import { openNodeChatResource } from './nodeChatPlace'

/** Saved node identity is resolved to a current registration, never to a vault path. */
export async function openNodeToolFile(path: string, target: NodeScopeTarget): Promise<void> {
  const nodes = NodeService.getInstance().nodes.value.filter(
    (node) => node.expectedNodeId === target.node_id
  )
  if (nodes.length !== 1) throw new Error('Node registration is unavailable')
  await openNodeChatResource(
    path,
    bindPathTarget(
      { nodeId: target.node_id, registrationId: nodes[0].id },
      target.project_id,
      target.target
    )
  )
}
