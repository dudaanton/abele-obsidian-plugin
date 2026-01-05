import { App } from 'obsidian'

/**
 * Waits for Obsidian Sync to complete before executing a callback.
 * If sync is not enabled or already synced, executes immediately.
 */
export function runAfterSync(app: App, callback: () => void): void {
  const sync = (app as any).internalPlugins?.plugins?.sync?.instance

  if (!sync || sync.syncStatus?.toLowerCase() === 'fully synced') {
    callback()
    return
  }

  const onStatusChange = () => {
    if (sync.syncStatus?.toLowerCase() === 'fully synced') {
      sync.off('status-change', onStatusChange)
      callback()
    }
  }

  sync.on('status-change', onStatusChange)
}
