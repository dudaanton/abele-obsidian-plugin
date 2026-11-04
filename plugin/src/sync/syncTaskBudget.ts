/** A resolved I/O promise is not a browser task boundary, especially for buffered reads. */
export class SyncTaskBudget {
  private bytes = 0
  private since = performance.now()

  /** A path/stat row is metadata, not a file-content read. Keep the time limit. */
  metadataRow(signal?: AbortSignal): Promise<void> | undefined {
    return this.account(256, signal)
  }

  account(bytes: number, signal?: AbortSignal): Promise<void> | undefined {
    signal?.throwIfAborted()
    this.bytes += bytes
    if (this.bytes < 1024 * 1024 && performance.now() - this.since < 8) return
    this.bytes = 0
    return waitForSyncRead(yieldSyncTask(), signal).then(() => {
      this.since = performance.now()
      signal?.throwIfAborted()
    })
  }
}

/** Host task boundary shared with the SDK cooperative inventory scheduler. */
export async function yieldSyncTask(): Promise<void> {
  const scheduler =
    typeof window === 'undefined'
      ? undefined
      : (
          window as Window & {
            scheduler?: { yield?: () => Promise<void> }
          }
        ).scheduler
  if (scheduler?.yield) await scheduler.yield()
  else if (typeof MessageChannel !== 'undefined')
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        channel.port2.close()
        resolve()
      }
      channel.port2.postMessage(null)
    })
  else
    await new Promise<void>((resolve) => {
      if (typeof window !== 'undefined') window.setTimeout(resolve, 0)
      else self.setTimeout(resolve, 0)
    })
}

/** Cancel only a reader's wait; the underlying writer retains ownership and must drain. */
export async function waitForSyncRead<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  let cancel!: () => void
  try {
    return await new Promise<T>((resolve, reject) => {
      cancel = () =>
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException('Sync read cancelled', 'AbortError')
        )
      signal.addEventListener('abort', cancel, { once: true })
      void work.then(resolve, reject)
      if (signal.aborted) cancel()
    })
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}
