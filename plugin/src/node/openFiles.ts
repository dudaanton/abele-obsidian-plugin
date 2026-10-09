import { createApp } from 'vue'
import NodeFilesDialog from '@/components/NodeFilesDialog.vue'
import type { NodeFilesModel, CodeLineRange } from './NodeFilesModel'
import { NodeService, type NodeConnection } from './NodeService'
import { openNodeRepository } from './openRepository'
/** Presentation only; all file traffic stays behind the client's injected connector. */
export function openNodeFiles(
  model: NodeFilesModel,
  connection: Pick<NodeConnection, 'state'>,
  initialPath?: string,
  initialRange?: CodeLineRange,
  subscribeChanges?: (listener: () => void) => () => void
): void {
  const host = document.body.createDiv()
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    ui.unmount()
    host.remove()
  }
  const ui = createApp(NodeFilesDialog, {
    model,
    connection,
    initialPath,
    initialRange,
    subscribeChanges,
    onRepository: async () => {
      const service = NodeService.getInstance()
      const node = service.nodes.value.find((node) => node.expectedNodeId === model.nodeId)
      if (!node) throw new Error('Reconnect this node before opening its repository.')
      const connection = service.connection(node.id)
      await connection.connect()
      const workspace = await connection.client.getWorkspace(model.workspaceId)
      return openNodeRepository(node.id, workspace.project_id, model.workspaceId)
    },
    onClose: close,
  })
  ui.mount(host)
}
