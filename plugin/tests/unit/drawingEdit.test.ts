/**
 * Working on what is already drawn, without a screen: the lasso picking items out
 * (`drawing/selection.ts`), what is picked dragged and scaled, shapes drawn by a drag and a tap
 * of the text tool (`drawing/editTools.ts`).
 */
import { describe, it, expect } from 'vitest'
import { boxPart, insideLoop, itemAt, lassoPick, pickedBounds } from '@/drawing/selection'
import {
  dragGesture,
  floated,
  lassoGesture,
  shapeGesture,
  textGesture,
  type EditContext,
  type Float,
} from '@/drawing/editTools'
import { DrawingItems } from '@/drawing/history'
import type { DrawingItem, ShapeItem, StrokeItem, TextItem } from '@/drawing/items'

const line = (id: string, x: number, y: number): StrokeItem => ({
  id,
  type: 'stroke',
  tool: 'pen',
  color: 'black',
  size: 2,
  points: [x, y, 0.5, x + 40, y, 0.5, x + 80, y, 0.5],
})
const text = (id: string, x: number, y: number): TextItem => ({
  id,
  type: 'text',
  x,
  y,
  text: 'Hi',
  size: 20,
  color: 'black',
})
/** A loop round a box, as `x, y` pairs. */
const loopRound = (x: number, y: number, w: number, h: number) => [
  x,
  y,
  x + w,
  y,
  x + w,
  y + h,
  x,
  y + h,
]

const context = (items: DrawingItems) => {
  const log: { picked: string[][]; floats: (Float | null)[]; texts: unknown[]; changed: number } = {
    picked: [],
    floats: [],
    texts: [],
    changed: 0,
  }
  let picked = new Set<string>()
  const ctx: EditContext = {
    items,
    zoom: () => 1,
    added: () => {},
    repaint: () => {},
    changed: () => void log.changed++,
    picked: () => picked,
    pick: (ids) => {
      picked = new Set(ids)
      log.picked.push(ids)
    },
    float: (f) => void log.floats.push(f),
    editText: (at, item) => void log.texts.push({ at, item }),
  }
  return { ctx, log, setPicked: (ids: string[]) => (picked = new Set(ids)) }
}

describe('picking out', () => {
  it('knows the inside of a loop', () => {
    const loop = loopRound(0, 0, 100, 100)
    expect(insideLoop(loop, 50, 50)).toBe(true)
    expect(insideLoop(loop, 150, 50)).toBe(false)
  })

  it('takes what a loop goes round, a stroke when most of it is inside', () => {
    const items: DrawingItem[] = [line('in', 10, 10), line('half', 60, 50), line('out', 300, 300)]
    // `half` runs from 60 to 140: the loop to 110 holds its first two points of three.
    expect(lassoPick(items, loopRound(0, 0, 110, 100))).toEqual(['in', 'half'])
    expect(lassoPick(items, loopRound(0, 0, 90, 100))).toEqual(['in'])
    expect(lassoPick(items, [0, 0, 1, 1])).toEqual([])
  })

  it('takes a shape by its middle and corners, text by its middle', () => {
    const box: ShapeItem = {
      id: 'b',
      type: 'shape',
      kind: 'rect',
      x1: 10,
      y1: 10,
      x2: 50,
      y2: 50,
      color: 'blue',
      size: 2,
    }
    expect(lassoPick([box, text('t', 200, 200)], loopRound(0, 0, 300, 300))).toEqual(['b', 't'])
    expect(lassoPick([box], loopRound(0, 0, 30, 30))).toEqual([])
  })

  it('finds the topmost item under a tap', () => {
    const items = [line('a', 0, 0), line('b', 0, 0)]
    expect(itemAt(items, 40, 0, 3)).toBe('b')
    expect(itemAt(items, 40, 50, 3)).toBeNull()
  })

  it('tells the handle from the inside of the box and the outside', () => {
    const box = { x: 0, y: 0, w: 100, h: 50 }
    expect(boxPart(box, 100, 50, 1)).toBe('handle')
    expect(boxPart(box, 50, 25, 1)).toBe('inside')
    expect(boxPart(box, 200, 25, 1)).toBe('outside')
    // The handle is as large on screen at any zoom.
    expect(boxPart(box, 100, 55, 4)).toBe('outside')
  })
})

