/**
 * Where a diagram sits inside its frame, and how zooming and dragging move it.
 *
 * A view is `translate(x, y) scale(scale)` applied from the frame's top left corner to the
 * diagram drawn at its natural size. Every control of the viewer — buttons, wheel, drag,
 * pinch — is one of these functions from a view to the next, which is what keeps the viewer
 * itself free of arithmetic and this file free of the DOM.
 */

export interface View {
  scale: number
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** How far zooming out goes; fitting a very large diagram may go further. */
export const MIN_SCALE = 0.1
/** Ten times is enough to read the smallest label of a large diagram. */
export const MAX_SCALE = 10

/**
 * The shortest a frame gets, so that the controls in its corners — a row at the top, the
 * three-row pad at the bottom — fit one above the other with the larger buttons of a phone,
 * beside a diagram that is only one row of boxes.
 */
export const MIN_FRAME_HEIGHT = 176

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * The view that shows all of the diagram, centred.
 *
 * @param maxScale how far a small diagram may be enlarged to fill the frame. In a note it is
 *   1 — a two-box diagram blown up to the width of the page reads as a mistake — and in the
 *   full-screen view it is unbounded, because filling the screen is the point of that view.
 */
export function fitView(frame: Size, content: Size, maxScale = 1): View {
  if (frame.width <= 0 || frame.height <= 0 || content.width <= 0 || content.height <= 0) {
    return { scale: 1, x: 0, y: 0 }
  }
  // No lower limit: a diagram forty boxes wide needs whatever it takes to show all of it.
  const scale = Math.min(maxScale, MAX_SCALE, frame.width / content.width, frame.height / content.height)
  return {
    scale,
    x: (frame.width - content.width * scale) / 2,
    y: (frame.height - content.height * scale) / 2,
  }
}

/**
 * How tall a diagram's frame in a note is: the height the diagram takes once it is narrowed
 * to the note, no taller than `cap`, no shorter than the controls need.
 */
export function frameHeight(width: number, content: Size, cap: number): number {
  if (width <= 0 || content.width <= 0 || content.height <= 0) return MIN_FRAME_HEIGHT
  const scale = Math.min(1, width / content.width)
  return Math.round(
    clamp(content.height * scale, MIN_FRAME_HEIGHT, Math.max(cap, MIN_FRAME_HEIGHT))
  )
}

/** Zooms by `factor`, keeping the diagram point under `at` (frame coordinates) in place. */
export function zoomAt(view: View, factor: number, at: Point): View {
  // A view already under the limit — a huge diagram fitted — may stay there, but not shrink.
  const scale = clamp(view.scale * factor, Math.min(MIN_SCALE, view.scale), MAX_SCALE)
  if (scale === view.scale) return view
  const ratio = scale / view.scale
  return {
    scale,
    x: at.x - (at.x - view.x) * ratio,
    y: at.y - (at.y - view.y) * ratio,
  }
}

export function panBy(view: View, dx: number, dy: number): View {
  return { scale: view.scale, x: view.x + dx, y: view.y + dy }
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/**
 * Two fingers moved from `from` to `to`, applied to the view they started on. Zooms by how far
 * they spread, around where they started, and pans by how far their midpoint travelled.
 */
export function pinch(start: View, from: [Point, Point], to: [Point, Point]): View {
  const before = distance(from[0], from[1])
  const after = distance(to[0], to[1])
  const factor = before > 0 ? after / before : 1
  const startMid = midpoint(from[0], from[1])
  const endMid = midpoint(to[0], to[1])
  const zoomed = zoomAt(start, factor, startMid)
  return panBy(zoomed, endMid.x - startMid.x, endMid.y - startMid.y)
}
