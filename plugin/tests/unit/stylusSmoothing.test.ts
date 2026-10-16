import { describe, expect, it } from 'vitest'
import { StylusSmoother } from '@/ink/smoothing'
import { strokeCenterline, strokePath } from '@/ink/stroke'
import { itemFrom } from '@/drawing/items'
import { drawingSvg, parseDrawingSvg } from '@/drawing/drawingFile'
import { DrawingItems } from '@/drawing/history'
import { strokeGesture } from '@/drawing/tools'

const samples = {
  dot: [[2, 3]],
  line: Array.from({ length: 200 }, (_, i) => [i, 0.12 * (i % 2 ? 1 : -1)]),
  handwriting: Array.from({ length: 180 }, (_, i) => [
    i * 0.3 + Math.sin(i / 7),
    3 * Math.sin(i / 9) + 0.08 * (i % 2),
  ]),
  scribble: Array.from({ length: 60 }, (_, i) => [i * 4, 15 * Math.sin(i / 3)]),
  small: Array.from({ length: 90 }, (_, i) => [i * 0.08, Math.sin(i / 8)]),
  corners: [
    [0, 10],
    [0, 0],
    [5, 10],
    [5, 0],
    [10, 10],
    [15, 0],
  ],
}

describe('bounded stylus input', () => {
  it('leaves sparse samples exact when either neighbour is more than two screen pixels away', () => {
    for (const zoom of [0.25, 1, 4, 16]) {
      for (const xy of [
        [
          [0, 0],
          [30, 20],
          [60, 25],
        ],
        [
          [0, 0],
          [1, 0.1],
          [10, 0],
        ],
        [
          [0, 0],
          [9, 0.1],
          [10, 0],
        ],
        [
          [0, 0],
          [2.01, 0],
          [3, 0.1],
        ],
        [
          [0, 0],
          [1, 0.1],
          [3.01, 0.1],
        ],
      ]) {
        const filter = new StylusSmoother(zoom)
        const raw = xy.flatMap(([x, y]) => [x / zoom, y / zoom, 0.5])
        for (let i = 0; i < raw.length; i += 3) filter.add(raw[i], raw[i + 1], raw[i + 2])
        expect(filter.points).toEqual(raw)
      }
    }
  })
  it('stores exact smoothed points, ignores predictions and preserves legacy rendering', () => {
    const items = new DrawingItems()
    const gesture = strokeGesture(
      { items, zoom: () => 1, added() {}, repaint() {}, changed() {} },
      { tool: 'pen', color: 'black', size: 1 },
      { x: 0.123, y: 0.456, p: 0.234 },
      true
    )
    gesture.move(
      [
        { x: 1.123, y: 0.556, p: 0.876 },
        { x: 2.123, y: 0.456, p: 0.345 },
      ],
      [{ x: 99, y: 99, p: 1 }]
    )
    gesture.end(false)
    const item = items.items[0]
    expect(item).toMatchObject({
      linear: true,
      points: [0.123, 0.456, 0.234, 1.123, 0.531, 0.876, 2.123, 0.456, 0.345],
    })
    const svg = drawingSvg({ items: [item] })
    expect(parseDrawingSvg(svg)?.items).toEqual([item])
    expect(svg).toContain('l')
    const legacy = {
      tool: 'pen' as const,
      color: 'black' as const,
      size: 1,
      points: [0, 0, 0.5, 1, 1, 0.5, 2, 0, 0.5],
    }
    expect(strokeCenterline(legacy)).not.toEqual(legacy.points)
    expect(strokePath(legacy)).toBe(strokePath({ ...legacy, linear: undefined }))
  })
  for (const zoom of [0.25, 1, 4, 16])
    for (const [name, xy] of Object.entries(samples)) {
      it(`${name} preserves endpoints, pressure and the screen-space bound at ${zoom}x`, () => {
        const filter = new StylusSmoother(zoom)
        const raw = xy.flatMap(([x, y], i) => [x, y, 0.2 + (i % 7) / 10])
        for (let i = 0; i < raw.length; i += 3) {
          const before = [...filter.points]
          filter.add(raw[i], raw[i + 1], raw[i + 2])
          expect(filter.points.slice(-3)).toEqual(raw.slice(i, i + 3))
          expect(filter.points.slice(0, Math.max(0, before.length - 3))).toEqual(
            before.slice(0, -3)
          )
        }
        expect(filter.points.slice(0, 3)).toEqual(raw.slice(0, 3))
        for (let i = 0; i < raw.length; i += 3) {
          expect(
            Math.hypot(filter.points[i] - raw[i], filter.points[i + 1] - raw[i + 1]) * zoom
          ).toBeLessThanOrEqual(0.25 + 1e-10)
          expect(filter.points[i + 2]).toBe(raw[i + 2])
        }
        if (name === 'corners' || name === 'dot') expect(filter.points).toEqual(raw)
        if (name === 'line') {
          if (Math.hypot(1, 0.24) * zoom <= 2)
            expect(Math.abs(filter.points[4])).toBeLessThan(Math.abs(raw[4]))
          else expect(filter.points).toEqual(raw)
        }
        const stroke = {
          tool: 'pen' as const,
          color: 'black' as const,
          size: 1,
          points: filter.points,
          linear: true as const,
        }
        expect(strokeCenterline(stroke)).toEqual(filter.points)
        expect(strokePath(stroke)).not.toMatch(/[QC]/)
        expect(itemFrom({ ...stroke, type: 'stroke', id: 'sample' })).toMatchObject({
          linear: true,
        })
      })
    }
})
