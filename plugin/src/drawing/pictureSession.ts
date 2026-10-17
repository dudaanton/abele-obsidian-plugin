import type { Camera } from './camera'
import type { CropState } from './crop'
import { wholePicture } from './crop'
import type { DrawingItem } from './items'
import { StepHistory } from '@/ink/history'
export type PictureEditorStatus =
  | { kind: 'saving'; text: string; progress?: number }
  | { kind: 'error'; text: string }

export interface PictureSessionState {
  crop: CropState
  cropping: boolean
  dirty: boolean
  status: PictureEditorStatus | null
  width: number
  height: number
  camera: Camera
}

interface PictureSnapshot {
  crop: CropState
  items: readonly DrawingItem[]
}
const snapshot = (crop: CropState, items: readonly DrawingItem[]): PictureSnapshot => ({
  crop: { ...crop, rect: { ...crop.rect } },
  items: [...items],
})

/** One edit order for the frame and the ink, with immutable item references. */
export class PictureHistory {
  private current = snapshot(wholePicture(), [])
  private readonly steps = new StepHistory<{ before: PictureSnapshot; after: PictureSnapshot }>()
  get canUndo(): boolean {
    return this.steps.canUndo
  }
  get canRedo(): boolean {
    return this.steps.canRedo
  }
  reset(crop: CropState, items: readonly DrawingItem[]): void {
    this.steps.clear()
    this.current = snapshot(crop, items)
  }
  record(crop: CropState, items: readonly DrawingItem[]): void {
    if (
      JSON.stringify(crop) === JSON.stringify(this.current.crop) &&
      items.length === this.current.items.length &&
      items.every((item, i) => item === this.current.items[i])
    )
      return
    const after = snapshot(crop, items)
    this.steps.push({ before: this.current, after })
    this.current = after
  }
  undo(): PictureSnapshot | null {
    const step = this.steps.undo()
    if (!step) return null
    this.current = step.before
    return snapshot(this.current.crop, this.current.items)
  }
  redo(): PictureSnapshot | null {
    const step = this.steps.redo()
    if (!step) return null
    this.current = step.after
    return snapshot(this.current.crop, this.current.items)
  }
}
