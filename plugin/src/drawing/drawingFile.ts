/**
 * A drawing's file: an ordinary SVG, so Obsidian shows it as a picture in a note, on its own
 * canvases and on a phone without the plugin, which carries what the plugin needs to open it
 * again for drawing.
 *
 * ```xml
 * <svg … viewBox="x y w h" data-abele-drawing="1">
 * <metadata id="abele-drawing">{"v":1,"items":[…]}</metadata>
 * <rect … fill="#ffffff"/>     the paper, the drawing's bounds and a margin
 * <path …/> <text …/> …        one element per item, what is shown
 * </svg>
 * ```
 *
 * Only the JSON in the metadata is read back, item by item and checked (`itemFrom`); nothing of
 * the file's own markup ever reaches a page. The JSON is written with `<`, `>` and `&` escaped as
 * `\u00XX`, which keeps it valid XML text and valid JSON at once.
 *
 * Everything here works on text, so it is tested without a vault.
 */
import { MARKER_OPACITY, inkLiteral, strokePath } from '@/reader/ink/stroke'
import {
  LINE_HEIGHT,
  TEXT_FONT,
  arrowHead,
  contentBounds,
  itemFrom,
  newId,
  textLines,
  type DrawingItem,
  type Rect,
  type ShapeItem,
} from './items'
import { noteCardSvg } from './noteCard'

/** Room left round what is drawn, in the picture a note shows. */
export const MARGIN = 24
/**
 * The paper: white in every theme, as the PDF ink's is, so the picture looks the same in a dark
 * note, on a phone and in another app.
 */
export const PAPER = '#ffffff'
/** The size of the paper of a drawing with nothing on it yet. */
const BLANK: Rect = { x: 0, y: 0, w: 800, h: 600 }

export interface DrawingData {
  items: DrawingItem[]
}

const f = (n: number) => String(Math.round(n * 100) / 100)

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Where a text block's line sits: its baseline, from the block's top. */
export const baselineOf = (size: number, line: number): number => size * (LINE_HEIGHT * line + 1)

/** The two strokes of an arrow's head, from its point back along the line. */
export function arrowHeadPath(s: ShapeItem): string {
  const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1
  const ux = (s.x2 - s.x1) / len
  const uy = (s.y2 - s.y1) / len
  const back = Math.min(arrowHead(s.size), len * 0.6)
  const wing = back * 0.55
  const bx = s.x2 - ux * back
  const by = s.y2 - uy * back
  return (
    `M${f(bx - uy * wing)} ${f(by + ux * wing)}L${f(s.x2)} ${f(s.y2)}` +
    `L${f(bx + uy * wing)} ${f(by - ux * wing)}`
  )
}

const elementCache = new WeakMap<DrawingItem, string>()

/** An item as the markup that shows it. */
export function itemElement(item: DrawingItem): string {
  const known = elementCache.get(item)
  if (known !== undefined) return known
  if (item.type === 'note') {
    const card = noteCardSvg(item)
    elementCache.set(item, card)
    return card
  }
  const color = inkLiteral(item.color)
  let out: string
  if (item.type === 'stroke') {
    const paint =
      item.tool === 'marker'
        ? `fill="none" stroke="${color}" stroke-opacity="${MARKER_OPACITY}" stroke-width="${item.size}" stroke-linecap="round" stroke-linejoin="round" style="mix-blend-mode:multiply"`
        : `fill="${color}"`
    out = `<path d="${esc(strokePath(item))}" ${paint}/>`
  } else if (item.type === 'shape') {
    const line = `fill="none" stroke="${color}" stroke-width="${item.size}" stroke-linecap="round" stroke-linejoin="round"`
    const { x1, y1, x2, y2 } = item
    if (item.kind === 'rect')
      out = `<rect x="${f(Math.min(x1, x2))}" y="${f(Math.min(y1, y2))}" width="${f(Math.abs(x2 - x1))}" height="${f(Math.abs(y2 - y1))}" ${line}/>`
    else if (item.kind === 'ellipse')
      out = `<ellipse cx="${f((x1 + x2) / 2)}" cy="${f((y1 + y2) / 2)}" rx="${f(Math.abs(x2 - x1) / 2)}" ry="${f(Math.abs(y2 - y1) / 2)}" ${line}/>`
    else {
      const head = item.kind === 'arrow' ? arrowHeadPath(item) : ''
      out = `<path d="M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}${head}" ${line}/>`
    }
  } else {
    const lines = textLines(item)
      .map(
        (l, i) =>
          `<tspan x="${f(item.x)}" y="${f(item.y + baselineOf(item.size, i))}">${esc(l)}</tspan>`
      )
      .join('')
    out = `<text font-family="${esc(TEXT_FONT)}" font-size="${item.size}" fill="${color}" xml:space="preserve">${lines}</text>`
  }
  elementCache.set(item, out)
  return out
}

/** The JSON kept in the file, safe inside XML. */
const metadataJson = (data: DrawingData): string =>
  JSON.stringify({ v: 1, items: data.items }).replace(
    /[<>&]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
  )

/** The paper a drawing's picture shows: what is drawn, and a margin round it. */
export function paperOf(items: readonly DrawingItem[]): Rect {
  const b = contentBounds(items)
  if (!b) return BLANK
  const x = Math.floor(b.x - MARGIN)
  const y = Math.floor(b.y - MARGIN)
  return { x, y, w: Math.ceil(b.x + b.w + MARGIN) - x, h: Math.ceil(b.y + b.h + MARGIN) - y }
}

/** The file for a drawing. */
export function drawingSvg(data: DrawingData): string {
  const { x, y, w, h } = paperOf(data.items)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}" data-abele-drawing="1">`,
    `<metadata id="abele-drawing">${metadataJson(data)}</metadata>`,
    `<rect data-abele-paper="1" x="${x}" y="${y}" width="${w}" height="${h}" fill="${PAPER}"/>`,
    ...data.items.map(itemElement),
    '</svg>',
    '',
  ].join('\n')
}

/** A file with nothing drawn in it yet. */
export const emptyDrawingSvg = (): string => drawingSvg({ items: [] })

/** Whether a file's text is a drawing the plugin made; the root element is enough to tell. */
export function isDrawingSvg(text: string): boolean {
  const root = /<svg\b[^>]*>/.exec(text)
  return !!root && /\sdata-abele-drawing="/.test(root[0])
}

/** A drawing read back from its file; null for a file that is not one. */
export function parseDrawingSvg(text: string): DrawingData | null {
  if (!isDrawingSvg(text)) return null
  const m = /<metadata id="abele-drawing">([\s\S]*?)<\/metadata>/.exec(text)
  if (!m) return { items: [] }
  let raw: unknown
  try {
    raw = JSON.parse(m[1])
  } catch {
    return null
  }
  const list = (raw as { items?: unknown })?.items
  if (!Array.isArray(list)) return { items: [] }
  const seen = new Set<string>()
  const items: DrawingItem[] = []
  for (const one of list) {
    const item = itemFrom(one)
    if (!item) continue
    // Two items with one id, from a file put together by hand: the second gets its own.
    if (seen.has(item.id)) item.id = newId()
    seen.add(item.id)
    items.push(item)
  }
  return { items }
}
