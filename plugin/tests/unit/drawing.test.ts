/**
 * The drawing canvas without a screen: the file a drawing is kept in (`drawing/drawingFile.ts`),
 * what its items are and where they lie (`drawing/items.ts`), undo (`drawing/history.ts`), the
 * camera (`drawing/camera.ts`) and what a touch of the pen and of the eraser does
 * (`drawing/tools.ts`).
 */
import { describe, it, expect } from 'vitest'
import {
  drawingSvg,
  emptyDrawingSvg,
  isDrawingSvg,
  paperOf,
  parseDrawingSvg,
  MARGIN,
  packPoints,
  unpackPoints,
  writtenPaths,
} from '@/drawing/drawingFile'
import {
  boundsOf,
  contentBounds,
  hitItem,
  itemFrom,
  moveItem,
  scaleItem,
  type DrawingItem,
  type ShapeItem,
  type StrokeItem,
  type TextItem,
} from '@/drawing/items'
import { DrawingItems } from '@/drawing/history'
import { cameraFrom, fitRect, panBy, toScreen, toWorld, zoomAt } from '@/drawing/camera'
import { eraseGesture, strokeGesture, type ToolContext } from '@/drawing/tools'

const stroke = (id: string, points: number[], over: Partial<StrokeItem> = {}): StrokeItem => ({
  id,
  type: 'stroke',
  tool: 'pen',
  color: 'black',
  size: 2,
  points,
  ...over,
})
const line = (id: string, x: number, y: number): StrokeItem =>
  stroke(id, [x, y, 0.5, x + 40, y, 0.5, x + 80, y, 0.5])
const shape = (over: Partial<ShapeItem> = {}): ShapeItem => ({
  id: 's1',
  type: 'shape',
  kind: 'rect',
  x1: 10,
  y1: 20,
  x2: 110,
  y2: 70,
  color: 'blue',
  size: 2,
  ...over,
})
const text = (over: Partial<TextItem> = {}): TextItem => ({
  id: 't1',
  type: 'text',
  x: 0,
  y: 0,
  text: 'Hello',
  size: 20,
  color: 'red',
  ...over,
})

