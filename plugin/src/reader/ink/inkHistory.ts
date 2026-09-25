/**
 * Undo and redo while drawing: each step is what one stroke of the pen or the eraser changed on
 * one page — the strokes it added, the strokes it took away and where they stood.
 */
import type { InkStroke } from './stroke'

export interface InkStep {
  index: number
  added: InkStroke[]
  removed: { stroke: InkStroke; at: number }[]
}

export class InkHistory {
  private past: InkStep[] = []
  private future: InkStep[] = []

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** A step taken: it can be undone, and what was undone before it can no longer be redone. */
  push(step: InkStep): void {
    this.past.push(step)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
  }

  /** The last step, to be taken back; null when there is none. */
  undo(): InkStep | null {
    const step = this.past.pop() ?? null
    if (step) this.future.push(step)
    return step
  }

  /** The last step taken back, to be taken again; null when there is none. */
  redo(): InkStep | null {
    const step = this.future.pop() ?? null
    if (step) this.past.push(step)
    return step
  }

  clear(): void {
    this.past = []
    this.future = []
  }
}
