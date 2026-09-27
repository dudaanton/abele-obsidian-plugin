/**
 * A book's own stylesheets, made safe to show.
 *
 * A page of a book links its stylesheets; the engine turns each into a `blob:` URL. Obsidian's
 * own Content Security Policy — which the page frame inherits, as a `blob:` document — refuses
 * stylesheets linked from `blob:`, so until 2026-09-27 no book's linked styles showed at all. Each
 * linked stylesheet is instead put into the page as a `<style>` of its own, once it is cleaned:
 *
 * - **Nothing outside the book is fetched.** `url()` keeps only what the engine already rewrote
 *   into the book's own files (`blob:`), pictures and fonts carried as `data:`, and `#fragment`
 *   references; anything else — `http(s):`, `file:`, `app:`, any other `data:` — becomes `none`.
 *   `@import` is followed only to another stylesheet of the book, whose text takes its place;
 *   any other is dropped. `image-set()` and `src()`, which fetch from a bare string, are dropped
 *   with their declaration. (The page's own policy blocks the network as well; this is the second
 *   layer.)
 * - **Nothing that ever ran code survives:** `expression()`, `behavior`, `-moz-binding`,
 *   `javascript:` and `vbscript:` take their declaration with them.
 * - **The reader's own choices win.** `!important` is taken out of the book's rules, so the
 *   reader's size, spacing, font and theme colours — set `!important` after the book — and the
 *   engine's column layout — set on the page's root and body themselves — always win. A text size
 *   in `px` or `pt` is made `rem`, so it follows the reader's text size. What the
 *   book says about everything else (tables, indents, alignment, drop caps, pictures) applies.
 *
 * The result is checked once more with CSS escapes decoded, where `u\72l(` reads as `url(`; a
 * stylesheet that still names anything outside the book there is dropped whole.
 *
 * The page's own `<style>` elements go through the same cleaning. Every book stylesheet is marked
 * (`BOOK_STYLE_MARK`) so the reader can turn them off (`showBookStyles`).
 */

const XHTML = 'http://www.w3.org/1999/xhtml'

/** Marks a stylesheet that is the book's own. */
export const BOOK_STYLE_MARK = 'data-abele-book-style'

/** How deep `@import` is followed inside the book. */
const IMPORT_DEPTH = 4

