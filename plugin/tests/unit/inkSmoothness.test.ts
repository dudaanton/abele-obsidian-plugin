import { expect, it } from 'vitest'
import { hitStroke, strokeCenterline, strokePath } from '@/ink/stroke'
import { handwriting as stroke } from '../helpers/handwriting'
import { boundsOf } from '@/drawing/items'
import { inkBounds } from '@/canvas/core/ink'
function maxTurn(points: number[]): number {
  let max = 0
  for (let i = 3; i + 3 < points.length; i += 3) {
    const ax = points[i] - points[i - 3],
      ay = points[i + 1] - points[i - 2]
    const bx = points[i + 3] - points[i],
      by = points[i + 4] - points[i + 1]
    max = Math.max(max, Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)))
  }
  return (max * 180) / Math.PI
}
it('fits sparse stylus handwriting with less than five degrees between rendered segments', () => {
  expect(maxTurn(stroke.points)).toBeGreaterThan(18)
  const rendered = strokeCenterline(stroke)
  expect(maxTurn(rendered)).toBeLessThan(5)
  expect(rendered.slice(0, 3)).toEqual(stroke.points.slice(0, 3))
  expect(rendered.slice(-3)).toEqual(stroke.points.slice(-3))
  console.info('Handwriting maximum turn (degrees)', {
    before: maxTurn(stroke.points),
    after: maxTurn(rendered),
  })
})

it('does not persist interpolation samples or alter pressure when rendering', () => {
  const pressure = {
    ...stroke,
    points: stroke.points.map((n, i) => (i % 3 === 2 ? 0.2 + (i % 5) / 10 : n)),
  }
  const stored = JSON.stringify(pressure)
  const rendered = strokeCenterline(pressure)
  expect(strokePath(pressure)).not.toMatch(/NaN|Infinity/)
  expect(JSON.stringify(pressure)).toBe(stored)
  for (let i = 2; i < rendered.length; i += 3) {
    expect(rendered[i]).toBeGreaterThanOrEqual(0.2 - 1e-10)
    expect(rendered[i]).toBeLessThanOrEqual(0.6 + 1e-10)
  }
  expect(strokePath({ ...stroke, tool: 'marker' })).toContain('Q')
})

it('keeps dense handwriting outlines compact instead of storing every fitted segment', () => {
  const dense = {
    ...stroke,
    points: Array.from({ length: 180 }, (_, i) => {
      const t = (i * Math.PI) / 120
      return [80 + 35 * Math.sin(t), 80 - 45 * Math.cos(t), 0.5]
    }).flat(),
  }
  expect(strokePath(dense).length).toBeLessThan(5000)
})

it('picks a thin fitted curve where it leaves the chord between input samples', () => {
  const thin = { ...stroke, size: 0.1, points: [0, 0, 0.5, 20, 20, 0.5, 40, 0, 0.5] }
  expect(hitStroke(thin, 8.75, 11.25, 0)).toBe(true)
})

it('includes fitted curve extrema in drawing and canvas repaint bounds', () => {
  const thin = { ...stroke, size: 0.1, points: [0, 0, 0.5, 20, 0, 0.5, 40, -20, 0.5] }
  const drawing = boundsOf({ ...thin, id: 'sample', type: 'stroke' })
  const canvas = inkBounds({ stroke: { ...thin, id: 'sample', version: 1 }, node: undefined })
  expect(drawing.y + drawing.h).toBeGreaterThan(1.25)
  expect(canvas.y + canvas.height).toBeGreaterThan(1.25)
})
