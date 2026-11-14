/** Opt-in, page-scoped diagnostics. No note text, paths, or DOM content is retained. */
export const COLUMN_FLIGHT_FLAG = 'abele-columns-flight'
export const COLUMN_FLIGHT_BUFFER = 'abele-columns-flight-buffer'

interface FlightRecord {
  t: number
  site: string
  docLen: number
  viewportFrom: number
  viewportTo: number
  counter: number
}
interface FlightSnapshot {
  version: 1
  epoch: string
  entries: FlightRecord[]
}
interface FlightStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
interface FlightClock {
  now(): number
  schedule(callback: () => void): () => void
}
interface FlightView {
  state: { doc: { length: number } }
  viewport: { from: number; to: number }
}
const capacity = 500
const clock: FlightClock = {
  now: () => Date.now(),
  schedule: (callback) => {
    const timer = window.setInterval(callback, 100)
    return () => window.clearInterval(timer)
  },
}

export class ColumnFlightRecorder {
  private ring: FlightRecord[] = []
  private next = 0
  private counter = 0
  private pending = 0
  private lastPersist: number
  private docLen = -1
  private viewportFrom = -1
  private viewportTo = -1
  private closed = false
  private persistenceFailed = false
  private cancel: () => void

  constructor(
    private readonly storage: FlightStorage,
    private readonly epoch: string,
    private readonly clock: FlightClock
  ) {
    this.lastPersist = clock.now()
    try {
      const saved = JSON.parse(
        storage.getItem(COLUMN_FLIGHT_BUFFER) ?? 'null'
      ) as FlightSnapshot | null
      if (saved?.version === 1 && saved.epoch === epoch && Array.isArray(saved.entries)) {
        this.ring = saved.entries.filter(isRecord).slice(-capacity)
        this.next = this.ring.length % capacity
        const last = this.ring.at(-1)
        if (last) {
          this.counter = last.counter
          this.docLen = last.docLen
          this.viewportFrom = last.viewportFrom
          this.viewportTo = last.viewportTo
        }
      }
    } catch {
      // A partial or unavailable diagnostic store must not affect editing.
    }
    this.cancel = clock.schedule(() => this.flush())
  }

  record(
    site: string,
    docLen = this.docLen,
    viewportFrom = this.viewportFrom,
    viewportTo = this.viewportTo
  ): void {
    if (this.closed) return
    const t = this.clock.now()
    this.docLen = docLen
    this.viewportFrom = viewportFrom
    this.viewportTo = viewportTo
    this.ring[this.next] = { t, site, docLen, viewportFrom, viewportTo, counter: ++this.counter }
    this.next = (this.next + 1) % capacity
    this.pending++
    // This elapsed-time check also works while a synchronous loop starves timers.
    if (this.counter === 1 || this.pending >= 20 || t - this.lastPersist >= 100) this.flush()
  }

  state(site: string, state: FlightView['state']): void {
    // A StateField rebuild precedes the view's new viewport. Mark it unknown explicitly.
    this.record(site, state.doc.length, -1, -1)
  }

  view(site: string, view: FlightView): void {
    this.record(site, view.state.doc.length, view.viewport.from, view.viewport.to)
  }

  checkpoint(site: string): void {
    this.record(site)
    this.flush()
  }

  flush(): void {
    if (this.closed || !this.pending || this.persistenceFailed) return
    const snapshot: FlightSnapshot = {
      version: 1,
      epoch: this.epoch,
      entries:
        this.ring.length < capacity
          ? this.ring.slice()
          : [...this.ring.slice(this.next), ...this.ring.slice(0, this.next)],
    }
    try {
      this.storage.setItem(COLUMN_FLIGHT_BUFFER, JSON.stringify(snapshot))
      this.pending = 0
      this.lastPersist = this.clock.now()
    } catch {
      this.persistenceFailed = true
      console.warn('Abele: column flight persistence unavailable')
    }
  }

  destroy(): void {
    if (this.closed) return
    this.flush()
    this.closed = true
    this.cancel()
  }
}

function isRecord(value: FlightRecord): boolean {
  return (
    !!value &&
    typeof value.site === 'string' &&
    [value.t, value.docLen, value.viewportFrom, value.viewportTo, value.counter].every(
      Number.isFinite
    )
  )
}

/** A flag from a previous WebView load must leave the frozen trace untouched. */
export function createColumnFlight(
  storage: FlightStorage,
  epoch: string,
  time: FlightClock = clock
): ColumnFlightRecorder | undefined {
  try {
    if (storage.getItem(COLUMN_FLIGHT_FLAG) !== epoch) return undefined
    return new ColumnFlightRecorder(storage, epoch, time)
  } catch {
    return undefined
  }
}

// Optional calls at instrumentation sites do not allocate contexts or read storage when off.
export let columnFlight: ColumnFlightRecorder | undefined
export function setColumnFlight(recorder: ColumnFlightRecorder | undefined): void {
  columnFlight = recorder
}
