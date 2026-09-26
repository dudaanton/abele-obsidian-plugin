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

/**
 * Lays the page out again each time its fonts finish loading, as long as it is open, and then
 * has what is drawn over its words drawn again.
 */
export function relayoutOnFonts(doc: Document, redraw?: () => void): void {
  const fonts = doc.fonts as FontFaceSet | undefined
  if (!fonts) return
  const again = () => {
    if (!doc.defaultView) return
    relayoutColumns(doc)
    redraw?.()
  }
  fonts.addEventListener?.('loadingdone', again)
  void fonts.ready?.then(again)
}

interface WithOverlays {
  getContents?(): { doc?: Document; overlayer?: { redraw(): void } }[]
}

/** What the engine draws over a page's words — highlights and the like — drawn again. */
export function redrawOver(renderer: unknown, doc: Document): void {
  for (const c of (renderer as WithOverlays | undefined)?.getContents?.() ?? [])
    if (c.doc === doc) c.overlayer?.redraw()
}
