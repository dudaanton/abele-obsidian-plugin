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

/** Lays the page out again each time its fonts finish loading, as long as it is open. */
export function relayoutOnFonts(doc: Document): void {
  const fonts = doc.fonts as FontFaceSet | undefined
  if (!fonts) return
  const again = () => {
    if (doc.defaultView) relayoutColumns(doc)
  }
  fonts.addEventListener?.('loadingdone', again)
  void fonts.ready?.then(again)
}
