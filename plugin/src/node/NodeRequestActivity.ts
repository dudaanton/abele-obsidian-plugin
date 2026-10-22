import { markRaw, ref } from 'vue'

/** Tracks only sustained requests; fast requests never wake the presentation. */
export class NodeRequestActivity {
  readonly slowSince = ref(0)
  private entries = new Map<symbol, { at: number; timer: number; slow: boolean }>()
  constructor() {
    markRaw(this)
  }
  start(): () => void {
    const id = Symbol(),
      at = Date.now()
    const timer = window.setTimeout(() => {
      const entry = this.entries.get(id)
      if (entry) {
        entry.slow = true
        this.publish()
      }
    }, 3000)
    this.entries.set(id, { at, timer, slow: false })
    return () => {
      window.clearTimeout(timer)
      if (this.entries.delete(id)) this.publish()
    }
  }
  private publish(): void {
    const times = [...this.entries.values()].filter((e) => e.slow).map((e) => e.at)
    this.slowSince.value = times.length ? Math.min(...times) : 0
  }
  destroy(): void {
    for (const entry of this.entries.values()) window.clearTimeout(entry.timer)
    this.entries.clear()
    this.slowSince.value = 0
  }
}
