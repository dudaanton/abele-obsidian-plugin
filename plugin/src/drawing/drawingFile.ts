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
import { compactPath } from './compactPath'

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

/**
 * The outline a stroke read from a file was written with — the painter's to reuse, so a drawing
 * of thousands of strokes opens without working every outline out again.
 */
export const writtenPaths = new WeakMap<DrawingItem, string>()

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
    out = `<path d="${compactPath(strokePath(item))}" ${paint}/>`
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
const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * A stroke's points as the file keeps them: the first `x, y, pressure` as they are, every one
 * after it as the step from the one before, pressure in hundredths — about half the size.
 */
export function packPoints(points: readonly number[]): number[] {
  const out: number[] = []
  let x = 0
  let y = 0
  let p = 0
  for (let i = 0; i + 2 < points.length; i += 3) {
    const nx = r1(points[i])
    const ny = r1(points[i + 1])
    const np = Math.round(points[i + 2] * 100)
    if (i === 0) out.push(nx, ny, np)
    else out.push(r1(nx - x), r1(ny - y), np - p)
    x = nx
    y = ny
    p = np
  }
  return out
}

/** A stroke's points back from how the file keeps them; null for anything that is not that. */
export function unpackPoints(packed: unknown): number[] | null {
  if (!Array.isArray(packed) || packed.length < 3 || packed.length % 3) return null
  if (!packed.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  const nums = packed as number[]
  const out: number[] = []
  let x = 0
  let y = 0
  let p = 0
  for (let i = 0; i < nums.length; i += 3) {
    x = i ? r1(x + nums[i]) : nums[i]
    y = i ? r1(y + nums[i + 1]) : nums[i + 1]
    p = i ? p + nums[i + 2] : nums[i + 2]
    out.push(x, y, Math.min(1, Math.max(0, p / 100)))
  }
  return out
}

/** Items as the file keeps them: a stroke's points packed as `d`. */
const packed = (items: readonly DrawingItem[]) =>
  items.map((item) => {
    if (item.type !== 'stroke') return item
    const { points, ...rest } = item
    return { ...rest, d: packPoints(points) }
  })

const metadataJson = (data: DrawingData): string =>
  JSON.stringify({ v: 1, items: packed(data.items) }).replace(
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
    // A stroke keeps its points packed (`packPoints`); one written out whole is read as well.
    const raw = one as { type?: unknown; d?: unknown; points?: unknown } | null
    const pts = raw?.type === 'stroke' && raw.d !== undefined ? unpackPoints(raw.d) : undefined
    const item = itemFrom(pts ? { ...raw, points: pts } : one)
    if (!item) continue
    // Two items with one id, from a file put together by hand: the second gets its own.
    if (seen.has(item.id)) item.id = newId()
    seen.add(item.id)
    items.push(item)
  }
  if (items.length === list.length) remember(text, m.index + m[0].length, items)
  return { items }
}

/**
 * The markup the file already holds for each item — one line each, in the items' order, after the
 * paper — kept for writing the file again and for painting, when there is exactly one line per
 * item. The picture's markup is never put into a page: it goes back into the file as it came, and
 * only its outline is handed to a canvas, which draws a path and nothing else.
 */
function remember(text: string, from: number, items: DrawingItem[]): void {
  const lines = text.slice(from).split('\n')
  const start = lines.findIndex((l) => l.startsWith('<rect data-abele-paper='))
  if (start < 0) return
  const body = lines.slice(start + 1)
  const end = body.findIndex((l) => l.startsWith('</svg>'))
  if (end !== items.length) return
  items.forEach((item, i) => {
    const line = body[i]
    if (!line.startsWith('<') || !line.endsWith('>')) return
    const d = item.type === 'stroke' ? /^<path d="([^"]*)"/.exec(line)?.[1] : undefined
    // A pen's outline as pens drew it at first, round both sides in curves, left gaps where
    // the line turned: drawn again from the points, and written again with the next change.
    if (item.type === 'stroke' && item.tool === 'pen' && d?.includes('q')) return
    elementCache.set(item, line)
    if (d && /^[Mmlqaz\d\s.,-]*$/.test(d)) writtenPaths.set(item, d)
  })
}
