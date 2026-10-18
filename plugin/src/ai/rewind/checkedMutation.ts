import { UiError, uiMessage } from '@/i18n/streamBErrors'
import type { DataAdapter } from 'obsidian'
import { contentHash } from '../readGuard'
import { bytesHash, isTextPath } from './vaultFs'
import type { After } from './types'

type QueuedAdapter = DataAdapter & { queue?<T>(work: () => Promise<T>): Promise<T> }

/** Only synchronous admission bypasses the queue; other tasks still enter its ordinary tail. */
function inside<T>(adapter: QueuedAdapter, work: () => Promise<T>): Promise<T> {
  const queue = adapter.queue
  if (!queue) return work()
  adapter.queue = (action) => Promise.resolve().then(action)
  try {
    return work()
  } finally {
    adapter.queue = queue
  }
}

/** Check and native mutation share the adapter queue, just like revision-checked trash. */
export async function checkedMutation<T>(
  adapter: QueuedAdapter,
  expected: Map<string, After>,
  paths: string[],
  emptyFolders: Set<string>,
  mutate: () => Promise<T>
): Promise<T> {
  const checks = paths.filter((path) => expected.has(path))
  if (!checks.length) return mutate()
  const run = async () => {
    // A rename's source and destination form one precondition, even when this step only
    // mutates one of them. Recheck every member inside the same native queue item.
    for (const path of expected.keys()) {
      const stat = await inside(adapter, () => adapter.stat(path))
      let actual: After = null
      if (stat?.type === 'folder') actual = 'folder'
      else if (stat)
        actual = isTextPath(path)
          ? contentHash(await inside(adapter, () => adapter.read(path)))
          : bytesHash(await inside(adapter, () => adapter.readBinary(path)))
      if (actual !== expected.get(path)) throw new UiError(uiMessage('streamBError.80abc63be7'))
      if (actual === 'folder' && emptyFolders.has(path)) {
        const listing = await inside(adapter, () => adapter.list(path))
        if (listing.files.length || listing.folders.length)
          throw new UiError(uiMessage('streamBError.4306093b59'))
      }
    }
    const result = await inside(adapter, mutate)
    // trashSystem(false) asks the caller to try trashLocal; that fallback needs the same guard.
    if (result !== false) for (const path of checks) expected.delete(path)
    return result
  }
  // An adapter without a queue cannot close the read/write race. Refuse before issuing IO.
  if (!adapter.queue) throw new UiError(uiMessage('streamBError.6afac342ef'))
  return adapter.queue(run)
}
