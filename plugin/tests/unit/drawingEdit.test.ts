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
