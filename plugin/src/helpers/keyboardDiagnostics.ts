import { createApp, type App as VueApp } from 'vue'
import KeyboardDiagnostics from '@/components/KeyboardDiagnostics.vue'

/**
 * The keyboard diagnostics panel, on the main window's page or not.
 *
 * Its own tiny app rather than a part of the plugin's: it has to sit over everything,
 * dialogs included, which are appended to `<body>` after the plugin's own root.
 */
let mounted: { app: VueApp; el: HTMLElement } | null = null

export function setKeyboardDiagnostics(enabled: boolean): void {
  if (enabled === !!mounted) return
  if (!enabled) {
    mounted?.app.unmount()
    mounted?.el.remove()
    mounted = null
    return
  }
  const el = document.body.createDiv()
  const app = createApp(KeyboardDiagnostics)
  app.mount(el)
  mounted = { app, el }
}
