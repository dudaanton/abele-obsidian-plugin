/**
 * The arithmetic behind a diagram you can move around: where it sits when it fits its frame,
 * and what zooming and dragging do to that.
 *
 * The view is `translate(x, y) scale(scale)` from the frame's top left corner. Everything the
 * viewer does is a function from one of those to the next, so it is tested here without a DOM.
 */
import { describe, it, expect } from 'vitest'
import { fitView, frameHeight, zoomAt, panBy, pinch, MIN_SCALE, MAX_SCALE } from '@/mermaid/panZoom'

describe('fitView', () => {
  it('shrinks a diagram wider than its frame to the frame width and centres it', () => {
    const view = fitView({ width: 500, height: 400 }, { width: 1000, height: 400 })
    expect(view.scale).toBe(0.5)
    expect(view.x).toBe(0)
    // 400 tall at half size is 200, in a 400 frame: 100 above and below.
    expect(view.y).toBe(100)
  })

  it('never enlarges a small diagram past its own size', () => {
    const view = fitView({ width: 800, height: 300 }, { width: 200, height: 100 })
    expect(view.scale).toBe(1)
    expect(view.x).toBe(300)
    expect(view.y).toBe(100)
  })

  it('shrinks a tall diagram until it fits the frame height as well', () => {
    const view = fitView({ width: 600, height: 300 }, { width: 300, height: 900 })
    expect(view.scale).toBeCloseTo(1 / 3)
    expect(view.x).toBeCloseTo(250)
    expect(view.y).toBeCloseTo(0)
  })

  it('may enlarge when asked to fill, for the full screen view', () => {
    const view = fitView({ width: 1000, height: 1000 }, { width: 200, height: 100 }, Infinity)
    expect(view.scale).toBe(5)
  })

  it('shrinks a very large diagram as far as it takes, past the zoom limit', () => {
    const view = fitView({ width: 400, height: 120 }, { width: 12000, height: 300 })
    expect(view.scale).toBeCloseTo(400 / 12000)
    expect(view.x).toBeCloseTo(0)
  })

  it('leaves an empty or unmeasured frame at the natural size', () => {
    expect(fitView({ width: 0, height: 0 }, { width: 200, height: 100 }).scale).toBe(1)
    expect(fitView({ width: 300, height: 300 }, { width: 0, height: 0 }).scale).toBe(1)
  })
})

describe('frameHeight', () => {
  it('is the height the diagram takes once it fits the width', () => {
    expect(frameHeight(500, { width: 1000, height: 400 }, 640)).toBe(200)
  })

  it('stops at the cap for a tall diagram', () => {
    expect(frameHeight(500, { width: 300, height: 3000 }, 640)).toBe(640)
  })

  it('keeps room for the controls under a flat diagram', () => {
    expect(frameHeight(500, { width: 1000, height: 20 }, 640)).toBeGreaterThanOrEqual(176)
  })
})

describe('zoomAt', () => {
  it('keeps the point under the cursor where it was', () => {
    const before = { scale: 1, x: 10, y: 20 }
    const after = zoomAt(before, 2, { x: 110, y: 120 })
    expect(after.scale).toBe(2)
    // The diagram point under (110, 120) was (100, 100); at scale 2 it must still be there.
    expect(after.x + 100 * after.scale).toBe(110)
    expect(after.y + 100 * after.scale).toBe(120)
  })

  it('stops at the limits', () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 1000, { x: 0, y: 0 }).scale).toBe(MAX_SCALE)
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 0.0001, { x: 0, y: 0 }).scale).toBe(MIN_SCALE)
  })

  it('lets a view fitted under the limit zoom in, and not out any further', () => {
    const fitted = { scale: 0.03, x: 0, y: 0 }
    expect(zoomAt(fitted, 1.25, { x: 0, y: 0 }).scale).toBeCloseTo(0.0375)
    expect(zoomAt(fitted, 0.8, { x: 0, y: 0 }).scale).toBe(0.03)
  })

  it('does not move anything once a limit is reached', () => {
    const view = { scale: MAX_SCALE, x: 5, y: 7 }
    expect(zoomAt(view, 2, { x: 300, y: 300 })).toEqual(view)
  })
})

describe('panBy', () => {
  it('moves the view by the distance dragged', () => {
    expect(panBy({ scale: 2, x: 5, y: 5 }, 10, -20)).toEqual({ scale: 2, x: 15, y: -15 })
  })
})

describe('pinch', () => {
  it('zooms by how far the fingers spread and follows their midpoint', () => {
    const start = { scale: 1, x: 0, y: 0 }
    const view = pinch(
      start,
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      [
        { x: 50, y: 100 },
        { x: 250, y: 100 },
      ]
    )
    expect(view.scale).toBe(2)
    // The midpoint (150, 100) stayed put, so the diagram point under it stays under it.
    expect(view.x + 150 * view.scale).toBe(150)
    expect(view.y + 100 * view.scale).toBe(100)
  })

  it('pans when the fingers move together without spreading', () => {
    const view = pinch(
      { scale: 1, x: 0, y: 0 },
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      [
        { x: 110, y: 130 },
        { x: 210, y: 130 },
      ]
    )
    expect(view).toEqual({ scale: 1, x: 10, y: 30 })
  })
})
