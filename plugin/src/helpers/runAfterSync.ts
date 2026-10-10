import { App } from 'obsidian'
import { tokenUi } from '@/sync/tokenUi'
import { watch } from 'vue'

/**
 * Waits for the vault to have settled before executing a callback.
 *
 * Two syncs can be moving a vault at once, so both are waited for in turn: Obsidian Sync
 * first, as this helper always did, and then Abele Sync. A script that renames notes or reads
 * a folder wants the disk to have stopped moving under it, and it does not care which service
 * was moving it.
 *
 * Neither wait is a promise that everything is up to date — it is a promise that nothing is in
 * flight. A device that is offline, paused or in error is not going to settle by being waited
 * on, and a callback held for that would simply never run.
 */
export function runAfterSync(app: App, callback: () => void): void {
  afterObsidianSync(app, () => afterAbeleSync(callback))
}

/**
 * Waits for Obsidian Sync to complete. If sync is not enabled or already synced, executes
 * immediately.
 */
function afterObsidianSync(app: App, callback: () => void): void {
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

/** Waits for the Abele Sync engine to have nothing in flight. */
function afterAbeleSync(callback: () => void): void {
  const settled = () =>
    !(tokenUi.value?.rows.value ?? []).some(
      (row) => row.status === 'syncing' || row.status === 'joining'
    )
  if (settled()) {
    callback()
    return
  }

  // `done` rather than the unsubscribe alone: a status change while the callback runs would
  // otherwise reach a listener that has been removed from one copy of the set and not the other.
  let done = false
  const unsubscribe = watch(
    settled,
    (ready) => {
      if (done || !ready) return
      done = true
      unsubscribe()
      callback()
    },
    { flush: 'sync' }
  )
}
