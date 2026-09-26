/**
 * The tools that work on what is already drawn, and the shapes: the lasso picks items out, what is
 * picked is dragged to move it and dragged by its corner to scale it, a drag of the shape tool
 * leaves a box, a ring, a line or an arrow, and a tap of the text tool opens a block of text to
 * type into — or the one tapped, to change it.
 *
 * Like the pen's and the eraser's (`tools.ts`), these work on the drawing's items and say what
 * has to be painted; the screen itself is the session's.
 */
import type { ShapeKind, ShapeItem, DrawingItem, Rect } from './items'
import { moveItem, newId, scaleItem } from './items'
import { itemAt, lassoPick, pickAt } from './selection'
import { paintItem } from './renderer'
import type { ToolGesture, WorldPoint } from './surface'
import type { Brush, ToolContext } from './tools'

/** How the picked items are shown while they are dragged: moved, and scaled about a point. */
export interface Float {
  dx: number
  dy: number
  k: number
  ox: number
  oy: number
}

export const noFloat = (): Float => ({ dx: 0, dy: 0, k: 1, ox: 0, oy: 0 })

/** An item as a float puts it. */
export function floated(item: DrawingItem, f: Float): DrawingItem {
  const scaled = f.k === 1 ? item : scaleItem(item, f.ox, f.oy, f.k)
  return f.dx || f.dy ? moveItem(scaled, f.dx, f.dy) : scaled
}

/** A box as a float puts it. */
export const floatedBox = (b: Rect, f: Float): Rect => ({
  x: f.ox + (b.x - f.ox) * f.k + f.dx,
  y: f.oy + (b.y - f.oy) * f.k + f.dy,
  w: b.w * f.k,
  h: b.h * f.k,
})

export interface EditContext extends ToolContext {
  picked(): ReadonlySet<string>
  pick(ids: string[]): void
  /** The picked items shown as dragged (or back in place, for null). */
  float(f: Float | null): void
  /** A text block to type into: a new one at a point, or one already there. */
  editText(at: { x: number; y: number }, item: DrawingItem | null): void
}

/** A tap moves less than this, in screen pixels. */
const TAP = 6

/** The lasso: a loop round items picks them; a tap picks the one under it, or nothing. */
export function lassoGesture(ctx: EditContext, start: WorldPoint): ToolGesture {
  const loop = [start.x, start.y]
  let far = 0
  return {
    move(pts) {
      for (const p of pts) {
        loop.push(p.x, p.y)
        far = Math.max(far, Math.hypot(p.x - start.x, p.y - start.y) * ctx.zoom())
      }
    },
    end(cancelled) {
      if (cancelled) return
      if (far < TAP) {
        const id = pickAt(ctx.items.items, start.x, start.y, 8 / ctx.zoom())
        ctx.pick(id ? [id] : [])
        return
      }
      ctx.pick(lassoPick(ctx.items.items, loop))
    },
    paint(c, zoom) {
      c.globalAlpha = 1
      c.globalCompositeOperation = 'source-over'
      c.beginPath()
      for (let i = 0; i + 1 < loop.length; i += 2)
        if (i) c.lineTo(loop[i], loop[i + 1])
        else c.moveTo(loop[i], loop[i + 1])
      c.lineWidth = 1.5 / zoom
      c.setLineDash([6 / zoom, 4 / zoom])
      c.strokeStyle = '#1864d6'
      c.stroke()
      c.setLineDash([])
    },
  }
}

/**
 * Drags what is picked by a distance, or — from the handle — scales it about the box's corner.
 *
 * Until it has gone further than a tap it stays put: a pen never lands without a quiver, and a
 * tap inside the box picks out the one item it lands on instead.
 */
