export interface ConnectionEvent {
  at: number
  text: string
}

export interface ActivityChunk {
  id: number
  first: number
  end: number
  events: readonly ConnectionEvent[]
}

const CAPACITY = 5000
const CHUNK = 64

/** Session-local history. Appending never walks or copies retained entries. */
export class ActivityHistory implements Iterable<ConnectionEvent> {
  private readonly ring = new Array<ConnectionEvent>(CAPACITY)
  private readonly rendered = new Map<number, ActivityChunk>()
  revision = 0
  get length(): number {
    return Math.min(this.revision, CAPACITY)
  }
  constructor(events: Iterable<ConnectionEvent> = []) {
    for (const event of events) this.append(event)
  }
  append(event: ConnectionEvent): void {
    this.ring[this.revision++ % CAPACITY] = event
  }
  at(index: number): ConnectionEvent | undefined {
    if (index < 0) index += this.length
    if (index < 0 || index >= this.length) return undefined
    return this.ring[(this.revision - this.length + index) % CAPACITY]
  }
  *[Symbol.iterator](): IterableIterator<ConnectionEvent> {
    for (let i = 0; i < this.length; i++)
      yield this.ring[(this.revision - this.length + i) % CAPACITY]
  }
  toJSON(): ConnectionEvent[] {
    return [...this]
  }
  /** Stable chunk references let Vue skip every unchanged group of rows. */
  chunks(): ActivityChunk[] {
    const first = this.revision - this.length
    const firstId = Math.floor(first / CHUNK)
    for (const id of this.rendered.keys()) if (id < firstId) this.rendered.delete(id)
    const result: ActivityChunk[] = []
    for (let id = firstId; id * CHUNK < this.revision; id++) {
      const start = Math.max(first, id * CHUNK)
      const end = Math.min(this.revision, (id + 1) * CHUNK)
      let chunk = this.rendered.get(id)
      if (!chunk || chunk.first !== start || chunk.end !== end) {
        const events: ConnectionEvent[] = []
        for (let at = start; at < end; at++) events.push(this.ring[at % CAPACITY])
        chunk = { id, first: start, end, events }
        this.rendered.set(id, chunk)
      }
      result.push(chunk)
    }
    return result
  }
}

export type ConnectionEvents = readonly ConnectionEvent[] | ActivityHistory