describe('the file a drawing is kept in', () => {
  it('is an SVG any app shows, which carries what is needed to draw on it again', () => {
    const items: DrawingItem[] = [
      line('a', 0, 0),
      stroke('b', [5, 50, 0.2, 60, 80, 0.9], { tool: 'marker', color: 'yellow', size: 14 }),
      shape(),
      shape({ id: 's2', kind: 'arrow' }),
      shape({ id: 's3', kind: 'ellipse' }),
      shape({ id: 's4', kind: 'line' }),
      text({ text: 'Two\nlines' }),
    ]
    const svg = drawingSvg({ items })
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(isDrawingSvg(svg)).toBe(true)
    // What is shown: a path per stroke, the shapes, the text line by line on white paper.
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).toContain('<rect x="10" y="20" width="100" height="50"')
    expect(svg).toContain('<ellipse')
    expect(svg).toContain('<tspan')
    expect(svg).toContain('>lines</tspan>')
    expect(svg).toContain('style="mix-blend-mode:multiply"')
    expect(parseDrawingSvg(svg)).toEqual({ items })
  })

  it('frames what is drawn with a margin, and an empty drawing with a page', () => {
    const b = boundsOf(shape())
    const paper = paperOf([shape()])
    expect(paper.x).toBeLessThanOrEqual(b.x - MARGIN)
    expect(paper.x + paper.w).toBeGreaterThanOrEqual(b.x + b.w + MARGIN)
    expect(paperOf([])).toEqual({ x: 0, y: 0, w: 800, h: 600 })
    expect(parseDrawingSvg(emptyDrawingSvg())).toEqual({ items: [] })
  })

  it('keeps text that looks like markup as text, in the picture and in the data', () => {
    const nasty = text({ text: '</metadata><script>alert(1)</script> & "q"' })
    const svg = drawingSvg({ items: [nasty] })
    expect(svg).not.toContain('<script>')
    expect(svg.match(/<\/metadata>/g)).toHaveLength(1)
    expect(parseDrawingSvg(svg)?.items[0]).toEqual(nasty)
  })

  it('tells a drawing from any other SVG, and reads nothing out of one', () => {
    expect(isDrawingSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).toBe(
      false
    )
    expect(
      parseDrawingSvg('<svg><metadata id="abele-drawing">{"v":1,"items":[]}</metadata></svg>')
    ).toBeNull()
    expect(
      parseDrawingSvg(
        '<svg data-abele-drawing="1"><metadata id="abele-drawing">{bad</metadata></svg>'
      )
    ).toBeNull()
  })

  it('reads back only items that are whole, and gives a second item with one id its own', () => {
    const svg = `<svg data-abele-drawing="1"><metadata id="abele-drawing">${JSON.stringify({
      v: 1,
      items: [
        line('a', 0, 0),
        line('a', 0, 10),
        { id: 'x', type: 'stroke', tool: 'pen', points: [1, 2] },
        { id: 'y', type: 'shape', kind: 'star', x1: 0, y1: 0, x2: 1, y2: 1 },
        { id: 'z', type: 'text', x: 0, y: 0, text: '' },
        { id: 'w', type: 'image', href: 'http://x' },
        'nonsense',
      ],
    })}</metadata></svg>`
    const items = parseDrawingSvg(svg)?.items ?? []
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe('a')
    expect(items[1].id).not.toBe('a')
  })

  it('writes a drawing read back exactly as it was, reusing what the file holds', () => {
    const items: DrawingItem[] = [line('a', 0, 0), shape(), text()]
    const svg = drawingSvg({ items })
    const back = parseDrawingSvg(svg)!
    expect(drawingSvg(back)).toBe(svg)
    expect(writtenPaths.get(back.items[0])).toMatch(/^M/)
    // A file whose picture has been changed by hand is drawn from its data, not its lines.
    const edited = svg.replace(/\n<rect x="10"[^\n]*/, '')
    const fromData = parseDrawingSvg(edited)!
    expect(writtenPaths.get(fromData.items[0])).toBeUndefined()
    expect(drawingSvg(fromData)).toBe(svg)
  })

  it('draws a pen stroke from its points again when the file holds the outline pens used to leave', () => {
    const svg = drawingSvg({ items: [line('a', 0, 0)] })
    // The outline before, traced round both sides in curves: it left gaps where the pen turned.
    const old = svg.replace(/<path d="[^"]*"/, '<path d="M0 0q5 1 10 0q-5 1-10 0z"')
    const back = parseDrawingSvg(old)!
    expect(writtenPaths.get(back.items[0])).toBeUndefined()
    expect(drawingSvg(back)).toBe(svg)
  })

  it('packs a stroke’s points to about half, and unpacks them as they were', () => {
    const pts = [1000.1, 500.2, 0.53, 1001.3, 499.9, 0.6, 1003, 499.5, 0.61]
    expect(packPoints(pts)).toEqual([1000.1, 500.2, 53, 1.2, -0.3, 7, 1.7, -0.4, 1])
    expect(unpackPoints(packPoints(pts))).toEqual(pts)
    expect(unpackPoints([1, 2])).toBeNull()
    expect(unpackPoints([1, 2, 'x'])).toBeNull()
  })

  it('checks every field of an item it reads', () => {
    expect(itemFrom({ ...shape(), color: 'chartreuse' })).toMatchObject({ color: 'black' })
    expect(itemFrom({ ...shape(), x1: 'x' })).toBeNull()
    expect(itemFrom({ ...shape(), x1: Infinity })).toBeNull()
    expect(itemFrom({ ...line('a', 0, 0), tool: 'brush' })).toBeNull()
    expect(itemFrom({ ...line('a', 0, 0), points: [1, 2, 'p'] })).toBeNull()
    expect(itemFrom({ ...line('a', 0, 0), id: '"><script>' })?.id).toMatch(/^[\w]+$/)
  })
})

