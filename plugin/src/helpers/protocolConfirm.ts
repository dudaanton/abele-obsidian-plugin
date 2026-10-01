import { createApp } from 'vue'
import ProtocolWriteModal from '@/components/protocol/ProtocolWriteModal.vue'
import type { ProtocolWrite } from './protocolWrite'

/** Closing in any way other than the affirmative button writes nothing. */
export function confirmProtocolWrite(write: ProtocolWrite): Promise<boolean> {
  return new Promise((resolve) => {
    const host = activeDocument.body.createDiv()
    let confirmed = false
    let open = true
    const ui = createApp(ProtocolWriteModal, {
      write,
      onConfirm: () => {
        confirmed = true
      },
      onClose: () => {
        if (!open) return
        open = false
        ui.unmount()
        host.remove()
        resolve(confirmed)
      },
    })
    ui.mount(host)
  })
}
