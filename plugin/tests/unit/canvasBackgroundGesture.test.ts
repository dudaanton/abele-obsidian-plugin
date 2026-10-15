import { describe, expect, it } from 'vitest'
import { canvasBackgroundGesture } from '../e2e/helpers/canvasBackgroundGesture'

describe('native Canvas background-stroke fixture', () => {
  it.each([0.5, 1, 4])('chooses an off-card start and end at zoom %s', (zoom) => {
    const stage = { left: 10, top: 20, width: 800, height: 600 }
    const camera = { x: -40, y: -40, zoom }
    const node = { x: 0, y: 0, width: 400, height: 220 }
    const [from, to] = canvasBackgroundGesture(stage, camera, [node], 55, -8)
    for (const [sx, sy] of [from, to]) {
      expect(sx).toBeGreaterThan(stage.left)
      expect(sx).toBeLessThan(stage.left + stage.width)
      expect(sy).toBeGreaterThan(stage.top)
      expect(sy).toBeLessThan(stage.top + stage.height)
      const x = (sx - stage.left) / zoom + camera.x
      const y = (sy - stage.top) / zoom + camera.y
      expect(x < node.x || x > node.x + node.width || y < node.y || y > node.y + node.height).toBe(
        true
      )
    }
    expect(to[0] - from[0]).toBe(55)
    expect(to[1] - from[1]).toBe(-8)
  })

  it('keeps clear of the controls floating over the canvas', () => {
    const stage = { left: 0, top: 0, width: 800, height: 600 }
    const bar = { left: 0, top: 0, right: 800, bottom: 44 }
    const [from, to] = canvasBackgroundGesture(stage, { x: 2000, y: 2000, zoom: 1 }, [], 55, -8, [
      bar,
    ])
    for (const [, sy] of [from, to]) expect(sy).toBeGreaterThan(bar.bottom + 4)
  })

  it('refuses a filled stage instead of silently annotating a card', () => {
    expect(() =>
      canvasBackgroundGesture(
        { left: 0, top: 0, width: 200, height: 200 },
        { x: 0, y: 0, zoom: 1 },
        [{ x: -100, y: -100, width: 500, height: 500 }],
        55,
        -8
      )
    ).toThrow('No off-card background gesture')
  })
})
