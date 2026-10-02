import { navigate, type Navigation } from './navigation'

/** One portable state machine shared by audience and presenter. The host owns its windows. */
export class Presentation {
  index: number
  step = 0
  ended = false
  running = true
  private readonly steps = new Map<number, number>()
  private readonly listeners = new Set<() => void>()
  private readonly endListeners = new Set<() => void>()
  private accumulated = 0
  private started: number

  constructor(
    private count: number,
    index = 0,
    private readonly clock: () => number = () => performance.now()
  ) {
    this.index = navigate(index, index, count)
    this.started = clock()
  }

  get elapsed(): number {
    return this.accumulated + (this.running ? Math.max(0, this.clock() - this.started) : 0)
  }

  get stepCount(): number {
    return this.steps.get(this.index) ?? 0
  }

  watch(changed: () => void): () => void {
    this.listeners.add(changed)
    return () => this.listeners.delete(changed)
  }

  onEnd(ended: () => void): () => void {
    if (this.ended) ended()
    else this.endListeners.add(ended)
    return () => this.endListeners.delete(ended)
  }

  private notify(): void {
    if (!this.ended) for (const changed of this.listeners) changed()
  }

  setSteps(index: number, count: number): void {
    if (this.ended || this.steps.get(index) === count) return
    this.steps.set(index, count)
    if (index === this.index) this.step = Math.min(this.step, count)
    this.notify()
  }

  resize(count: number): void {
    if (this.ended) return
    this.count = count
    const index = navigate(this.index, this.index, count)
    if (index !== this.index) this.step = 0
    this.index = index
    this.steps.clear()
    this.notify()
  }

  go(action: Navigation): void {
    if (this.ended) return
    if (action === 'next' && this.step < this.stepCount) this.step++
    else if (action === 'previous' && this.step > 0) this.step--
    else {
      const next = navigate(this.index, action, this.count)
      if (next === this.index && (action === 'next' || action === 'previous')) return
      this.index = next
      this.step = action === 'previous' ? this.stepCount : 0
    }
    this.notify()
  }

  toggleTimer(): void {
    if (this.ended) return
    this.accumulated = this.elapsed
    this.started = this.clock()
    this.running = !this.running
    this.notify()
  }

  resetTimer(): void {
    if (this.ended) return
    this.accumulated = 0
    this.started = this.clock()
    this.notify()
  }

  end(): void {
    if (this.ended) return
    this.accumulated = this.elapsed
    this.running = false
    this.ended = true
    this.listeners.clear()
    for (const ended of this.endListeners) ended()
    this.endListeners.clear()
  }
}