export function dragGesture(
  ctx: EditContext,
  start: WorldPoint,
  box: Rect,
  mode: 'move' | 'scale'
): ToolGesture {
  let f = noFloat()
  let started = false
  // Along the box's diagonal from its top left corner, whatever way the finger strays — measured
  // from where the handle was taken, which may be a little off the corner, so it does not jump.
  const len = box.w * box.w + box.h * box.h || 1
  const along = (p: { x: number; y: number }) => (p.x - box.x) * box.w + (p.y - box.y) * box.h
  const grip = along(start)
  // A box too small for its handle may be taken beside its corner, or even above it: then the
  // size follows how far the finger goes, which is 1 where it was taken all the same.
  const scaleAt = (p: { x: number; y: number }) =>
    grip >= len / 2 ? along(p) / grip : 1 + (along(p) - grip) / len
  ctx.float(f)
  return {
    move(pts) {
      const p = pts[pts.length - 1]
      if (!p) return
      if (!started) started = Math.hypot(p.x - start.x, p.y - start.y) * ctx.zoom() >= TAP
      if (!started) return
      if (mode === 'move') f = { ...noFloat(), dx: p.x - start.x, dy: p.y - start.y }
      else {
        const k = scaleAt(p)
        f = { dx: 0, dy: 0, k: Math.max(0.05, Math.min(50, k)), ox: box.x, oy: box.y }
      }
      ctx.float(f)
    },
    end(cancelled) {
      const moved = started && (f.dx || f.dy || f.k !== 1)
      if (!cancelled && moved) {
        // The items go where they were let go before the float is dropped: dropping it paints the
        // canvas from them, and painted from where they were they would jump back there.
        const picked = ctx.picked()
        ctx.items.replace(ctx.items.items.filter((i) => picked.has(i.id)).map((i) => floated(i, f)))
      }
      ctx.float(null)
      if (cancelled) return
      if (moved) {
        ctx.changed()
        return
      }
      // A tap inside the box: the item it lands on, alone — one of several picked, or one the
      // box happens to cover.
      if (!started && mode === 'move') {
        const id = pickAt(ctx.items.items, start.x, start.y, 8 / ctx.zoom())
        const picked = ctx.picked()
        if (id && !(picked.size === 1 && picked.has(id))) ctx.pick([id])
      }
    },
  }
}

/** A drag of the shape tool: the shape from where it began to where it ends. */
export function shapeGesture(
  ctx: EditContext,
  kind: ShapeKind,
  brush: Omit<Brush, 'tool'>,
  start: WorldPoint
): ToolGesture {
  const shape: ShapeItem = {
    id: newId(),
    type: 'shape',
    kind,
    x1: start.x,
    y1: start.y,
    x2: start.x,
    y2: start.y,
    color: brush.color,
    size: brush.size,
  }
  const r1 = (n: number) => Math.round(n * 10) / 10
  return {
    move(pts) {
      const p = pts[pts.length - 1]
      if (!p) return
      shape.x2 = p.x
      shape.y2 = p.y
    },
    end(cancelled) {
      const far = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) * ctx.zoom()
      if (cancelled || far < TAP) return
      const item: ShapeItem = {
        ...shape,
        x1: r1(shape.x1),
        y1: r1(shape.y1),
        x2: r1(shape.x2),
        y2: r1(shape.y2),
      }
      ctx.items.add([item])
      ctx.added([item])
      ctx.changed()
    },
    paint(c) {
      // A copy each time: the painter keeps shapes by the object, and this one keeps changing.
      paintItem(c, { ...shape })
    },
  }
}

/** A tap of the text tool: a new block where it lands, or the block it lands on to change. */
export function textGesture(ctx: EditContext, start: WorldPoint): ToolGesture {
  let far = 0
  return {
    move(pts) {
      for (const p of pts)
        far = Math.max(far, Math.hypot(p.x - start.x, p.y - start.y) * ctx.zoom())
    },
    end(cancelled) {
      if (cancelled || far >= TAP) return
      const items = ctx.items.items
      const id = itemAt(
        items.filter((i) => i.type === 'text'),
        start.x,
        start.y,
        4 / ctx.zoom()
      )
      ctx.editText(start, id ? (items.find((i) => i.id === id) ?? null) : null)
    },
  }
}
