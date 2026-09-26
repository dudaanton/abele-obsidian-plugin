import type { App } from 'obsidian'

/**
 * Opening the plugin's settings on one of its tabs, from somewhere else in the app.
 *
 * The settings are mounted afresh each time Obsidian shows them, so the tab asked for is left
 * here and taken by `Settings.vue` as it mounts — once, so the next ordinary opening starts
 * where it always does.
 */
let pending: string | null = null

export function openAbeleSettings(app: App, tab: string): void {
  pending = tab
  const setting = (
    app as unknown as {
      setting?: { open?: () => void; openTabById?: (id: string) => void }
    }
  ).setting
  setting?.open?.()
  setting?.openTabById?.('abele')
}

export function takePendingTab(): string | null {
  const tab = pending
  pending = null
  return tab
}
