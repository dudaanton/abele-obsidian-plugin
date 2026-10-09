export interface ConnectionRuntime {
  start(): Promise<void>
  invalidate(): void
  close(): Promise<void>
}
/** Independent runtimes. No connection's start/failure becomes another connection's queue. */
export class ConnectionEngines {
  private readonly runtimes = new Map<
    string,
    { runtime: ConnectionRuntime; starting: Promise<void> }
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
      const starting = Promise.resolve()
        .then(() => {
          if (!this.closed) return runtime.start()
        })
        .catch((error) => {
          failed(id, error)
        })
      this.runtimes.set(id, { runtime, starting })
    }
  }
  async close(): Promise<void> {
    this.closed = true
    for (const { runtime } of this.runtimes.values()) runtime.invalidate()
    const closing = [...this.runtimes.values()].map(async ({ runtime, starting }) => {
      const close = runtime.close()
      await Promise.all([close, starting])
    })
    const settled = await Promise.allSettled(closing)
    const failed = settled.find((item) => item.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    this.runtimes.clear()
  }
}
