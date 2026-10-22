import { h } from 'vue'
import { NodeService } from './NodeService'
import { NodeLogModel } from './NodeLogModel'
import { nodeAdvertisesMethod } from './advertisedMethods'
import { mountKit } from '@/components/obsidian/mount'
import Modal from '@/components/obsidian/Modal.vue'
import LogWindow from '@/components/nodeWork/LogWindow.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { t } from '@/i18n'
import { NodeLogSnapshots } from './NodeLogSnapshots'
const snapshots = new NodeLogSnapshots()

/** This adapter is the only place that knows the node's log method. */
export function openNodeLog(registrationId: string, at?: number): void {
  const service = NodeService.getInstance()
  const node = service.nodes.value.find((node) => node.id === registrationId)
  if (!node) return
  const connection = service.connection(registrationId)
  if (!nodeAdvertisesMethod(connection.client, 'node.log.v1.tail')) return
  const model = new NodeLogModel(
    {
      online: () => connection.state.value === 'connected',
      read: (params) => connection.client.request('node.log.v1.tail', params),
    },
    at
  )
  model.version.value = connection.version?.value ?? ''
  const authority = connection.authorizationGeneration
  const previous = snapshots.read(connection, authority)
  if (previous) {
    model.lines.value = previous.lines
    model.version.value ||= previous.version
  }
  const host = GlobalStore.getInstance().app.workspace.containerEl.ownerDocument.body.createDiv()
  const close = () => {
    if (connection.authorizationGeneration === authority)
      snapshots.remember(connection, authority, model.lines.value, model.version.value)
    model.destroy()
    ui.unmount()
  }
  const ui = mountKit(
    host,
    {
      render: () =>
        h(
          Modal,
          {
            title: `${node.label} · ${t('node.log.title')}`,
            size: 'tall',
            modalClass: 'abele-node-log-modal',
            onClose: close,
          },
          {
            default: () =>
              h(LogWindow, {
                model,
                version: model.version.value,
                offline: connection.state.value !== 'connected',
              }),
          }
        ),
    },
    null,
    { remove: true }
  )
  void model.refresh()
}
