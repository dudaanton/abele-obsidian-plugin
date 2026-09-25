// ABELE addition: typings for the vendored module beside it.
/** How the overlay draws a mark: from the range's rectangles to an SVG group. */
export type OverlayDraw = (
  rects: DOMRect[],
  options?: { color?: string; width?: number; writingMode?: string }
) => SVGElement

export class Overlayer {
  static highlight: OverlayDraw
  static outline: OverlayDraw
  static underline: OverlayDraw
}
