import { createHook } from 'node:async_hooks'

type Sample = { user: number; system: number }

/** Current-thread CPU over a measurement and each host task, including microtasks.
 * Wall-clock gaps also contain scheduler suspension and I/O wait, neither of which
 * is synchronous renderer work. Other test workers and native I/O threads are excluded.
 */
export class TaskCpu {
  private readonly nativeTasks = new Set<number>()
  private readonly usage = (
    process as NodeJS.Process & { threadCpuUsage(): Sample }
  ).threadCpuUsage.bind(process)
  private started = this.micros()
  private wallStarted = performance.now()
  totalMs = 0
  longestMs = 0
  longestWallMs = 0
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
    destroy: (id) => this.nativeTasks.delete(id),
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
    this.longestMs = Math.max(this.longestMs, elapsedMs)
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
