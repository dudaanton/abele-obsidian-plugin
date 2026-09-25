/**
 * A page's ink, drawn inside the page's frame: one SVG over the page, in the page's own units, at
 * the size the page is drawn. It is part of the page, so it scrolls, zooms and turns dark with it.
 * Styled on the elements themselves: a page carries none of the reader's styles.
 */
import { MARKER_OPACITY, inkLiteral, strokePath } from './stroke'
import type { InkPage } from './inkFile'

export const INK_CLASS = 'abele-ink'

const SVG = 'http://www.w3.org/2000/svg'

/** A PDF page's size at 100%, as its page document says it in its viewport. */
export function pageSizeOf(doc: Document): { width: number; height: number } | null {
  const content = doc.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? ''
  const width = Number(/width=([\d.]+)/.exec(content)?.[1])
  const height = Number(/height=([\d.]+)/.exec(content)?.[1])
  return width > 0 && height > 0 ? { width, height } : null
}

/** Draws the page's ink over it, in place of what was drawn before; nothing when it has none. */
export function drawInk(doc: Document, page: InkPage | undefined): void {
  const root = doc.documentElement
  if (!root) return
  root.querySelector(`:scope > .${INK_CLASS}`)?.remove()
  if (!page?.strokes.length) return
  const size = pageSizeOf(doc) ?? page
  const scale = Number(root.style.getPropertyValue('--scale-factor')) || 1
  const svg = doc.createElementNS(SVG, 'svg')
  svg.setAttribute('class', INK_CLASS)
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('viewBox', `0 0 ${page.width} ${page.height}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  for (const [k, v] of Object.entries({
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${size.width * scale}px`,
    height: `${size.height * scale}px`,
    'pointer-events': 'none',
    overflow: 'visible',
    // Ink on paper: the marker lets the words under it through, and the pen's black stays black.
    'mix-blend-mode': 'multiply',
  }))
    svg.style.setProperty(k, v)
  for (const stroke of page.strokes) {
    const path = doc.createElementNS(SVG, 'path')
    path.setAttribute('d', strokePath(stroke))
    const color = inkLiteral(stroke.color)
    if (stroke.tool === 'marker') {
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', color)
      path.setAttribute('stroke-opacity', String(MARKER_OPACITY))
      path.setAttribute('stroke-width', String(stroke.size))
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
    } else path.setAttribute('fill', color)
    svg.append(path)
  }
  root.appendChild(svg)
}
