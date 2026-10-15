import IconPicker from '@/components/obsidian/IconPicker.vue'
import { mountKit } from '@/components/obsidian/mount'

/**
 * Opens the icon picker on its own, for the layout probes. In the plugin it opens from a header
 * button's form in settings, which on a phone is several taps deep; the dialog is the same
 * either way. Closing it (Escape, or picking an icon) takes it down again.
 */
export function openIconPicker(current = 'play'): void {
  const close = () => app.unmount()
  const app = mountKit(
    document.body.createDiv(),
    IconPicker,
    { current, onClose: close, onChoose: close },
    { remove: true }
  )
}