describe('the lasso', () => {
  it('picks what it went round, and a tap picks the item under it or nothing', () => {
    const items = new DrawingItems()
    items.load([line('a', 10, 10), line('b', 300, 300)])
    const { ctx, log } = context(items)
    const g = lassoGesture(ctx, { x: 0, y: 0, p: 0.5 })
    g.move(
      [
        { x: 120, y: 0, p: 0.5 },
        { x: 120, y: 50, p: 0.5 },
        { x: 0, y: 50, p: 0.5 },
      ],
      []
    )
    g.end(false)
    expect(log.picked.at(-1)).toEqual(['a'])
    const tap = lassoGesture(ctx, { x: 340, y: 300, p: 0.5 })
    tap.end(false)
    expect(log.picked.at(-1)).toEqual(['b'])
    const miss = lassoGesture(ctx, { x: 900, y: 900, p: 0.5 })
    miss.end(false)
    expect(log.picked.at(-1)).toEqual([])
  })
})

describe('dragging what is picked', () => {
  it('moves it, as one step undo takes back', () => {
    const items = new DrawingItems()
    items.load([line('a', 0, 0), line('b', 0, 100)])
    const { ctx, log, setPicked } = context(items)
    setPicked(['a'])
    const box = pickedBounds(items.items, new Set(['a']))!
    const g = dragGesture(ctx, { x: 10, y: 0, p: 0.5 }, box, 'move')
    g.move([{ x: 30, y: 50, p: 0.5 }], [])
    g.end(false)
    expect((items.get('a') as StrokeItem).points.slice(0, 2)).toEqual([20, 50])
    expect((items.get('b') as StrokeItem).points.slice(0, 2)).toEqual([0, 100])
    expect(log.floats.at(-1)).toBeNull()
    expect(log.changed).toBe(1)
    items.undo()
    expect((items.get('a') as StrokeItem).points.slice(0, 2)).toEqual([0, 0])
  })

  it('scales it about the box’s top left from the handle, the lines’ width with it', () => {
    const items = new DrawingItems()
    items.load([line('a', 0, 0)])
    const { ctx, setPicked } = context(items)
    setPicked(['a'])
    const box = { x: 0, y: 0, w: 80, h: 20 }
    const g = dragGesture(ctx, { x: 80, y: 20, p: 0.5 }, box, 'scale')
    g.move([{ x: 160, y: 40, p: 0.5 }], [])
    g.end(false)
    const a = items.get('a') as StrokeItem
    expect(a.points.slice(3, 5)).toEqual([80, 0])
    expect(a.size).toBe(4)
  })

  it('changes nothing when let go where it began', () => {
    const items = new DrawingItems()
    items.load([line('a', 0, 0)])
    const { ctx, log, setPicked } = context(items)
    setPicked(['a'])
    const g = dragGesture(ctx, { x: 10, y: 0, p: 0.5 }, { x: 0, y: 0, w: 80, h: 2 }, 'move')
    g.end(false)
    expect(log.changed).toBe(0)
    expect(items.canUndo).toBe(false)
  })

  it('shows the same place while dragged as it gets when let go', () => {
    const f: Float = { dx: 5, dy: -5, k: 2, ox: 10, oy: 10 }
    const a = floated(line('a', 10, 10), f) as StrokeItem
    expect(a.points.slice(0, 2)).toEqual([15, 5])
    expect(a.points.slice(3, 5)).toEqual([95, 5])
  })
})

