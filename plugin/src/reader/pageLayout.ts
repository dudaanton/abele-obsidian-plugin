/**
 * A page laid out anew once its fonts have arrived.
 *
 * Seen once on a desktop in two columns (2026-09-25): paragraphs drawn over each other, each given
 * less room than its lines take, until something later laid the page out again. It could not be
 * made to happen here. The likeliest moment is a font face arriving after the columns were laid
 * out — an italic or bold face is fetched only when a page first uses it — and Chromium keeping
 * some of the heights it measured with the stand-in font. The engine only re-measures the
 * chapter's length then (`fonts.ready` → `expand`), it does not lay the columns out again.
 *
 * So whenever the page's fonts finish loading, the columns are laid out again from scratch: their
 * width is nudged by a pixel and put back within one task. Nothing is painted in between, and a
 * layout that was right stays exactly as it was, so nothing on screen moves; a layout that was
 * wrong is replaced by a fresh one (and the engine, told the chapter's size changed, keeps its
 * place).
 *
 * What is drawn over the words — highlights, the sentence read aloud, search hits — is drawn again
 * then too. The engine measures it once, and again only when the page changes size. A font that
 * arrives after the highlights were measured, with every line kept at its height by the line
 * spacing, moves the words without changing the page's size: the highlights stayed where the
 * stand-in font had put the words, a little lower and ending on other letters (seen on a desktop,
 * 2026-09-26).
 */

/** Lays the columns of a paginated page out again; a scrolled or fixed page is left alone. */
export function relayoutColumns(doc: Document): boolean {
  const root = doc.documentElement
  if (!root) return false
  const width = root.style.getPropertyValue('column-width')
  const px = parseFloat(width)
  if (!Number.isFinite(px) || px <= 0) return false
  const priority = root.style.getPropertyPriority('column-width')
  root.style.setProperty('column-width', `${px + 1}px`, priority)
  void root.offsetHeight
  root.style.setProperty('column-width', width, priority)
  void root.offsetHeight
  return true
}

/** Marks the passing style `relayoutText` puts in, so what watches the page's styles ignores it. */
const RELAYOUT_MARK = 'data-abele-relayout'

/** Whether a change of the page's head was only `relayoutText` passing through. */
const onlyRelayout = (records: MutationRecord[]): boolean =>
  records.every(
    (r) =>
      r.type === 'childList' &&
      [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)].every(
        (n) => (n as Element).hasAttribute?.(RELAYOUT_MARK) ?? false
      )
  )

/**
 * The passing font property `relayoutText` sets on all the text: one no book sets, part of what
 * WebKit keys a font by, that changes nothing in Latin or Cyrillic text.
 */
const PASSING_FONT = 'font-variant-east-asian: jis78 !important;'

/**
 * Sets every line of the page anew, with the text's font made anew: a font property given to all
 * of it and taken back within one task, laid out each time, so nothing is painted in between and
 * a page that was right stays as it was.
 *
 * iOS WebKit (iOS 26) draws a justified line in a monospace font stretched across the
 * column, and hit-tests it that way, but on a paragraph's first layout answers where its words
 * are — `Range.getClientRects`, the selection it paints, the highlights measured from it — as if
 * the line were not stretched. A word long-pressed was selected with its selection painted over
 * the words to its left, and highlights sat a few letters off, until the reader's font was
 * switched and back. What puts it right is a change to any font property of the text, and it
 * stays right after; realigning the lines, resizing the column or changing the text does not.
 */
export function relayoutText(doc: Document): void {
  const head = doc.head
  if (!head) return
  const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style')
  style.setAttribute(RELAYOUT_MARK, '')
  style.textContent = `html, body, body * { ${PASSING_FONT} }`
  head.append(style)
  void doc.documentElement.offsetHeight
  style.remove()
  void doc.documentElement.offsetHeight
}

/**
 * Lays the page out again each time its fonts finish loading, as long as it is open, and then
 * has what is drawn over its words drawn again.
 */
export function relayoutOnFonts(doc: Document, redraw?: () => void): void {
  const fonts = doc.fonts as FontFaceSet | undefined
  if (!fonts) return
  const again = () => {
    if (!doc.defaultView) return
    relayoutText(doc)
    relayoutColumns(doc)
    redraw?.()
  }
  fonts.addEventListener?.('loadingdone', again)
  void fonts.ready?.then(again)
}

/**
 * Lays the page out again each time a picture on it has loaded (or failed to), and then has what
 * is drawn over its words drawn again. A picture that arrives after the columns were laid out
 * grows in place while what follows it can stay where the empty picture left room for it: a
 * table drawn as a picture lying over the paragraphs after it, until the window was resized (a
 * book on the desktop, 2026-09-27).
 */
export function relayoutOnPictures(doc: Document, redraw?: () => void): void {
  const again = (e: Event) => {
    if (!doc.defaultView) return
    const target = e.target as Element | null
    if (target?.localName !== 'img' && target?.localName !== 'image') return
    relayoutColumns(doc)
    redraw?.()
  }
  // Neither event bubbles: heard on the way down.
  doc.addEventListener('load', again, true)
  doc.addEventListener('error', again, true)
}

