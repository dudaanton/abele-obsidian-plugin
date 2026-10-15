import ProtocolWriteModal from '@/components/protocol/ProtocolWriteModal.vue'
import { mountKit } from '@/components/obsidian/mount'
import type { ProtocolWrite } from './protocolWrite'

/** Closing in any way other than the affirmative button writes nothing. */
export function confirmProtocolWrite(write: ProtocolWrite): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false
    let open = true
    const ui = mountKit(
      activeDocument.body.createDiv(),
      ProtocolWriteModal,
      {
        write,
        onConfirm: () => {
          confirmed = true
        },
        onClose: () => {
          if (!open) return
          open = false
          ui.unmount()
          resolve(confirmed)
        },
      },
      { remove: true }
    )
  })
}
