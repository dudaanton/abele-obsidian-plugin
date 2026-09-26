/**
 * What a drawing is made of: strokes of the pen and the marker, shapes, and blocks of text. Each
 * is a vector thing with an id, so it can be picked out later, moved, scaled or taken away.
 *
 * Coordinates are the drawing's own units — a CSS pixel at 100% — so everything keeps its place
 * and size at every zoom. Items are never changed in place: a move or a scale makes a new item
 * with the same id, which is what lets undo keep the old one and a painter cache its shapes by
 * the object.
 *
 * Strokes are the PDF ink's (`reader/ink/stroke.ts`): the same outline, pressure, colours and
 * hit test.
 */
import { hitStroke, isInkColor, penWidth, type InkColor, type InkTool } from '@/reader/ink/stroke'

export interface StrokeItem {
  id: string
  type: 'stroke'
  tool: InkTool
  color: InkColor
  size: number
  /** `x, y, pressure` for each point, one after the other. */
  points: number[]
}

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow'
export const SHAPE_KINDS: readonly ShapeKind[] = ['rect', 'ellipse', 'line', 'arrow']

export interface ShapeItem {
  id: string
  type: 'shape'
  kind: ShapeKind
  /** Where the drag began and where it ended: the box's corners, or the line's two ends. */
  x1: number
  y1: number
  x2: number
  y2: number
  color: InkColor
  size: number
}

export interface TextItem {
  id: string
  type: 'text'
  /** The top left of the first line. */
  x: number
  y: number
  text: string
  /** The height of the letters. */
  size: number
  color: InkColor
}

/**
 * A note shown on the drawing: its box on the drawing, and how large the note's own text is in
 * it — a card scaled up shows the same lines larger, as a picture of the note would.
 */
export interface NoteItem {
  id: string
  type: 'note'
  x: number
  y: number
  w: number
  h: number
  /** The drawing's units per pixel of the note's text: 1 shows it as a note shows it at 100%. */
  scale: number
  /** The note, by its path in the vault. */
  path: string
}

export type DrawingItem = StrokeItem | ShapeItem | TextItem | NoteItem

/** The items that carry a colour of their own. */
export type ColoredItem = StrokeItem | ShapeItem | TextItem
export const hasColor = (item: DrawingItem): item is ColoredItem => item.type !== 'note'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** A new id: short, and different from every other in the drawing for all practical purposes. */
export function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** The typeface text is set in, on the canvas and in the file alike. */
export const TEXT_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
/** A line of text is this many times its letters' height. */
export const LINE_HEIGHT = 1.25

type Measure = (text: string, size: number) => number
/** How wide a line of text is; a canvas measures it when there is one (`setTextMeasure`). */
let measure: Measure = (text, size) => text.length * size * 0.56
export function setTextMeasure(fn: Measure): void {
  measure = fn
}

export const textLines = (item: TextItem): string[] => item.text.split('\n')

/** How wide a text block is, and how tall. */
export function textSize(item: TextItem): { w: number; h: number } {
  const lines = textLines(item)
  const w = Math.max(item.size * 0.5, ...lines.map((l) => measure(l, item.size)))
  return { w, h: lines.length * item.size * LINE_HEIGHT }
}

/** How far an arrow's head reaches back from its point. */
export const arrowHead = (size: number): number => Math.max(10, size * 4)

const boundsCache = new WeakMap<DrawingItem, Rect>()

/** The box an item's ink covers, its width included. */
export function boundsOf(item: DrawingItem): Rect {
  const known = boundsCache.get(item)
  if (known) return known
  let out: Rect
  if (item.type === 'stroke') {
    const pts = item.points
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i + 2 < pts.length; i += 3) {
      if (pts[i] < x0) x0 = pts[i]
      if (pts[i] > x1) x1 = pts[i]
      if (pts[i + 1] < y0) y0 = pts[i + 1]
      if (pts[i + 1] > y1) y1 = pts[i + 1]
    }
    const half = item.tool === 'marker' ? item.size / 2 : penWidth(item.size, 1) / 2
    out = pts.length >= 3 ? pad({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, half) : empty()
  } else if (item.type === 'shape') {
    const reach = item.size / 2 + (item.kind === 'arrow' ? arrowHead(item.size) : 0)
    out = pad(
      {
        x: Math.min(item.x1, item.x2),
        y: Math.min(item.y1, item.y2),
        w: Math.abs(item.x2 - item.x1),
        h: Math.abs(item.y2 - item.y1),
      },
      reach
    )
  } else if (item.type === 'text') {
    const { w, h } = textSize(item)
    out = { x: item.x, y: item.y, w, h }
  } else out = { x: item.x, y: item.y, w: item.w, h: item.h }
  boundsCache.set(item, out)
  return out
}

const empty = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 })
const pad = (r: Rect, by: number): Rect => ({
  x: r.x - by,
  y: r.y - by,
  w: r.w + 2 * by,
  h: r.h + 2 * by,
})

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

/** The box around several boxes; null for none. */
export function union(rects: Iterable<Rect>): Rect | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** The box around a whole drawing; null for an empty one. */
export const contentBounds = (items: readonly DrawingItem[]): Rect | null =>
  union(items.map(boundsOf))

/** Distance from a point to a segment, squared. */
function distSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  const x = ax + t * dx - px
  const y = ay + t * dy - py
  return x * x + y * y
}

