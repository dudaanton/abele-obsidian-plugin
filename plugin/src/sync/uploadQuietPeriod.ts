import type { FileSystem, Refusal, StateStore } from '@abele/sync-sdk/core'

export const UPLOAD_QUIET_SMALL_BYTES = 10 * 1024
export const UPLOAD_QUIET_MEDIUM_BYTES = 100 * 1024
export const UPLOAD_QUIET_SMALL_MS = 10_000
export const UPLOAD_QUIET_MEDIUM_MS = 20_000
export const UPLOAD_QUIET_LARGE_MS = 30_000
const QUIET_MESSAGE = 'Waiting for the local upload quiet period'

/** Local pacing uses the engine's transient per-path refusal port. It leaves the
 * real disk and ledger visible to incoming conflict checks and later scans. */
export class UploadQuietPeriod {
  private readonly last = new Map<string, number>()
  private readonly waiting = new Map<string, { until: number; notified: boolean }>()
  private timer: number | undefined
  private paused = false
  private stopped = false
  private flushing = 0
  private noticing: Promise<void> = Promise.resolve()

  constructor(
    private readonly fs: Pick<FileSystem, 'stat'>,
    private readonly notify: (paths: string[]) => void,
    private readonly changed: () => void
  ) {}

  get pending(): number {
    return this.waiting.size
  }

  synced(path: string): void {
    this.last.set(path, Date.now())
    if (this.waiting.delete(path)) {
      this.schedule()
      this.changed()
    }
  }

  forget(path: string): void {
    this.last.delete(path)
    if (this.waiting.delete(path)) {
      this.schedule()
      this.changed()
    }
  }

  notice(paths: string[]): Promise<void> {
    const work = this.noticing.then(async () => {
      if (this.stopped) return
      const ready: string[] = []
      for (const path of paths) {
        // First uploads and incoming-write echoes belong to the engine's existing
        // watcher checks. Only paths with a local upload can be re-upload waits.
        if (
          !this.last.has(path) &&
          ![...this.waiting.keys()].some((child) => child.startsWith(path + '/'))
        ) {
          ready.push(path)
          continue
        }
        const info = await this.fs.stat(path)
        if (this.stopped) return
        if (!info) {
          // A removed folder may reach the watcher after its children disappeared.
          for (const child of this.last.keys())
            if (child.startsWith(path + '/')) {
              this.last.delete(child)
              if (this.waiting.delete(child)) ready.push(child)
            }
          this.last.delete(path)
          this.waiting.delete(path)
          ready.push(path)
          continue
        }
        const delay =
          info.size <= UPLOAD_QUIET_SMALL_BYTES
            ? UPLOAD_QUIET_SMALL_MS
            : info.size <= UPLOAD_QUIET_MEDIUM_BYTES
              ? UPLOAD_QUIET_MEDIUM_MS
              : UPLOAD_QUIET_LARGE_MS
        const until = (this.last.get(path) ?? -Infinity) + delay
        if (!this.flushing && until > Date.now()) {
          this.waiting.set(path, { until, notified: false })
        } else ready.push(path)
      }
      if (ready.length && !this.paused) this.notify(ready)
      this.schedule()
      this.changed()
    })
    this.noticing = work.catch(() => {})
    return work
  }

  refusal(path: string): Refusal | undefined {
    const one = this.waiting.get(path)
    if (!this.flushing && one && one.until > Date.now())
      return { code: 'rate_limited', message: QUIET_MESSAGE }
    return undefined
  }

  static isQuiet(row: { code: string; message: string }): boolean {
    return row.code === 'rate_limited' && row.message.includes(QUIET_MESSAGE)
  }

  /** A save that returned to the baseline produces no applied operation. The
   * successful scan still refreshes its metadata, so no content read is needed. */
  async settle(state: StateStore, dirty: ReadonlySet<string> = new Set()): Promise<void> {
    for (const [path, waiting] of this.waiting) {
      // A cycle that started before this notification has not verified its bytes.
      if (!waiting.notified || dirty.has(path)) continue
      const entry = await state.get(path)
      const info = await this.fs.stat(path)
      if (
        entry &&
        info &&
        entry.size === info.size &&
        entry.mtime === info.mtime &&
        this.waiting.get(path) === waiting
      )
        this.waiting.delete(path)
    }
    this.schedule()
    this.changed()
  }

  async flush(work: () => Promise<void>): Promise<void> {
    if (this.stopped || this.paused) return
    this.flushing++
    this.schedule()
    try {
      await this.noticing
      if (this.stopped || this.paused) return
      for (const one of this.waiting.values()) one.notified = true
      if (this.waiting.size) this.notify([...this.waiting.keys()])
      await work()
    } finally {
      this.flushing--
      this.schedule()
    }
  }

  pause(paused: boolean): void {
    this.paused = paused
    this.schedule()
  }

  stop(): void {
    this.stopped = true
    this.schedule()
  }

  private schedule(): void {
    window.clearTimeout(this.timer)
    this.timer = undefined
    if (this.stopped || this.paused || this.flushing) return
    const due = [...this.waiting.values()].filter((one) => !one.notified)
    if (!due.length) return
    let next = Infinity
    for (const one of due) next = Math.min(next, one.until)
    this.timer = window.setTimeout(
      () => {
        this.timer = undefined
        const paths: string[] = []
        for (const [path, one] of this.waiting) {
          if (!one.notified && one.until <= Date.now()) {
            one.notified = true
            paths.push(path)
          }
        }
        if (paths.length) this.notify(paths)
        this.schedule()
      },
      Math.max(0, next - Date.now())
    )
  }
}
