import KeyboardDiagnostics from '@/components/KeyboardDiagnostics.vue'
import { mountKit, type KitMount } from '@/components/obsidian/mount'

/**
 * The keyboard diagnostics panel, on the main window's page or not.
 *
 * Its own tiny app rather than a part of the plugin's: it has to sit over everything,
 * dialogs included, which are appended to `<body>` after the plugin's own root.
 */
let mounted: KitMount | null = null

export function setKeyboardDiagnostics(enabled: boolean): void {
  if (enabled === !!mounted) return
  if (!enabled) {
    mounted?.unmount()
    mounted = null
    return
  }
  mounted = mountKit(document.body.createDiv(), KeyboardDiagnostics, null, { remove: true })
}
