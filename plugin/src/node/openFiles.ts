import { UiError, uiMessage } from '@/i18n/streamBErrors'
import NodeFilesDialog from '@/components/NodeFilesDialog.vue'
import { mountKit } from '@/components/obsidian/mount'
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
  const close = () => ui.unmount()
  const ui = mountKit(
    document.body.createDiv(),
    NodeFilesDialog,
    {
      model,
      registrationId: NodeService.getInstance().nodes.value.find(
        (node) => node.expectedNodeId === model.nodeId
      )?.id,
      connection,
      initialPath,
      initialRange,
      subscribeChanges,
      onRepository: async () => {
        const service = NodeService.getInstance()
        const node = service.nodes.value.find((node) => node.expectedNodeId === model.nodeId)
        if (!node) throw new UiError(uiMessage('streamBError.4ec802bae5'))
        const connection = service.connection(node.id)
        await connection.connect()
        const workspace = await connection.client.getWorkspace(model.workspaceId)
        return openNodeRepository(node.id, workspace.project_id, model.workspaceId)
      },
      onClose: close,
    },
    { remove: true }
  )
}