describe('where items lie', () => {
  it('covers a stroke with its width, a shape with its line, and text with its lines', () => {
    const b = boundsOf(line('a', 10, 10))
    expect(b.x).toBeLessThan(10)
    expect(b.x + b.w).toBeGreaterThan(90)
    const arrow = boundsOf(shape({ kind: 'arrow' }))
    expect(arrow.w).toBeGreaterThan(boundsOf(shape({ kind: 'line' })).w)
    expect(boundsOf(text({ text: 'a\nb\nc' })).h).toBeCloseTo(75)
    expect(contentBounds([])).toBeNull()
  })

  it('is hit where it is drawn and not in the empty middle of a box', () => {
    const box = shape()
    expect(hitItem(box, 10, 45, 3)).toBe(true)
    expect(hitItem(box, 60, 45, 3)).toBe(false)
    const ring = shape({ kind: 'ellipse' })
    expect(hitItem(ring, 60, 20, 3)).toBe(true)
    expect(hitItem(ring, 60, 45, 3)).toBe(false)
    expect(hitItem(line('a', 0, 0), 40, 1, 2)).toBe(true)
    expect(hitItem(line('a', 0, 0), 40, 30, 2)).toBe(false)
    expect(hitItem(text(), 5, 5, 1)).toBe(true)
  })

  it('moves and scales every kind, keeping pressure and scaling the width', () => {
    const s = moveItem(stroke('a', [0, 0, 0.3, 10, 10, 0.8]), 5, -5)
    expect(s.points).toEqual([5, -5, 0.3, 15, 5, 0.8])
    const big = scaleItem(stroke('a', [10, 10, 0.3, 20, 20, 0.8]), 10, 10, 2)
    expect(big.points).toEqual([10, 10, 0.3, 30, 30, 0.8])
    expect(big.size).toBe(4)
    expect(scaleItem(shape(), 0, 0, 0.5)).toMatchObject({ x1: 5, y1: 10, x2: 55, y2: 35, size: 1 })
    expect(moveItem(text(), 3, 4)).toMatchObject({ x: 3, y: 4 })
    expect(scaleItem(text(), 0, 0, 2).size).toBe(40)
  })
})