/** The segments a shape is drawn with, as `[ax, ay, bx, by]`; an ellipse as a polygon. */
export function shapeSegments(item: ShapeItem): [number, number, number, number][] {
  const { x1, y1, x2, y2 } = item
  if (item.kind === 'line' || item.kind === 'arrow') return [[x1, y1, x2, y2]]
  if (item.kind === 'rect')
    return [
      [x1, y1, x2, y1],
      [x2, y1, x2, y2],
      [x2, y2, x1, y2],
      [x1, y2, x1, y1],
    ]
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  const rx = Math.abs(x2 - x1) / 2
  const ry = Math.abs(y2 - y1) / 2
  const out: [number, number, number, number][] = []
  const n = 48
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const b = ((i + 1) / n) * Math.PI * 2
    out.push([
      cx + rx * Math.cos(a),
      cy + ry * Math.sin(a),
      cx + rx * Math.cos(b),
      cy + ry * Math.sin(b),
    ])
  }
  return out
}

/** Whether an eraser of `radius` at a point touches the item. */
export function hitItem(item: DrawingItem, x: number, y: number, radius: number): boolean {
  const b = boundsOf(item)
  if (x < b.x - radius || x > b.x + b.w + radius || y < b.y - radius || y > b.y + b.h + radius)
    return false
  if (item.type === 'stroke') return hitStroke(item, x, y, radius)
  if (item.type === 'text' || item.type === 'note') return true
  const reach = (radius + item.size / 2) ** 2
  return shapeSegments(item).some(([ax, ay, bx, by]) => distSq(x, y, ax, ay, bx, by) <= reach)
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** The item moved by a distance. */
export function moveItem<T extends DrawingItem>(item: T, dx: number, dy: number): T {
  if (item.type === 'stroke') {
    const points = item.points.map((v, i) => (i % 3 === 2 ? v : r1(v + (i % 3 === 0 ? dx : dy))))
    return { ...item, points }
  }
  if (item.type === 'shape')
    return {
      ...item,
      x1: r1(item.x1 + dx),
      y1: r1(item.y1 + dy),
      x2: r1(item.x2 + dx),
      y2: r1(item.y2 + dy),
    }
  return { ...item, x: r1(item.x + dx), y: r1(item.y + dy) }
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** The item scaled by `k` about a point, its width and its letters with it. */
export function scaleItem<T extends DrawingItem>(item: T, ox: number, oy: number, k: number): T {
  const sx = (x: number) => r1(ox + (x - ox) * k)
  const sy = (y: number) => r1(oy + (y - oy) * k)
  const size = hasColor(item) ? Math.round(item.size * k * 100) / 100 : 0
  if (item.type === 'stroke') {
    const points = item.points.map((v, i) => (i % 3 === 2 ? v : i % 3 === 0 ? sx(v) : sy(v)))
    return { ...item, points, size }
  }
  if (item.type === 'shape')
    return { ...item, x1: sx(item.x1), y1: sy(item.y1), x2: sx(item.x2), y2: sy(item.y2), size }
  if (item.type === 'note')
    return {
      ...item,
      x: sx(item.x),
      y: sy(item.y),
      w: r1(item.w * k),
      h: r1(item.h * k),
      scale: r3(item.scale * k),
    }
  return { ...item, x: sx(item.x), y: sy(item.y), size }
}

/** An item read back from a file, checked field by field; null for anything that is not one. */
export function itemFrom(raw: unknown): DrawingItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) ? o.id : newId()
  const color = isInkColor(o.color) ? o.color : 'black'
  const num = (v: unknown, lo: number, hi: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null
  const size = num(o.size, 0.05, 2000)
  const coord = (v: unknown) => num(v, -1e7, 1e7)
  if (o.type === 'stroke') {
    if (o.tool !== 'pen' && o.tool !== 'marker') return null
    if (!Array.isArray(o.points) || o.points.length < 3 || o.points.length % 3) return null
    if (!o.points.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
    return {
      id,
      type: 'stroke',
      tool: o.tool,
      color,
      size: size ?? 2,
      points: o.points as number[],
    }
  }
  if (o.type === 'shape') {
    if (!SHAPE_KINDS.includes(o.kind as ShapeKind)) return null
    const [x1, y1, x2, y2] = [o.x1, o.y1, o.x2, o.y2].map(coord)
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null
    return { id, type: 'shape', kind: o.kind as ShapeKind, x1, y1, x2, y2, color, size: size ?? 2 }
  }
  if (o.type === 'note') {
    const x = coord(o.x)
    const y = coord(o.y)
    const w = num(o.w, 1, 1e6)
    const h = num(o.h, 1, 1e6)
    const scale = num(o.scale, 0.001, 1000) ?? 1
    // A vault path: no control characters, nothing that climbs out of the vault.
    const path = typeof o.path === 'string' ? o.path : ''
    const okPath =
      path.length > 0 &&
      path.length < 1000 &&
      // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
      !/[\u0000-\u001f]/.test(path) &&
      !path.split('/').includes('..')
    if (x === null || y === null || w === null || h === null || !okPath) return null
    return { id, type: 'note', x, y, w, h, scale, path }
  }
  if (o.type === 'text') {
    const x = coord(o.x)
    const y = coord(o.y)
    if (x === null || y === null || typeof o.text !== 'string' || !o.text) return null
    return { id, type: 'text', x, y, text: o.text.slice(0, 20000), size: size ?? 20, color }
  }
  return null
}
