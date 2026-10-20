import { ConnectionSets, type StoredSetItem, type SetItem } from './connectionSets'

export interface ItemRuntime {
  sync(): Promise<void>
  /** Must stop watchers, sockets and drain pending writes; never delete local files. */
  close(): Promise<void>
}
export interface ItemEnginePort {
  /** null means the authenticated server has no item-set route (404). */
  read(connectionId: string): Promise<SetItem[] | null>
  open(connectionId: string, item: StoredSetItem): Promise<ItemRuntime>
}

/** The host supplies ordinary per-share engines; membership and device lifecycle stay here. */
export class ItemSetEngines {
  private readonly live = new Map<string, Map<string, ItemRuntime>>()
  private readonly pending = new Map<string, Promise<void>>()
  private closed = false
  private closing?: Promise<void>
  constructor(
    private readonly sets: ConnectionSets,
    private readonly port: ItemEnginePort
  ) {}

  sync(connectionId: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Item engine host is closed'))
    const previous = this.pending.get(connectionId) ?? Promise.resolve()
    const work = previous
      .catch(() => {})
      .then(async () => {
        if (this.closed) return
        await this.sets.refresh(connectionId, () => this.port.read(connectionId))
        if (this.closed) return
        const connection = this.sets.get(connectionId)
        if (!connection) throw new Error('Unknown connection set')
        let engines = this.live.get(connectionId)
        if (!engines) {
          engines = new Map()
          this.live.set(connectionId, engines)
        }
        for (const [id, runtime] of engines) {
          const item = connection.items.find((one) => one.id === id)
          if (!item || item.detached || item.paused) {
            await runtime.close()
            engines.delete(id)
          }
        }
        const failures: unknown[] = []
        for (const item of connection.items) {
          if (this.closed) return
          if (item.detached || item.paused) continue
          try {
            let runtime = engines.get(item.id)
            if (!runtime) {
              runtime = await this.port.open(connectionId, item)
              engines.set(item.id, runtime)
            }
            if (this.closed) return
            await runtime.sync()
          } catch (error) {
            failures.push(error)
          }
        }
        if (failures.length) throw new AggregateError(failures, 'Some share items could not sync')
      })
    this.pending.set(connectionId, work)
    void work
      .finally(() => {
        if (this.pending.get(connectionId) === work) this.pending.delete(connectionId)
      })
      .catch(() => {})
    return work
  }
  foreground(connectionId: string): Promise<void> {
    return this.sync(connectionId)
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    this.closing = (async () => {
      await Promise.allSettled([...this.pending.values()])
      const errors: unknown[] = []
      for (const engines of this.live.values())
        for (const [id, runtime] of engines) {
          try {
            await runtime.close()
            engines.delete(id)
          } catch (error) {
            errors.push(error)
          }
        }
      if (errors.length) throw new AggregateError(errors, 'Item engines could not finish stopping')
      this.live.clear()
    })()
    return this.closing
  }
}