describe('undo', () => {
  it('takes back what was added, removed and changed, and brings it again', () => {
    const d = new DrawingItems()
    d.load([line('a', 0, 0), line('b', 0, 10), line('c', 0, 20)])
    d.add([line('d', 0, 30)])
    d.remove(['a', 'c'])
    d.replace([moveItem(d.get('b') as StrokeItem, 100, 0)])
    const ids = () => d.items.map((i) => i.id).join('')
    expect(ids()).toBe('bd')
    d.undo()
    expect((d.get('b') as StrokeItem).points[0]).toBe(0)
    d.undo()
    expect(ids()).toBe('abcd')
    d.undo()
    expect(ids()).toBe('abc')
    expect(d.canUndo).toBe(false)
    d.redo()
    d.redo()
    expect(ids()).toBe('bd')
    d.add([line('e', 0, 0)])
    expect(d.canRedo).toBe(false)
  })

  it('puts back what one eraser touch took, one item after another, each in its place', () => {
    const d = new DrawingItems()
    d.load([line('a', 0, 0), line('b', 0, 10), line('c', 0, 20)])
    // Taken one at a time, as the eraser passes: first `a`, then `c` from what was left.
    const first = d.apply([{ id: 'a', before: d.get('a')!, after: null, at: 0 }], false)
    const second = d.apply([{ id: 'c', before: d.get('c')!, after: null, at: 1 }], false)
    d.record([...first, ...second])
    expect(d.items.map((i) => i.id)).toEqual(['b'])
    d.undo()
    expect(d.items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    d.redo()
    expect(d.items.map((i) => i.id)).toEqual(['b'])
  })

  it('puts back two items one touch of the eraser took at once, each in its place', () => {
    const items = new DrawingItems()
    items.load([line('a', 0, 0), line('b', 0, 100), line('c', 0, 0), line('d', 0, 200)])
    const g = eraseGesture(
      {
        items,
        zoom: () => 1,
        added: () => {},
        repaint: () => {},
        changed: () => {},
      },
      { x: 40, y: 0, p: 0.5 }
    )
    g.end(false)
    expect(items.items.map((i) => i.id)).toEqual(['b', 'd'])
    items.undo()
    expect(items.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('forgets everything when the drawing is read in afresh', () => {
    const d = new DrawingItems()
    d.add([line('a', 0, 0)])
    d.load([])
    expect(d.canUndo).toBe(false)
    expect(d.undo()).toBeNull()
  })
})

describe('the camera', () => {
  it('maps the drawing to the screen and back', () => {
    const c = { x: 100, y: 50, zoom: 2 }
    expect(toScreen(c, 110, 60)).toEqual([20, 20])
    expect(toWorld(c, 20, 20)).toEqual([110, 60])
  })

  it('keeps the point under the fingers where it is while zooming, and follows a drag', () => {
    const c = zoomAt({ x: 0, y: 0, zoom: 1 }, 200, 100, 2)
    expect(toWorld(c, 200, 100)).toEqual([200, 100])
    expect(panBy({ x: 0, y: 0, zoom: 2 }, 20, 10)).toEqual({ x: -10, y: -5, zoom: 2 })
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 0, 0, 1e6).zoom).toBe(20)
  })

  it('fits a part of the drawing in the middle of the view, no larger than asked', () => {
    const c = fitRect({ x: 0, y: 0, w: 100, h: 100 }, 400, 300, 1, 0)
    expect(c.zoom).toBe(1)
    expect(toScreen(c, 50, 50)).toEqual([200, 150])
    expect(fitRect({ x: 0, y: 0, w: 1000, h: 100 }, 500, 500, 1, 0).zoom).toBe(0.5)
  })

  it('reads a saved camera back only when it is one', () => {
    expect(cameraFrom({ x: 1, y: 2, zoom: 3 })).toEqual({ x: 1, y: 2, zoom: 3 })
    expect(cameraFrom({ x: 1, y: 2, zoom: 0 })).toBeNull()
    expect(cameraFrom('x')).toBeNull()
  })
})

describe('the pen and the eraser', () => {
  const context = (items: DrawingItems) => {
    const log = { added: 0, repainted: 0, changed: 0 }
    const ctx: ToolContext = {
      items,
      zoom: () => 1,
      added: () => void log.added++,
      repaint: () => void log.repainted++,
      changed: () => void log.changed++,
    }
    return { ctx, log }
  }

  it('leaves a stroke through every point the pen passed, with its pressure', () => {
    const items = new DrawingItems()
    const { ctx, log } = context(items)
    const g = strokeGesture(ctx, { tool: 'pen', color: 'red', size: 2 }, { x: 0, y: 0, p: 0.2 })
    g.move(
      [
        { x: 10.04, y: 5, p: 0.5 },
        { x: 10.04, y: 5, p: 0.6 },
        { x: 20, y: 9, p: 0.9 },
      ],
      []
    )
    g.end(false)
    expect(items.items).toHaveLength(1)
    expect(items.items[0]).toMatchObject({
      tool: 'pen',
      color: 'red',
      points: [0, 0, 0.2, 10, 5, 0.5, 20, 9, 0.9],
    })
    expect(log).toEqual({ added: 1, repainted: 0, changed: 1 })
    expect(items.canUndo).toBe(true)
  })

  it('drops a touch the system took back before it drew anything', () => {
    const items = new DrawingItems()
    const g = strokeGesture(
      context(items).ctx,
      { tool: 'pen', color: 'red', size: 2 },
      { x: 0, y: 0, p: 0.5 }
    )
    g.end(true)
    expect(items.items).toHaveLength(0)
  })

  it('takes away every item the eraser passes over, and undo brings all of them back', () => {
    const items = new DrawingItems()
    items.load([line('a', 0, 0), line('b', 0, 100), line('c', 0, 200)])
    const { ctx, log } = context(items)
    const g = eraseGesture(ctx, { x: 40, y: -30, p: 0.5 })
    g.move(
      [
        { x: 40, y: 0, p: 0.5 },
        { x: 40, y: 100, p: 0.5 },
      ],
      []
    )
    g.move([{ x: 40, y: 150, p: 0.5 }], [])
    g.end(false)
    expect(items.items.map((i) => i.id)).toEqual(['c'])
    expect(log.repainted).toBe(2)
    expect(log.changed).toBe(1)
    items.undo()
    expect(items.items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
})
