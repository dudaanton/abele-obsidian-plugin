import type { Plugin } from 'obsidian'

/** A queued host callback may outlive plugin unload. Release its work on disposal. */
export function onPluginLayoutReady(plugin: Plugin, callback: () => void): void {
  let pending: (() => void) | undefined = callback
  plugin.register(() => {
    pending = undefined
  })
  plugin.app.workspace.onLayoutReady(() => {
    const run = pending
    pending = undefined
    run?.()
  })
}
