import SecretsListModal from '@/components/settings/SecretsListModal.vue'
import { mountKit } from '@/components/obsidian/mount'

/**
 * Opens the list of keys on its own, for the layout probes. In the plugin it opens from
 * Settings → Transfer → Synced keys, which on a phone is several taps deep; the dialog is the
 * same either way. Closing it takes it down again.
 */
export function openSecretsList(): void {
  const close = () => app.unmount()
  const app = mountKit(
    document.body.createDiv(),
    SecretsListModal,
    { onClose: close },
    { remove: true }
  )
}
