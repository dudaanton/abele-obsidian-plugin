/** Bounded undo steps. Callers own how each step is applied to their document. */
export class StepHistory<T> {
  private past: T[] = []
  private future: T[] = []

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.past.length > 0
  }
  get canRedo(): boolean {
    return this.future.length > 0
  }

  push(step: T): void {
    this.past.push(step)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
  }

  undo(): T | null {
    const step = this.past.pop() ?? null
    if (step !== null) this.future.push(step)
    return step
  }

  redo(): T | null {
    const step = this.future.pop() ?? null
    if (step !== null) this.past.push(step)
    return step
  }

  clear(): void {
    this.past = []
    this.future = []
  }
}
