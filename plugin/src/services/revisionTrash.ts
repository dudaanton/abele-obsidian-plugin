import type { App, TFile } from 'obsidian'

/** Obsidian's adapters serialize filesystem operations through this shared queue. */
interface QueuedAdapter {
  queue<T>(action: () => Promise<T>): Promise<T>
  read(path: string): Promise<string>
  exists(path: string): Promise<boolean>
}
interface TrashRequest {
  path: string
  file: TFile
  revision: string
  checked: boolean
}
const requests = new WeakMap<object, Map<string, TrashRequest>>()
const guardedAdapters = new WeakSet<object>()

/** Installed only together with the native mutation-boundary guards. */
export function registerRevisionTrash(adapter: object): () => void {
  guardedAdapters.add(adapter)
  return () => {
    guardedAdapters.delete(adapter)
  }
}

/** The guard is consumed at the native boundary, after approval/recording wrappers. */
export async function trashIfRevision(app: App, file: TFile, revision: string): Promise<void> {
  const adapter = app.vault.adapter as unknown as QueuedAdapter
  if (!guardedAdapters.has(adapter) || typeof adapter.queue !== 'function')
    throw new Error('This storage cannot perform revision-checked deletion')
  let active = requests.get(adapter)
  if (!active) {
    active = new Map()
    requests.set(adapter, active)
  }
  const path = file.path
  if (active.has(path)) throw new Error('The comment is already being deleted')
  const request = { path, file, revision, checked: false }
  active.set(path, request)
  try {
    await app.fileManager.trashFile(file)
    if (!request.checked || (await adapter.exists(path)))
      throw new Error('The comment was not deleted. Its marker was retained')
  } finally {
    active.delete(path)
  }
}

/** Enter a native queued operation inside the queue item we already own, without requeuing. */
function insideQueue<T>(adapter: QueuedAdapter, operation: () => Promise<T>): Promise<T> {
  const queue = adapter.queue
  adapter.queue = <R>(action: () => Promise<R>) => Promise.resolve().then(action)
  try {
    return operation()
  } finally {
    adapter.queue = queue
  }
}

/**
 * ONE shared adapter queue item contains the fresh revision read and the native trash action.
 * Sync writes using the adapter cannot enter between them. Out-of-band filesystem writers
 * do not participate in this queue; this is not an operating-system compare-and-unlink API.
 */
export function guardTrashRevision<T>(
  adapterObject: object,
  path: string,
  nativeTrash: () => Promise<T>
): Promise<T> {
  const active = requests.get(adapterObject)
  const request =
    active?.get(path) ?? [...(active?.values() ?? [])].find((item) => item.file.path === path)
  if (!request) return nativeTrash()
  const adapter = adapterObject as QueuedAdapter
  return adapter.queue(async () => {
    if (request.path !== path || request.file.path !== path)
      throw new Error('The comment moved. Reopen it before deleting')
    const current = await insideQueue(adapter, () => adapter.read(path))
    if (current !== request.revision)
      throw new Error('The comment changed elsewhere. Reopen it before deleting')
    request.checked = true
    return insideQueue(adapter, nativeTrash)
  })
}