describe('shapes and text', () => {
  it('leaves the shape a drag drew, and nothing for a tap', () => {
    const items = new DrawingItems()
    const { ctx } = context(items)
    const g = shapeGesture(ctx, 'arrow', { color: 'red', size: 2 }, { x: 0, y: 0, p: 0.5 })
    g.move([{ x: 100.04, y: 50, p: 0.5 }], [])
    g.end(false)
    expect(items.items[0]).toMatchObject({
      type: 'shape',
      kind: 'arrow',
      x2: 100,
      y2: 50,
      color: 'red',
    })
    const tap = shapeGesture(ctx, 'rect', { color: 'red', size: 2 }, { x: 0, y: 0, p: 0.5 })
    tap.end(false)
    expect(items.items).toHaveLength(1)
  })

  it('opens text where the tap lands, or the text block tapped', () => {
    const items = new DrawingItems()
    items.load([text('t', 100, 100)])
    const { ctx, log } = context(items)
    textGesture(ctx, { x: 10, y: 10, p: 0.5 }).end(false)
    textGesture(ctx, { x: 105, y: 110, p: 0.5 }).end(false)
    expect(log.texts).toEqual([
      { at: { x: 10, y: 10, p: 0.5 }, item: null },
      { at: { x: 105, y: 110, p: 0.5 }, item: items.items[0] },
    ])
    // A drag with the text tool is not a tap.
    const drag = textGesture(ctx, { x: 10, y: 10, p: 0.5 })
    drag.move([{ x: 80, y: 10, p: 0.5 }], [])
    drag.end(false)
    expect(log.texts).toHaveLength(2)
  })
})

