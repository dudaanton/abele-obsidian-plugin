export interface ConnectionRuntime {
  start(): Promise<void>
  invalidate(): void
  close(): Promise<void>
}
/** Independent runtimes. No connection's start/failure becomes another connection's queue. */
export class ConnectionEngines {
  private readonly runtimes = new Map<
    string,
    { runtime: ConnectionRuntime; starting: Promise<void>; retiring: boolean }
  >()
  private closed = false
  start(
    ids: string[],
    create: (id: string) => ConnectionRuntime,
    failed: (id: string, error: unknown) => void
  ): void {
    if (this.closed) throw new Error('Connection engines are closed')
    for (const id of ids) {
      if (this.runtimes.has(id)) continue
      let runtime: ConnectionRuntime
      try {
        runtime = create(id)
      } catch (error) {
        failed(id, error)
        continue
      }
      const owned = { runtime, starting: Promise.resolve(), retiring: false }
      owned.starting = Promise.resolve()
        .then(() => {
          const held = this.runtimes.get(id)
          if (!this.closed && held === owned && !owned.retiring) return runtime.start()
        })
        .catch((error) => {
          failed(id, error)
        })
      this.runtimes.set(id, owned)
    }
  }
  async settled(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((one) => one.starting))
  }
  /** Release one departed connection's factory closures after all its effects drain. */
  async remove(id: string): Promise<void> {
    const owned = this.runtimes.get(id)
    if (!owned) return
    owned.retiring = true
    owned.runtime.invalidate()
    await Promise.all([owned.runtime.close(), owned.starting])
    if (this.runtimes.get(id) === owned) this.runtimes.delete(id)
  }
  /** Drop a removed connection whose effects did not drain in time; it was already invalidated. */
  forget(id: string): void {
    const owned = this.runtimes.get(id)
    if (owned?.retiring) this.runtimes.delete(id)
  }
  async close(): Promise<void> {
    this.closed = true
    await this.reset()
  }
  /** Drain old effects before a host configuration change opens replacement ledgers. */
  async reset(): Promise<void> {
    const invalidationFailures: unknown[] = []
    for (const owned of this.runtimes.values()) {
      owned.retiring = true
      try {
        owned.runtime.invalidate()
      } catch (error) {
        // Quit cannot wait for this promise: revoke every connection before the first await.
        invalidationFailures.push(error)
      }
    }
    const closing = [...this.runtimes.values()].map(async ({ runtime, starting }) => {
      const close = runtime.close()
      await Promise.all([close, starting])
    })
    const settled = await Promise.allSettled(closing)
    const failed = settled.find((item) => item.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    this.runtimes.clear()
    if (invalidationFailures.length) throw invalidationFailures[0]
  }
}
