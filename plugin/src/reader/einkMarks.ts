/**
 * Highlights as e-ink draws them (`eink.ts`): a black line whose shape tells the colour — a line
 * under the words, two, a dashed one, a box, a dashed box, a line over and under — rather than a
 * pale wash of colour a grey screen cannot tell apart, and which greys the words under it.
 *
 * A book's page is marked by the engine's overlay, in SVG (`einkMark`); a PDF's by boxes the
 * reader lays over its text layer (`einkBoxStyle`, for `drawBoxes`).
 */
import type { EinkShape } from './eink'

const SVG = 'http://www.w3.org/2000/svg'
/** How thick a line is, in the page's pixels: read at a glance, clear of the next line. */
const LINE = 2
const DASH = '6 4'

const svg = (name: string, attrs: Record<string, string | number>): SVGElement => {
  const el = document.createElementNS(SVG, name)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

const line = (x1: number, y: number, x2: number, dashed = false): SVGElement =>
  svg('line', {
    x1,
    y1: y,
    x2,
    y2: y,
    'stroke-width': LINE,
    ...(dashed ? { 'stroke-dasharray': DASH } : {}),
  })

/** The engine's drawing of an e-ink highlight: lines in the colour given — the ink, black. */
export function einkMark(shape: EinkShape) {
  return (rects: DOMRect[], options: { color?: string } = {}): SVGGElement => {
    const g = svg('g', { stroke: options.color ?? 'currentColor', fill: 'none' }) as SVGGElement
    for (const { left, right, top, bottom, width, height } of rects) {
      if (!width || !height) continue
      const under = bottom - LINE / 2
      switch (shape) {
        case 'underline':
          g.append(line(left, under, right))
          break
        case 'double':
          g.append(line(left, under, right), line(left, under - LINE * 2, right))
          break
        case 'dashed':
          g.append(line(left, under, right, true))
          break
        case 'over-under':
          g.append(line(left, top + LINE / 2, right), line(left, under, right))
          break
        case 'box':
        case 'dashed-box':
          g.append(
            svg('rect', {
              x: left,
              y: top,
              width,
              height,
              rx: 2,
              'stroke-width': LINE,
              ...(shape === 'dashed-box' ? { 'stroke-dasharray': DASH } : {}),
            })
          )
          break
      }
    }
    return g
  }
}

/** The style of a box laid over a PDF's words for an e-ink highlight: borders, no fill. */
export function einkBoxStyle(shape: EinkShape, color: string): Record<string, string> {
  const solid = `${LINE}px solid ${color}`
  const dashed = `${LINE}px dashed ${color}`
  const base = { 'box-sizing': 'border-box' }
  switch (shape) {
    case 'underline':
      return { ...base, 'border-bottom': solid }
    case 'double':
      return { ...base, 'border-bottom': `${LINE * 3}px double ${color}` }
    case 'dashed':
      return { ...base, 'border-bottom': dashed }
    case 'over-under':
      return { ...base, 'border-top': solid, 'border-bottom': solid }
    case 'box':
      return { ...base, border: solid }
    case 'dashed-box':
      return { ...base, border: dashed }
  }
}
