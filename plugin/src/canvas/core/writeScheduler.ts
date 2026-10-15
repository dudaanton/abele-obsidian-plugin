/**
 * Writes local canvas changes later and less often than they are made: once the person pauses
 * for `idle` ms, and at the latest `max` ms after the first unwritten change. The screen and undo
 * never wait for it; `flush` writes at once where waiting would lose work (closing, leaving the
 * app, another writer or reader of the file).
 */
export interface CanvasWriteSchedule {
  idle: number
  max: number
}
export const CANVAS_WRITE_SCHEDULE: CanvasWriteSchedule = { idle: 1500, max: 5000 }

/** The host's timers, so popout windows and tests keep their own. */
export interface CanvasWriteTimers {
  set(run: () => void, ms: number): number
  clear(id: number): void
}
export interface CanvasWritePorts<D> {
  /** Unwritten local work that may be written now. */
  pending(document: D): boolean
  write(document: D): Promise<unknown>
  /** A write failed; the work stays in memory. */
  failed(document: D, error: unknown): void
}

export class CanvasWriteScheduler<D> {
  private timer: number | null = null
  private first: number | null = null
  private target: D | null = null
  private running: Promise<boolean> | null = null
  private disposed = false

  constructor(
    private readonly ports: CanvasWritePorts<D>,
    private readonly timers: CanvasWriteTimers,
    private readonly schedule: CanvasWriteSchedule = CANVAS_WRITE_SCHEDULE
  ) {}

  /** A local change was made; write it after the next pause. */
  changed(document: D): void {
    if (this.disposed) return
    const now = Date.now()
    if (this.target !== document) this.first = null
    this.target = document
    this.first ??= now
    this.clear()
    const delay = Math.max(0, Math.min(this.schedule.idle, this.first + this.schedule.max - now))
    this.timer = this.timers.set(() => {
      this.timer = null
      void this.write(document, false)
    }, delay)
  }

  /** Write everything now. Resolves false when a write failed and work is still in memory. */
  flush(document: D | null = this.target): Promise<boolean> {
    this.clear()
    return document === null ? Promise.resolve(true) : this.write(document, true)
  }

  /** Stop timers; a write already started still finishes. */
  dispose(): void {
    this.disposed = true
    this.clear()
  }

  private clear(): void {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
  }

  private async write(document: D, all: boolean): Promise<boolean> {
    // Changes made during a flush are written by the same flush, a few rounds at most.
    for (let round = 0; round < (all ? 4 : 1); round++) {
      while (this.running !== null) await this.running
      if (!this.ports.pending(document)) {
        if (this.target === document) this.first = null
        return true
      }
      if (this.target === document) this.first = null
      const attempt = this.ports.write(document).then(
        () => true,
        (error: unknown) => {
          this.ports.failed(document, error)
          return false
        }
      )
      this.running = attempt
      const ok = await attempt
      if (this.running === attempt) this.running = null
      if (!ok) return false
    }
    // Made while the last write ran: the next batch.
    if (this.ports.pending(document) && !this.disposed) this.changed(document)
    return !this.ports.pending(document)
  }
}
