/**
 * Where the drawing is looked at from: the point of the drawing at the view's top left corner,
 * and how large it is shown. A point of the drawing lands on screen at
 * `(point - corner) × zoom`, and the other way round.
 */
import type { Rect } from './items'

export interface Camera {
  x: number
  y: number
  zoom: number
}

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 20

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export const toScreen = (c: Camera, x: number, y: number): [number, number] => [
  (x - c.x) * c.zoom,
  (y - c.y) * c.zoom,
]

export const toWorld = (c: Camera, sx: number, sy: number): [number, number] => [
  c.x + sx / c.zoom,
  c.y + sy / c.zoom,
]

/** The part of the drawing a view of a size shows. */
export const visibleRect = (c: Camera, width: number, height: number): Rect => ({
  x: c.x,
  y: c.y,
  w: width / c.zoom,
  h: height / c.zoom,
})

/** The camera moved by a distance on screen: the drawing follows the finger. */
export const panBy = (c: Camera, dx: number, dy: number): Camera => ({
  x: c.x - dx / c.zoom,
  y: c.y - dy / c.zoom,
  zoom: c.zoom,
})

/** The camera zoomed by a factor, the point of the drawing under a screen point staying there. */
export function zoomAt(c: Camera, sx: number, sy: number, factor: number): Camera {
  const zoom = clampZoom(c.zoom * factor)
  const [wx, wy] = toWorld(c, sx, sy)
  return { x: wx - sx / zoom, y: wy - sy / zoom, zoom }
}

/** A camera that shows a part of the drawing whole, centred, in a view of a size. */
export function fitRect(r: Rect, width: number, height: number, max = 1, margin = 32): Camera {
  const w = Math.max(1, width - 2 * margin)
  const h = Math.max(1, height - 2 * margin)
  const zoom = clampZoom(Math.min(max, w / Math.max(1, r.w), h / Math.max(1, r.h)))
  return {
    x: r.x + r.w / 2 - width / 2 / zoom,
    y: r.y + r.h / 2 - height / 2 / zoom,
    zoom,
  }
}

/** A camera read back from a saved view state; null for anything that is not one. */
export function cameraFrom(raw: unknown): Camera | null {
  const o = raw as Partial<Camera> | null
  if (!o || typeof o !== 'object') return null
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  if (!ok(o.x) || !ok(o.y) || !ok(o.zoom) || o.zoom <= 0) return null
  return { x: o.x, y: o.y, zoom: clampZoom(o.zoom) }
}
