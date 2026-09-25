/**
 * Pictures and tables on a book's page: shown as large as the page allows, and opened in a viewer
 * of their own where they can be zoomed and moved about.
 *
 * On a phone turned on its side the page is short and wide, and the engine keeps a picture
 * within the page's height — a scanned table, a page of its own in the book, came out a fifth of
 * the screen wide in its top left corner, unreadable, with no way to enlarge it. So a picture
 * that stands alone is centred on the page, a table wider than its column scrolls sideways in
 * place, and a tap on either opens it full screen. Icons and letters drawn as pictures are left
 * alone: they are smaller than `MIN_FIGURE_PX` both ways.
 *
 * Only styles are set on the page's elements, never an element added or moved: every place in
 * the book (an EPUB CFI) counts its way through those elements.
 */
import { cleanDocument, injectPolicy } from './bookSafety'

export type BookFigure =
  | { kind: 'image'; src: string; alt: string; width: number; height: number }
  | {
      kind: 'table'
      /** A whole page holding the table and the page's styles, for a frame that runs nothing. */
      html: string
      width: number
      height: number
    }

/** Smaller than this on the page both ways, a picture is an icon or a letter, not a figure. */
export const MIN_FIGURE_PX = 64

const XLINK = 'http://www.w3.org/1999/xlink'

/** The picture or table a tap on `target` is on, if it is on one worth opening. */
export function figureAt(target: Element | null): BookFigure | null {
  if (!target?.closest || target.closest('a[href]')) return null
  const img = target.closest('img')
  if (img) {
    const r = img.getBoundingClientRect()
    if (r.width < MIN_FIGURE_PX && r.height < MIN_FIGURE_PX) return null
    const src = img.currentSrc || img.src
    if (!src) return null
    return {
      kind: 'image',
      src,
      alt: img.alt ?? '',
      width: img.naturalWidth || r.width,
      height: img.naturalHeight || r.height,
    }
  }
  // A picture drawn inside an SVG, the way many books put their cover and full-page plates.
  const svg = target.closest('svg')
  const image = svg?.querySelector('image')
  if (svg && image) {
    const r = svg.getBoundingClientRect()
    if (r.width < MIN_FIGURE_PX && r.height < MIN_FIGURE_PX) return null
    const src = image.getAttribute('href') ?? image.getAttributeNS(XLINK, 'href') ?? ''
    if (!src) return null
    const w = Number(image.getAttribute('width')) || r.width
    const h = Number(image.getAttribute('height')) || r.height
    return { kind: 'image', src, alt: svg.getAttribute('aria-label') ?? '', width: w, height: h }
  }
  const table = target.closest('table')
  if (table) {
    return {
      kind: 'table',
      html: tablePage(table),
      width: Math.max(table.scrollWidth, table.getBoundingClientRect().width),
      height: Math.max(table.scrollHeight, table.getBoundingClientRect().height),
    }
  }
  return null
}

/**
 * The table on a page of its own, with the book's styles and the same policy as every page: no
 * script, nothing from outside the book. It is shown in a frame that runs nothing either.
 */
export function tablePage(table: HTMLTableElement): string {
  const doc = table.ownerDocument
  const styles = Array.from(doc.head?.querySelectorAll('style, link[rel~="stylesheet"]') ?? [])
    .filter((el) => el.localName === 'style' || /^(blob|data):/.test(el.getAttribute('href') ?? ''))
    .map((el) => el.outerHTML)
    .join('\n')
  const source = `<!DOCTYPE html><html><head>${styles}<style>html, body { margin: 0; padding: 8px; background: Canvas; color: CanvasText; overflow: hidden; } table { margin: 0 !important; }</style></head><body>${table.outerHTML}</body></html>`
  // Cleaned again, though the page it came from already was, and given the book's policy.
  const page = new DOMParser().parseFromString(source, 'text/html')
  cleanDocument(page)
  injectPolicy(page)
  return `<!DOCTYPE html>${page.documentElement.outerHTML}`
}

/**
 * Pictures that stand alone centred, and tables wider than their column scrolling sideways in
 * it. Run on every page as it arrives and again when it is laid out anew — a turned phone.
 */
export function fitFigures(doc: Document): void {
  const body = doc.body
  if (!body) return
  const width = doc.documentElement.clientWidth
  for (const img of Array.from(body.querySelectorAll('img'))) {
    const parent = img.parentElement
    if (!parent) continue
    const r = img.getBoundingClientRect()
    if (r.width < MIN_FIGURE_PX && r.height < MIN_FIGURE_PX) continue
    // Alone in its block: no words beside it.
    const words = Array.from(parent.childNodes).some(
      (n) => n.nodeType === 3 && (n.nodeValue ?? '').trim()
    )
    if (words) continue
    styleOn(img, { display: 'block', 'margin-inline': 'auto' })
  }
  for (const table of Array.from(body.querySelectorAll('table'))) {
    const room = table.parentElement?.clientWidth ?? width
    if (table.scrollWidth <= room + 1) continue
    styleOn(table, { display: 'block', 'max-width': '100%', 'overflow-x': 'auto' })
  }
}

/**
 * Styles on an element of a book's page. Inline, because the page is the book's document — the
 * plugin's stylesheet does not reach it — and its elements belong to the page's frame, which
 * Obsidian's `setCssProps` is not installed in.
 */
function styleOn(el: HTMLElement, styles: Record<string, string>): void {
  for (const [name, value] of Object.entries(styles)) el.style.setProperty(name, value)
}
