/** A resolved I/O promise is not a browser task boundary, especially for buffered reads. */
export class SyncTaskBudget {
  private bytes = 0
  private since = performance.now()

  async account(bytes: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    this.bytes += bytes
    if (this.bytes < 1024 * 1024 && performance.now() - this.since < 8) return
    this.bytes = 0
    const host = window as Window & {
      scheduler?: { yield?: () => Promise<void> }
    }
    const scheduler = host.scheduler
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
    else await new Promise<void>((resolve) => host.setTimeout(resolve, 0))
    this.since = performance.now()
    signal?.throwIfAborted()
  }
}
