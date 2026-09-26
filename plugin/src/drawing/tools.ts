/**
 * What a touch of each tool does, from the moment it lands to the moment it lifts: the pen and
 * the marker leave a stroke, the eraser takes away every item it passes over — the whole item, as
 * on a PDF's page. Each works on the drawing's items and says what has to be painted again; none
 * touches the screen itself, so they are tested without a canvas.
 */
import { roundPoint, type InkColor, type InkTool } from '@/reader/ink/stroke'
import type { DrawingItems, ItemChange } from './history'
import {
  boundsOf,
  hitItem,
  newId,
  union,
  type DrawingItem,
  type Rect,
  type StrokeItem,
} from './items'
import { paintItem } from './renderer'
import type { ToolGesture, WorldPoint } from './surface'

export interface ToolContext {
  items: DrawingItems
  /** How large the drawing is shown now. */
  zoom(): number
  /** Items were added on top of the rest. */
  added(items: DrawingItem[]): void
  /** A part of the drawing has to be painted again. */
  repaint(area: Rect): void
  /** The drawing changed: undo may have something new, and the file is to be written. */
  changed(): void
}

export interface Brush {
  tool: InkTool
  color: InkColor
  size: number
}

/** A pen's or a marker's touch: a stroke through every point it passes. */
export function strokeGesture(ctx: ToolContext, brush: Brush, start: WorldPoint): ToolGesture {
  const points: number[] = []
  let ahead: number[] = []
  const add = (pt: WorldPoint) => {
    const [x, y, p] = roundPoint(pt.x, pt.y, pt.p)
    const n = points.length
    if (n >= 3 && points[n - 3] === x && points[n - 2] === y) return
    points.push(x, y, p)
  }
  add(start)
  return {
    move(pts, predicted) {
      for (const pt of pts) add(pt)
      ahead = predicted.flatMap((pt) => roundPoint(pt.x, pt.y, pt.p))
    },
    end(cancelled) {
      ahead = []
      // A touch the system took back after it had drawn a line is still the line drawn.
      if (cancelled && points.length <= 9) return
      const stroke: StrokeItem = { id: newId(), type: 'stroke', ...brush, points: [...points] }
      ctx.items.add([stroke])
      ctx.added([stroke])
      ctx.changed()
    },
    paint(c) {
      const live: StrokeItem = {
        id: '',
        type: 'stroke',
        ...brush,
        points: [...points, ...ahead],
      }
      paintItem(c, live)
    },
  }
}

/** How far round the eraser reaches, in screen pixels. */
export const ERASER_RADIUS = 10

/** The eraser's touch: every item it passes over goes, and undo brings them all back at once. */
export function eraseGesture(ctx: ToolContext, start: WorldPoint): ToolGesture {
  const taken: ItemChange[] = []
  let at = start
  const eraseAt = (pt: WorldPoint) => {
    const radius = ERASER_RADIUS / ctx.zoom()
    // A note on the drawing is not ink: the lasso takes it away, the eraser passes over it.
    const hit = ctx.items.items.filter(
      (item) => item.type !== 'note' && hitItem(item, pt.x, pt.y, radius)
    )
    if (!hit.length) return
    // Places counted as if taken one after the other, as the steps of undo are put back.
    const changes = hit.map(
      (item, k): ItemChange => ({
        id: item.id,
        before: item,
        after: null,
        at: ctx.items.items.indexOf(item) - k,
      })
    )
    ctx.items.apply(changes, false)
    taken.push(...changes)
    const area = union(hit.map(boundsOf))
    if (area) ctx.repaint(area)
  }
  eraseAt(start)
  return {
    move(pts) {
      for (const pt of pts) eraseAt(pt)
      at = pts[pts.length - 1] ?? at
    },
    end() {
      if (!taken.length) return
      ctx.items.record(taken)
      ctx.changed()
    },
    paint(c, zoom) {
      c.globalAlpha = 1
      c.beginPath()
      c.arc(at.x, at.y, ERASER_RADIUS / zoom, 0, Math.PI * 2)
      c.lineWidth = 1 / zoom
      c.strokeStyle = '#888888'
      c.stroke()
    },
  }
}
