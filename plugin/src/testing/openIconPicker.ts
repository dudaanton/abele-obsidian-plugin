import { createApp } from 'vue'
import IconPicker from '@/components/obsidian/IconPicker.vue'

/**
 * Opens the icon picker on its own, for the layout probes. In the plugin it opens from a header
 * button's form in settings, which on a phone is several taps deep; the dialog is the same
 * either way. Closing it (Escape, or picking an icon) takes it down again.
 */
export function openIconPicker(current = 'play'): void {
  const host = document.body.createDiv()
  let open = true
  const close = () => {
    if (!open) return
    open = false
    app.unmount()
    host.remove()
  }
  const app = createApp(IconPicker, { current, onClose: close, onChoose: close })
  app.mount(host)
}
