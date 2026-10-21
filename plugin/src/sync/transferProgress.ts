import { englishSyncText, type SyncText } from './presentation'

export interface TransferSnapshot {
  stage: string
  completed: number
  total?: number
  totalKnown?: boolean
  bytes?: number
  totalBytes?: number
  currentFile?: string
  secondsLeft?: number
}

/** Portable exchange accounting; no additional disk/transport reads. */
export class TransferProgress {
  private snapshot: TransferSnapshot | undefined
  private readonly paths = new Map<string, number>()
  private readonly completed = new Set<string>()
  private readonly ranges = new Map<string, [number, number][]>()
  private started = 0
  private published = -Infinity
  private samples = 0
  private cancelTimer: (() => void) | undefined
  constructor(
    private readonly changed: (value?: TransferSnapshot) => void,
    private readonly now = Date.now,
    private readonly schedule?: (work: () => void, delay: number) => () => void
  ) {}
  begin(stage: string, countBytes = true): void {
    this.paths.clear()
    this.completed.clear()
    this.ranges.clear()
    this.started = this.now()
    this.samples = 0
    this.snapshot = { stage, completed: 0, ...(countBytes ? { bytes: 0 } : {}) }
    this.publish(true)
  }
  get stage(): string | undefined {
    return this.snapshot?.stage
  }
  get settled(): boolean {
    const one = this.snapshot
    return one?.totalKnown === true && one.total !== undefined && one.completed >= one.total
  }
  phase(stage: string): void {
    if (!this.snapshot) return
    this.snapshot.stage = stage
    this.publish(true)
  }
  add(path: string, size: number): void {
    this.paths.set(path, size)
    if (!this.snapshot) return
    this.snapshot.total = this.paths.size
    this.snapshot.totalKnown = false
    this.snapshot.totalBytes = undefined
    this.publish()
  }
  inventoryComplete(known = true): void {
    if (!this.snapshot) return
    // An empty pull is finished; local comparison or upload can now own the status line.
    if (known && !this.paths.size) {
      this.clear()
      return
    }
    this.snapshot.total = this.paths.size
    this.snapshot.totalKnown = known
    this.snapshot.totalBytes =
      known && this.snapshot.bytes !== undefined
        ? [...this.paths.values()].reduce((a, b) => a + b, 0)
        : undefined
    this.publish(true)
  }
  counts(completed: number, total: number): void {
    if (!this.snapshot) return
    this.snapshot.completed = completed
    this.snapshot.total = total
    this.snapshot.totalKnown = true
    this.publish(completed === total)
  }
  current(path: string): void {
    if (!this.snapshot) return
    this.snapshot.currentFile = path
    this.publish()
  }
  bytes(key: string, offset: number, length: number): void {
    if (!this.snapshot) return
    const previous = this.ranges.get(key) ?? []
    const before = previous.reduce((sum, [a, b]) => sum + b - a, 0)
    const merged: [number, number][] = []
    for (const range of [...previous, [offset, offset + length] as [number, number]].sort(
      (a, b) => a[0] - b[0]
    )) {
      const last = merged.at(-1)
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
      else merged.push([...range])
    }
    this.ranges.set(key, merged)
    const added = merged.reduce((sum, [a, b]) => sum + b - a, 0) - before
    this.snapshot.bytes = (this.snapshot.bytes ?? 0) + added
    if (added > 0) this.samples++
    this.publish()
  }
  done(path: string): boolean {
    if (!this.snapshot || !this.paths.has(path) || this.completed.has(path)) return false
    this.completed.add(path)
    this.snapshot.completed = this.completed.size
    this.snapshot.currentFile = path
    this.publish(this.snapshot.totalKnown && this.snapshot.completed === this.snapshot.total)
    return true
  }
  reused(path: string): void {
    if (!this.paths.has(path)) return
    this.paths.set(path, 0)
    if (this.snapshot?.totalBytes !== undefined)
      this.snapshot.totalBytes = [...this.paths.values()].reduce((a, b) => a + b, 0)
  }
  clear(): void {
    this.cancelTimer?.()
    this.cancelTimer = undefined
    this.paths.clear()
    this.completed.clear()
    this.ranges.clear()
    this.snapshot = undefined
    this.changed()
  }
  refresh(): void {
    this.publish(true)
  }
  private publish(force = false): void {
    const now = this.now()
    if (!this.snapshot) return
    if (!force && now - this.published < 250) {
      this.cancelTimer ??= this.schedule?.(
        () => {
          this.cancelTimer = undefined
          this.publish(true)
        },
        250 - (now - this.published)
      )
      return
    }
    this.cancelTimer?.()
    this.cancelTimer = undefined
    // Completion is never delayed; intermediate updates are capped at four per second.
    this.published = now
    const one = { ...this.snapshot }
    const elapsed = (now - this.started) / 1000
    if (
      one.totalKnown &&
      one.totalBytes &&
      one.bytes &&
      one.bytes < one.totalBytes &&
      one.completed < (one.total ?? Infinity) &&
      elapsed >= 3 &&
      this.samples >= 3
    )
      one.secondsLeft = Math.ceil(((one.totalBytes - one.bytes) * elapsed) / one.bytes)
    this.changed(one)
  }
}

export function transferText(one: TransferSnapshot, text: SyncText = englishSyncText): string {
  if (one.total === 0 && one.completed === 0)
    return text(one.totalKnown === false ? one.stage : 'Syncing')
  if (one.total === undefined && one.completed === 0 && !one.bytes) return text(one.stage)
  const folders = one.stage === 'Preparing folders'
  const total = one.total
  let result =
    text(one.stage) +
    ' · ' +
    (total === undefined
      ? text(
          folders ? '{count} folders' : '{count} files',
          { count: one.completed },
          folders ? '{count} folder' : '{count} file'
        )
      : text(
          one.totalKnown === false
            ? folders
              ? '{completed} of at least {count} folders'
              : '{completed} of at least {count} files'
            : folders
              ? '{completed} of {count} folders'
              : '{completed} of {count} files',
          { completed: one.completed, count: total },
          one.totalKnown === false
            ? folders
              ? '{completed} of at least {count} folder'
              : '{completed} of at least {count} file'
            : folders
              ? '{completed} of {count} folder'
              : '{completed} of {count} file'
        ))
  if (one.bytes !== undefined && one.totalBytes !== 0) {
    const units = ['B', 'KB', 'MB', 'GB']
    const size = Math.max(one.bytes, one.totalBytes ?? 0)
    const unit = Math.min(3, Math.max(0, Math.floor(Math.log2(Math.max(1, size)) / 10)))
    const number = (n: number) => Number((n / 1024 ** unit).toFixed(1))
    result +=
      one.totalBytes === undefined
        ? text(' · {bytes} {unit} transferred', { bytes: number(one.bytes), unit: units[unit] })
        : text(' · {bytes} of {total} {unit}', {
            bytes: number(one.bytes),
            total: number(one.totalBytes),
            unit: units[unit],
          })
  }
  if (one.secondsLeft !== undefined)
    result +=
      one.secondsLeft < 60
        ? text(' · less than 1 min left')
        : text(' · about {minutes} min left', { minutes: Math.ceil(one.secondsLeft / 60) })
  return result
}
