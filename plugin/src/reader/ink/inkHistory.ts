/**
 * Undo and redo while drawing: each step is what one stroke of the pen or the eraser changed on
 * one page — the strokes it added, the strokes it took away and where they stood.
 */
import type { InkStroke } from '@/ink/stroke'
import { StepHistory } from '@/ink/history'

export interface InkStep {
  index: number
  added: InkStroke[]
  removed: { stroke: InkStroke; at: number }[]
}

export class InkHistory extends StepHistory<InkStep> {}
