import { createApp, type App as VueApp } from 'vue'
import { Platform } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import QuickButton from '@/components/quick/QuickButton.vue'

/**
 * The quick button, on the page or not.
 *
 * Its own tiny app, like the keyboard diagnostics, appended to `<body>`: it floats over the
 * workspace and over a drawer. Dialogs are appended after it, and it hides itself while one is
 * open. Mounted while the setting is on and only on a phone or tablet; the component decides
 * the rest, moment to moment.
 */
let mounted: { app: VueApp; el: HTMLElement } | null = null

export function setQuickButton(enabled: boolean): void {
  if (enabled === !!mounted) return
  if (!enabled) {
    mounted?.app.unmount()
    mounted?.el.remove()
    mounted = null
    return
  }
  const el = document.body.createDiv({ cls: 'abele-quick-button-root' })
  const app = createApp(QuickButton)
  app.mount(el)
  mounted = { app, el }
}

/** As the settings say: on while it is switched on, on a phone or a tablet. */
export function applyQuickButton(): void {
  setQuickButton(AbeleConfig.getInstance().quickButton.enabled && Platform.isMobile)
}
