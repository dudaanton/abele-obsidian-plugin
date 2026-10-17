import { describe, expect, it } from 'vitest'
import {
  aspectLabel,
  cropChanged,
  croppedSize,
  dragRect,
  fitRect,
  flipRect,
  frameRatio,
  turnRectLeft,
  wholePicture,
} from '@/drawing/crop'

const whole = { x: 0, y: 0, w: 1, h: 1 }
// A 4000 × 3000 picture shown as it is: 4:3.
const PICTURE = 4 / 3

describe('crop frame', () => {
  it('fits a square as large as the picture allows, in its middle', () => {
    const r = fitRect(whole, 1, PICTURE)
    expect(r.h).toBeCloseTo(1)
    expect(r.w).toBeCloseTo(0.75)
    expect(r.x).toBeCloseTo(0.125)
  })

  it('keeps a fitted frame on the picture when its middle was near an edge', () => {
    const r = fitRect({ x: 0.8, y: 0, w: 0.2, h: 1 }, 1, PICTURE)
    expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('stands 4:3 and 16:9 on their ends when picked again, and says so', () => {
    expect(frameRatio('4:3', true, PICTURE)).toBeCloseTo(3 / 4)
    expect(frameRatio('square', true, PICTURE)).toBe(1)
    expect(frameRatio('free', false, PICTURE)).toBeNull()
    expect(frameRatio('original', false, PICTURE)).toBe(PICTURE)
    expect(aspectLabel('16:9', true)).toBe('9:16')
    expect(aspectLabel('free', true)).toBe('Free')
  })

  it('drags a free corner and never past the picture or below the least side', () => {
    const r = dragRect(whole, 'nw', 0.3, 0.2, null, PICTURE)
    expect(r).toEqual({ x: 0.3, y: 0.2, w: 0.7, h: 0.8 })
    const tiny = dragRect(whole, 'e', -2, 0, null, PICTURE)
    expect(tiny.w).toBeCloseTo(0.05)
    const moved = dragRect({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, 'move', 1, 1, null, PICTURE)
    expect(moved.x).toBeCloseTo(0.6)
    expect(moved.y).toBeCloseTo(0.6)
  })

  it('keeps a square square in pixels while a corner is dragged', () => {
    const start = fitRect(whole, 1, PICTURE)
    const r = dragRect(start, 'se', -0.2, -0.05, 1, PICTURE)
    // In pixels: w * 4000 equals h * 3000.
    expect(r.w * 4000).toBeCloseTo(r.h * 3000)
    expect(r.x).toBeCloseTo(start.x)
    expect(r.y).toBeCloseTo(start.y)
  })

  it('turns and mirrors the frame with the picture', () => {
    const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
    const t = turnRectLeft(r)
    expect([t.x, t.y, t.w, t.h].map((v) => +v.toFixed(6))).toEqual([0.2, 0.6, 0.4, 0.3])
    expect(flipRect(r).x).toBeCloseTo(0.6)
  })

  it('says whether anything changed and how large the result is', () => {
    expect(cropChanged(wholePicture())).toBe(false)
    expect(cropChanged({ ...wholePicture(), flipped: true })).toBe(true)
    const state = { ...wholePicture(), rect: { x: 0, y: 0, w: 0.5, h: 1 }, turns: 1 as const }
    expect(croppedSize(state, 4000, 3000)).toEqual({ width: 1500, height: 4000 })
  })
})
