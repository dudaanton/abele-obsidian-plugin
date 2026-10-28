import { markRaw, ref } from 'vue'

/** Event waits deliberately hold a response; their idle time is not node latency. */
export function nodeRequestWaitMs(method: string, params: unknown): number {
  if (!/^debugger\.v1\.(wait|sleep)$/.test(method)) return 0
  const timeout = Number((params as { timeout_ms?: unknown } | undefined)?.timeout_ms ?? 60000)
  return Number.isFinite(timeout) && timeout > 0 ? Math.min(60000, timeout) : 0
}

/** Tracks only sustained requests; fast requests never wake the presentation. */
export class NodeRequestActivity {
  readonly slowSince = ref(0)
  private entries = new Map<
    symbol,
    { at: number; timer: number; slow: boolean; waiting: boolean }
  >()
  constructor() {
    markRaw(this)
  }
  start(method = '', params?: unknown): () => void {
    const wait = nodeRequestWaitMs(method, params)
    const id = Symbol(),
      at = Date.now()
    const timer = window.setTimeout(() => {
      const entry = this.entries.get(id)
      if (entry) {
        entry.slow = true
        this.publish()
      }
    }, wait + 3000)
    this.entries.set(id, { at: at + wait, timer, slow: false, waiting: wait > 0 })
    return () => {
      window.clearTimeout(timer)
      if (this.entries.delete(id)) this.publish()
    }
  }
  private publish(): void {
    const times = [...this.entries.values()].filter((e) => e.slow).map((e) => e.at)
    // Once shown, retain the episode while overlapping foreground work answers.
    // An idle event subscription must neither start nor prolong that episode.
    if (this.slowSince.value && [...this.entries.values()].some((e) => !e.waiting || e.slow)) return
    this.slowSince.value = times.length ? Math.min(...times) : 0
  }
  destroy(): void {
    for (const entry of this.entries.values()) window.clearTimeout(entry.timer)
    this.entries.clear()
    this.slowSince.value = 0
  }
}