describe('what goes wrong with a drag', () => {
  const shape = (id: string, x1: number, y1: number, x2: number, y2: number): ShapeItem => ({
    id,
    type: 'shape',
    kind: 'rect',
    x1,
    y1,
    x2,
    y2,
    color: 'black',
    size: 2,
  })

  it('has the items where they were let go by the time the canvas is painted again', () => {
    // Dropping the float paints the canvas from the items: were they still where the drag began,
    // what was dragged would be painted back there, and stay there until something else moved.
    const items = new DrawingItems()
    items.load([shape('s', 0, 0, 100, 50)])
    const { ctx, setPicked } = context(items)
    setPicked(['s'])
    const seen: (number | null)[] = []
    ctx.float = (f) => {
      if (!f) seen.push((items.get('s') as ShapeItem).x1)
    }
    const box = pickedBounds(items.items, new Set(['s']))!
    const g = dragGesture(ctx, { x: 50, y: 25, p: 0.5 }, box, 'move')
    g.move([{ x: 250, y: 125, p: 0.5 }], [])
    g.end(false)
    expect(seen).toEqual([200])
  })

  it('does not jump when the handle is taken a little off the corner', () => {
    const items = new DrawingItems()
    items.load([shape('s', 0, 0, 40, 40)])
    const { ctx, log, setPicked } = context(items)
    setPicked(['s'])
    const box = pickedBounds(items.items, new Set(['s']))!
    // Taken 8 units past the corner, as the handle allows, and not moved yet.
    const cx = box.x + box.w + 8
    const cy = box.y + box.h + 8
    const g = dragGesture(ctx, { x: cx, y: cy, p: 0.5 }, box, 'scale')
    g.move([{ x: cx, y: cy, p: 0.5 }], [])
    expect(log.floats.at(-1)?.k).toBeCloseTo(1, 5)
    // Pulled as far again as the corner is from the box's top left: twice the size.
    g.move([{ x: cx + (cx - box.x), y: cy + (cy - box.y), p: 0.5 }], [])
    expect(log.floats.at(-1)?.k).toBeCloseTo(2, 5)
  })

  it('does not jump either when a box smaller than the handle is taken beside its corner', () => {
    const items = new DrawingItems()
    items.load([shape('s', 0, 0, 2, 2)])
    const { ctx, log, setPicked } = context(items)
    setPicked(['s'])
    const box = pickedBounds(items.items, new Set(['s']))!
    // Up and to the left of the corner, still on the handle, which is larger than the box.
    const g = dragGesture(ctx, { x: box.x - 4, y: box.y - 4, p: 0.5 }, box, 'scale')
    g.move([{ x: box.x - 4 + 6, y: box.y - 4 + 6, p: 0.5 }], [])
    expect(log.floats.at(-1)?.k).toBeGreaterThan(1)
    g.move([{ x: box.x - 4 + 0.1, y: box.y - 4, p: 0.5 }], [])
    expect(log.floats.at(-1)?.k).toBeCloseTo(1, 1)
  })

  it('keeps what a pen tap inside the box barely moved where it was', () => {
    const items = new DrawingItems()
    items.load([shape('s', 0, 0, 100, 50)])
    const { ctx, log, setPicked } = context(items)
    setPicked(['s'])
    const box = pickedBounds(items.items, new Set(['s']))!
    const g = dragGesture(ctx, { x: 50, y: 25, p: 0.5 }, box, 'move')
    g.move([{ x: 51.5, y: 24, p: 0.5 }], [])
    g.end(false)
    expect((items.get('s') as ShapeItem).x1).toBe(0)
    expect(log.changed).toBe(0)
    expect(items.canUndo).toBe(false)
  })

  it('moves the whole way once it moved further than a tap, not less by the tap', () => {
    const items = new DrawingItems()
    items.load([shape('s', 0, 0, 100, 50)])
    const { ctx, setPicked } = context(items)
    setPicked(['s'])
    const box = pickedBounds(items.items, new Set(['s']))!
    const g = dragGesture(ctx, { x: 50, y: 25, p: 0.5 }, box, 'move')
    g.move([{ x: 60, y: 25, p: 0.5 }], [])
    g.move([{ x: 53, y: 25, p: 0.5 }], [])
    g.end(false)
    expect((items.get('s') as ShapeItem).x1).toBe(3)
  })

  it('picks the one item a tap inside the box lands on, out of several', () => {
    const items = new DrawingItems()
    items.load([line('a', 0, 0), line('b', 0, 100)])
    const { ctx, log, setPicked } = context(items)
    setPicked(['a', 'b'])
    const box = pickedBounds(items.items, new Set(['a', 'b']))!
    dragGesture(ctx, { x: 40, y: 100, p: 0.5 }, box, 'move').end(false)
    expect(log.picked.at(-1)).toEqual(['b'])
    // A tap on nothing inside the box keeps what is picked.
    dragGesture(ctx, { x: 40, y: 50, p: 0.5 }, box, 'move').end(false)
    expect(log.picked).toHaveLength(1)
  })

  it('picks a box or a ring by a tap inside it, not only on its line', () => {
    const items = new DrawingItems()
    items.load([shape('s', 0, 0, 200, 100), { ...shape('e', 300, 0, 400, 100), kind: 'ellipse' }])
    const { ctx, log } = context(items)
    lassoGesture(ctx, { x: 100, y: 50, p: 0.5 }).end(false)
    expect(log.picked.at(-1)).toEqual(['s'])
    lassoGesture(ctx, { x: 350, y: 50, p: 0.5 }).end(false)
    expect(log.picked.at(-1)).toEqual(['e'])
    // The corner of the ring's box is outside the ring.
    lassoGesture(ctx, { x: 305, y: 5, p: 0.5 }).end(false)
    expect(log.picked.at(-1)).toEqual([])
  })

  it('works the same at another zoom: a tap is measured on the screen', () => {
    const items = new DrawingItems()
    items.load([shape('s', 0, 0, 100, 50)])
    const { ctx, setPicked } = context(items)
    ctx.zoom = () => 4
    setPicked(['s'])
    const box = pickedBounds(items.items, new Set(['s']))!
    // 3 units at 400% is 12 pixels on screen: a move, not a tap.
    const g = dragGesture(ctx, { x: 50, y: 25, p: 0.5 }, box, 'move')
    g.move([{ x: 53, y: 25, p: 0.5 }], [])
    g.end(false)
    expect((items.get('s') as ShapeItem).x1).toBe(3)
  })
})
