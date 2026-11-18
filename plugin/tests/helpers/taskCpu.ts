import { createHook } from 'node:async_hooks'

type Sample = { user: number; system: number }

/** Current-thread CPU over a measurement and each host task, including microtasks.
 * Wall-clock gaps also contain scheduler suspension and I/O wait, neither of which
 * is synchronous renderer work. Other test workers and native I/O threads are excluded.
 */
export class TaskCpu {
  // A destroy hook enrolls every promise for GC notification, including the microtasks
  // we deliberately do not measure as boundaries. Keep native ids until this monitor stops;
  // ids are never reused, so completed resources need no destruction tracking.
  private readonly nativeTasks = new Set<number>()
  private readonly usage = (
    process as NodeJS.Process & { threadCpuUsage(): Sample }
  ).threadCpuUsage.bind(process)
  private started = this.micros()
  private wallStarted = performance.now()
  totalMs = 0
  longestMs = 0
  longestWallMs = 0
  longestStartedAt = 0
  longestEndedAt = 0
  tasks = 0
  private stopped = false
  private readonly hook = createHook({
    init: (id, kind) => {
      if (kind !== 'PROMISE' && kind !== 'TickObject' && kind !== 'Microtask')
        this.nativeTasks.add(id)
    },
    before: (id) => {
      if (this.nativeTasks.has(id)) this.boundary()
    },
  })

  constructor() {
    this.hook.enable()
  }

  private micros(): number {
    const sample = this.usage()
    return sample.user + sample.system
  }

  private boundary(): void {
    const now = this.micros()
    const wall = performance.now()
    const elapsedMs = (now - this.started) / 1000
    this.totalMs += elapsedMs
    if (elapsedMs > this.longestMs) {
      this.longestMs = elapsedMs
      this.longestStartedAt = this.wallStarted
      this.longestEndedAt = wall
    }
    this.longestWallMs = Math.max(this.longestWallMs, wall - this.wallStarted)
    this.started = now
    this.wallStarted = wall
    this.tasks++
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.hook.disable()
    this.boundary()
    this.nativeTasks.clear()
  }
}
