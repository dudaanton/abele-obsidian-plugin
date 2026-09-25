import { createApp } from 'vue'
import SecretsListModal from '@/components/settings/SecretsListModal.vue'

/**
 * Opens the list of keys on its own, for the layout probes. In the plugin it opens from
 * Settings → Transfer → Synced keys, which on a phone is several taps deep; the dialog is the
 * same either way. Closing it takes it down again.
 */
export function openSecretsList(): void {
  const host = document.body.createDiv()
  let open = true
  const close = () => {
    if (!open) return
    open = false
    app.unmount()
    host.remove()
  }
  const app = createApp(SecretsListModal, { onClose: close })
  app.mount(host)
}