interface WithOverlays {
  getContents?(): { doc?: Document; overlayer?: { redraw(): void; element?: Element } }[]
}

/** Where the boxes drawn over a page are: every corner of every rect, in drawing order. */
function boxesOf(el: Element | undefined): number[] {
  const out: number[] = []
  for (const r of Array.from(el?.querySelectorAll('rect') ?? []))
    out.push(Number(r.getAttribute('x')), Number(r.getAttribute('y')))
  return out
}

/**
 * What the engine draws over a page's words — highlights and the like — drawn again. Returns how
 * far the boxes moved, the largest shift of any one; boxes that moved are said in the console, so
 * a book where highlights drift shows what moved them.
 */
export function redrawOver(renderer: unknown, doc: Document, why = 'redraw'): number {
  let moved = 0
  for (const c of (renderer as WithOverlays | undefined)?.getContents?.() ?? []) {
    if (c.doc !== doc || !c.overlayer) continue
    const before = boxesOf(c.overlayer.element)
    c.overlayer.redraw()
    const after = boxesOf(c.overlayer.element)
    const n = Math.min(before.length, after.length)
    for (let i = 0; i < n; i++) moved = Math.max(moved, Math.abs(after[i] - before[i]))
  }
  if (moved > 0.5) console.debug(`[Abele] book marks moved with their words (${why})`, moved)
  return moved
}

/** The blocks of a page whose size moves the words after them. */
const BLOCKS =
  'p, li, dd, dt, blockquote, pre, table, figure, img, svg, video, h1, h2, h3, h4, h5, h6, header, aside, hr'

/**
 * When, after a page arrives or its styles change, its text is set anew (`relayoutText`), it is
 * laid out again (`relayoutColumns`) and what is drawn over its words measured again. On an
 * iPhone with a monospace text font, WebKit answered where the words of a justified line are as
 * if the line were not stretched, while it drew and hit-tested them stretched: highlights a few
 * letters off, and a word long-pressed selected with its selection over its neighbours, right
 * again after the font was changed and back. Nothing announces it, and the words'
 * own measure is as wrong as the highlight's. Making the text's font anew puts it right; a
 * layout that was right does not move.
 */
export const FONT_CHECKS_MS = [250, 700, 1500, 3000, 6000, 12000]

/**
 * What is drawn over a page's words kept on them. The engine measures its highlights once, and
 * again only when the chapter's size changes — a page more or less. Words move without that: a
 * picture, a font or a style arriving above them in the same column pushes them down by lines and
 * the chapter keeps its page count (seen on a desktop, 2026-09-26: highlights in a book's notes
 * one and two page margins above their words). So they are measured again whenever a block of the
 * page changes size, and whenever the view comes to rest on a new place — at most once a frame.
 */
export function keepMarksOnText(doc: Document, renderer: () => unknown): void {
  const win = doc.defaultView
  if (!win) return
  let queued = ''
  const again = (why: string) => {
    if (queued) return
    queued = why
    window.requestAnimationFrame(() => {
      const reason = queued
      queued = ''
      if (doc.defaultView) redrawOver(renderer(), doc, reason)
    })
  }
  // The first report is every block's size as it is: nothing has moved yet.
  let first = true
  const observer = new ResizeObserver(() => {
    if (first) first = false
    else again('a block changed size')
  })
  for (const el of Array.from(doc.body?.querySelectorAll(BLOCKS) ?? [])) observer.observe(el)
  const target = renderer() as EventTarget | undefined
  const settled = () => {
    if (!doc.defaultView) {
      observer.disconnect()
      target?.removeEventListener?.('relocate', settled)
      return
    }
    again('the view came to rest')
  }
  target?.addEventListener?.('relocate', settled)
  // A layout made before the font was in place, unannounced (`FONT_CHECKS_MS`): the page laid
  // out again a few times after it came and after each change of its styles.
  let timers: number[] = []
  const checkFont = () => {
    for (const t of timers) window.clearTimeout(t)
    timers = FONT_CHECKS_MS.map((ms) =>
      window.setTimeout(() => {
        if (!doc.defaultView) return
        relayoutText(doc)
        relayoutColumns(doc)
        again('the page was laid out again')
      }, ms)
    )
  }
  checkFont()
  // The page's styles changed — the reader's settings, the book's own turned on or off: the words
  // can move sideways with every line keeping its height (a font as wide as another, a justified
  // line), which no size says. Measured again once the change is laid out.
  const styles = new MutationObserver((records) => {
    if (onlyRelayout(records)) return
    again('the page style changed')
    checkFont()
  })
  if (doc.head)
    styles.observe(doc.head, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    })
  win.addEventListener(
    'pagehide',
    () => {
      observer.disconnect()
      styles.disconnect()
      for (const t of timers) window.clearTimeout(t)
    },
    { once: true }
  )
}
