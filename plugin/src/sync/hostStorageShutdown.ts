import type { HostSyncStorage } from './hostSyncStorage'
import { recordTeardown } from './teardownBarrier'

export function retireHostStorage(
  app: object,
  storage: HostSyncStorage,
  stopping: Promise<unknown>
): Promise<void> {
  let stopped = false
  let retrying: Promise<void> | undefined
  const finish = async () => {
    try {
      await storage.flush()
    } catch (error) {
      console.debug('Settings section storage flush failed', error)
      // The next store replays this receipt before settings are loaded. If even the
      // receipt could not commit, retain this live queue and retry it before reopening.
      if (!storage.hasDurableSnapshotRetry) throw error
    }
    storage.close()
  }
  const closing = stopping.then(() => {
    stopped = true
    return finish()
  })
  recordTeardown(app, closing, async (error) => {
    // Engine shutdown failures remain blocked: storage retry cannot stop an engine.
    if (!stopped) throw error
    if (retrying === undefined)
      retrying = storage
        .retainSnapshotsOnFreshConnection()
        .then(() => storage.close())
        .finally(() => {
          retrying = undefined
        })
    await retrying
  })
  return closing
}
