/**
 * What keeps a surface that is drawn on to itself: every touch, click, long press, selection,
 * drag and Safari pinch that lands on it stops there, so neither the page under it nor Obsidian —
 * the swipe from an edge that opens a sidebar, the long press that opens a menu, a pull that opens
 * the command palette — hears of it. Touches are cancelled, not only stopped: the screen does not
 * scroll under the pen, and iOS neither shows its magnifier nor turns the writing into text.
 *
 * Pointer events are left alone: the surface's own handlers read them, and stop them themselves.
 * Used by the sheet over a PDF's pages (`inkOverlay.ts`) and by the drawing canvas.
 */
export function guardSurface(el: HTMLElement): () => void {
  const stop = (e: Event) => {
    e.stopPropagation()
    if (e.cancelable) e.preventDefault()
  }
  const off: (() => void)[] = []
  const on = (type: string, options: AddEventListenerOptions = {}) => {
    el.addEventListener(type, stop, options)
    off.push(() => el.removeEventListener(type, stop, options))
  }
  // Obsidian's own mark for a surface whose touches are not its swipes.
  el.setAttribute('data-ignore-swipe', 'true')
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
    on(type, { passive: false })
  for (const type of [
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'contextmenu',
    'selectstart',
    'dragstart',
    // Safari's own pinch.
    'gesturestart',
  ])
    on(type)
  return () => {
    for (const fn of off) fn()
  }
}
