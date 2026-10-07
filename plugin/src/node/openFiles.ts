import { createApp } from 'vue'
import NodeFilesDialog from '@/components/NodeFilesDialog.vue'
import type { NodeFilesModel, CodeLineRange } from './NodeFilesModel'
import type { NodeConnection } from './NodeService'
/** Presentation only; all file traffic stays behind the client's injected connector. */
export function openNodeFiles(
  model: NodeFilesModel,
  connection: Pick<NodeConnection, 'state'>,
  initialPath?: string,
  initialRange?: CodeLineRange
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
    onClose: close,
  })
  ui.mount(host)
}
