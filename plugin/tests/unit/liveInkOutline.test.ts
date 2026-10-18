import { afterEach, expect, it, vi } from 'vitest'
import { createCanvas, Path2D } from '@napi-rs/canvas'
import { paintItem } from '@/drawing/renderer'
import { drawingSvg, parseDrawingSvg } from '@/drawing/drawingFile'
import { drawInk } from '@/reader/ink/inkLayer'
import { inkSvg, parseInkSvg } from '@/reader/ink/inkFile'
import { strokePath } from '@/ink/stroke'
import type { StrokeItem } from '@/drawing/items'
import { moveItem, scaleItem } from '@/drawing/items'
import { handwriting } from '../helpers/handwriting'
import { createHash } from 'node:crypto'

afterEach(() => vi.unstubAllGlobals())
it('keeps the same freehand outline and precision when a selection moves or scales', () => {
  const stroke: StrokeItem = {
    ...handwriting,
    id: 'sample',
    type: 'stroke',
    freedraw: { simulatePressure: false, streamline: 0.5 },
  }
  const moved = moveItem(stroke, 0.017, 0.023)
  expect(moved.points).toEqual(
    stroke.points.map((v, i) => (i % 3 === 2 ? v : v + (i % 3 === 0 ? 0.017 : 0.023)))
  )
  const scaled = scaleItem(moved, 0, 0, 1.137)
  expect(scaled.points).toEqual(moved.points.map((v, i) => (i % 3 === 2 ? v : v * 1.137)))
  expect(scaled.size).toBe(stroke.size * 1.137)
  expect(parseDrawingSvg(drawingSvg({ items: [scaled] }))!.items[0]).toEqual(scaled)
})
for (const tool of ['pen', 'marker'] as const) {
  it(`${tool} paints the same alpha outline in the PNG renderer, saved SVG and reader layer`, () => {
    vi.stubGlobal('Path2D', Path2D)
    const stroke: StrokeItem = {
      ...handwriting,
      tool,
      id: 'sample',
      type: 'stroke',
      freedraw: { simulatePressure: false, streamline: 0.5 },
    }
    const raster = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const canvas = createCanvas(180, 180)
      draw(canvas.getContext('2d') as unknown as CanvasRenderingContext2D)
      return canvas.getContext('2d').getImageData(0, 0, 180, 180).data
    }
    const png = raster((ctx) => paintItem(ctx, stroke))
    const svg = drawingSvg({ items: [stroke] })
    const saved = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('path')!
    const exported = raster((ctx) => {
      ctx.globalAlpha = Number(saved.getAttribute('fill-opacity') ?? 1)
      ctx.fill(new Path2D(saved.getAttribute('d')!) as unknown as globalThis.Path2D)
    })
    let difference = 0,
      area = 0
    for (let i = 3; i < png.length; i += 4) {
      difference += Math.abs(png[i] - exported[i])
      area += png[i]
    }
    expect(area).toBeGreaterThan(0)
    expect(difference / area).toBeLessThan(0.01)
    const loaded = parseDrawingSvg(svg)!.items[0] as StrokeItem
    expect(strokePath(loaded)).toBe(strokePath(stroke))
    const page = parseInkSvg(inkSvg({ width: 180, height: 180, strokes: [stroke] }))!
    const doc = document.implementation.createHTMLDocument()
    drawInk(doc, page)
    const path = doc.querySelector('.abele-ink path')!
    expect(path.getAttribute('d')).toBe(strokePath(stroke))
    expect(path.getAttribute('fill')).not.toBe('none')
    expect(path.getAttribute('stroke')).toBeNull()
    expect(path.getAttribute('fill-opacity')).toBe(tool === 'marker' ? '0.4' : null)
  })
}

it('keeps the complete legacy native outline rather than thinning or dropping old ink', () => {
  expect(createHash('sha256').update(strokePath(handwriting)).digest('hex')).toBe(
    'e426aa57dbce3178008483c3d4d94530f5a1c3060ef7359b7c96cb54bba44244'
  )
  const svg = inkSvg({ width: 180, height: 180, strokes: [handwriting] })
  const loaded = parseInkSvg(svg)!.strokes[0]
  expect(strokePath(loaded)).not.toBe('')
  expect(loaded.freedraw).toBeUndefined()
  const item: StrokeItem = { ...handwriting, id: 'legacy', type: 'stroke' }
  expect(strokePath(parseDrawingSvg(drawingSvg({ items: [item] }))!.items[0] as StrokeItem)).toBe(
    strokePath(item)
  )
})

it('keeps the version-one data older drawing and reader parsers consume', () => {
  const stroke: StrokeItem = {
    ...handwriting,
    id: 'sample',
    type: 'stroke',
    freedraw: { simulatePressure: true, streamline: 0.5 },
  }
  const drawing = drawingSvg({ items: [stroke] })
  const metadata = JSON.parse(
    new DOMParser().parseFromString(drawing, 'image/svg+xml').querySelector('metadata')!
      .textContent!
  )
  expect(metadata.v).toBe(1)
  expect(metadata.items[0].points).toEqual(stroke.points)
  const { freedraw: _profile, ...legacy } = metadata.items[0]
  expect(strokePath(legacy)).not.toMatch(/NaN|Infinity/)
  expect(strokePath(legacy)).not.toBe('')
  const svg = inkSvg({ width: 180, height: 180, strokes: [stroke] })
  const originalAttributes = svg.replace(
    / data-(?:linear|simulate-pressure|streamline)="[^"]*"/g,
    ''
  )
  const oldReader = parseInkSvg(originalAttributes)!.strokes[0]
  expect(oldReader.points).toEqual(stroke.points)
  expect(oldReader.tool).toBe(stroke.tool)
  expect(oldReader.size).toBe(stroke.size)
  expect(oldReader.freedraw).toBeUndefined()
  expect(strokePath(oldReader)).not.toBe('')
})