/** A URL a book's stylesheet may use: its own files, pictures and fonts inline, fragments. */
const SAFE_URL =
  /^(blob:|#|data:(image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)|font\/|application\/(font|x-font|vnd\.ms-opentype|x-font-ttf|x-font-otf))[;,])/i

const URL_TOKEN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi
const IMPORT_RULE = /@import\b[^;{}]*;?/gi
/** Functions that fetch from a bare string, and things that once ran code: their declaration goes. */
const DECLARATION_OF =
  /[^;{}]*(?:(?:-webkit-)?image-set\s*\(|(?:^|[^\w-])src\s*\(|expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:|vbscript\s*:)[^;{}]*;?/gi
/** Found in a stylesheet after cleaning, with escapes decoded: it is dropped whole. */
const FORBIDDEN =
  /@import|(?:-webkit-)?image-set\s*\(|(?:^|[^\w-])src\s*\(|expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:|vbscript\s*:/i

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '')

/** CSS escapes read as what they stand for: what the browser sees. */
function decodeEscapes(css: string): string {
  return css
    .replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?/gi, (_, hex: string) => {
      const code = parseInt(hex, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�'
    })
    .replace(/\\\r?\n/g, '')
    .replace(/\\(.)/g, '$1')
}

/** Every `url()` in the text points somewhere a book may. */
function urlsSafe(css: string): boolean {
  const opens = (css.match(/url\s*\(/gi) ?? []).length
  let matched = 0
  for (const m of css.matchAll(URL_TOKEN)) {
    matched++
    const target = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (target && !SAFE_URL.test(target)) return false
  }
  // A `url(` the pattern could not read (odd quoting) counts as unsafe.
  return matched === opens
}

/** A book's stylesheet made safe to show: see the file comment. Empty when it cannot be. */
export function sanitizeBookCss(source: string): string {
  let css = stripComments(source)
  css = css.replace(IMPORT_RULE, '')
  css = css.replace(URL_TOKEN, (whole, dq?: string, sq?: string, bare?: string) => {
    const target = (dq ?? sq ?? bare ?? '').trim()
    return !target || SAFE_URL.test(target) ? whole : 'none'
  })
  css = css.replace(DECLARATION_OF, '')
  css = css.replace(/!\s*important/gi, '')
  // A size in pixels or points would stay put when the reader's text size changes: made relative
  // to the root, which the reader sets, it grows and shrinks with the rest.
  css = css.replace(
    /(font-size\s*:\s*)(\d*\.?\d+)(px|pt)\b/gi,
    (_, head: string, n: string, unit: string) =>
      `${head}${+(parseFloat(n) / (unit.toLowerCase() === 'pt' ? 12 : 16)).toFixed(4)}rem`
  )
  const seen = decodeEscapes(css)
  if (FORBIDDEN.test(seen) || !urlsSafe(seen) || /!\s*important/i.test(seen)) return ''
  return css
}

/** Reads one of the book's stylesheets by the `blob:` URL the engine gave it; null if it is not one. */
export type CssLoader = (href: string) => Promise<string | null>

/** The book's stylesheet behind a `blob:` URL; null for anything else. */
export const loadBookCss: CssLoader = async (href) => {
  if (!/^blob:/i.test(href)) return null
  try {
    const response = await window.fetch(href)
    const type = response.headers.get('content-type') ?? ''
    return /\bcss\b/i.test(type) ? await response.text() : null
  } catch {
    return null
  }
}

/** A stylesheet with the book's own `@import`s put in place, as deep as `IMPORT_DEPTH`. */
async function withImports(css: string, load: CssLoader, depth: number): Promise<string> {
  const pattern = /@import\s+(?:url\(\s*)?["']?(blob:[^"')\s;]+)["']?\s*\)?[^;{}]*;?/gi
  const found = [...css.matchAll(pattern)]
  if (!found.length || depth <= 0) return css
  let out = ''
  let last = 0
  for (const m of found) {
    const text = await load(m[1])
    out += css.slice(last, m.index) + (text ? await withImports(text, load, depth - 1) : '')
    last = (m.index ?? 0) + m[0].length
  }
  return out + css.slice(last)
}

const isStylesheetLink = (el: Element): boolean =>
  el.localName === 'link' &&
  (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')

/**
 * Puts a page's linked stylesheets into it as `<style>` elements, cleaned, and cleans its own
 * `<style>` elements; each is marked as the book's. One element takes the place of another, so
 * the element positions EPUB CFIs count do not move. A link to anything but the book's own
 * stylesheet is left as it is: the page's policy refuses it.
 */
export async function inlineBookStyles(
  doc: Document,
  load: CssLoader = loadBookCss
): Promise<void> {
  for (const style of Array.from(doc.getElementsByTagName('style'))) {
    style.textContent = sanitizeBookCss(style.textContent ?? '')
    style.setAttribute(BOOK_STYLE_MARK, '')
  }
  for (const link of Array.from(doc.getElementsByTagName('link'))) {
    if (!isStylesheetLink(link)) continue
    const text = await load(link.getAttribute('href') ?? '')
    if (text === null) continue
    const style = doc.createElementNS(link.namespaceURI ?? XHTML, 'style')
    style.setAttribute(BOOK_STYLE_MARK, '')
    const media = link.getAttribute('media')
    if (media && /^[\w\s(),:.-]*$/.test(media)) style.setAttribute('media', media)
    style.textContent = sanitizeBookCss(await withImports(text, load, IMPORT_DEPTH))
    link.replaceWith(style)
  }
}

/** Shows or hides the book's own stylesheets on a page that is open. */
export function showBookStyles(doc: Document, on: boolean): void {
  for (const style of Array.from(doc.querySelectorAll(`style[${BOOK_STYLE_MARK}]`))) {
    const sheet = (style as HTMLStyleElement).sheet
    if (sheet && sheet.disabled !== !on) {
      sheet.disabled = !on
      // Said on the element, so what watches the page's styles hears it.
      style.toggleAttribute('data-abele-off', !on)
    }
  }
}
