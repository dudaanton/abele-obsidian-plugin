/**
 * Bringing the place a link points at into view, and keeping it there while the tab settles.
 *
 * One scroll at the right moment is not enough in a GitHub tab. The target may not exist yet —
 * the files load after the item, a long list draws a file's diff only when it opens, the tab may
 * still be hidden behind another. And once it is there, what is above it keeps changing height:
 * comments render their markdown and load their images after they are on screen, and every
 * CodeMirror editor above a diff line replaces its estimated line heights with measured ones as
 * it scrolls past. A line scrolled to once ends up somewhere below the fold.
 *
 * So the target is found as soon as it is laid out, placed near the top of the element that
 * actually scrolls, and placed again whenever it drifts — until the layout has been still for a
 * while, or the person scrolls, clicks or types in the tab themselves.
 */

/** Where the target's top is, in viewport pixels; null while it is not there or not laid out. */
export type Locate = () => number | null

export interface PinOptions {
  /** Pixels of what comes before the target left visible above it. */
  context?: number
  /** Give up when the target has not appeared in this long. */
  waitMs?: number
  /** Stop once the target has not moved for this long. */
  stillMs?: number
  /** And stop in any case this long after it was first placed. */
  settleMs?: number
}

const DEFAULTS: Required<PinOptions> = {
  context: 16,
  waitMs: 10_000,
  stillMs: 700,
  settleMs: 4_000,
}

/** The nearest ancestor that scrolls vertically: in a tab, its `.view-content`. */
export function scrollParent(el: Element): HTMLElement | null {
  const win = el.ownerDocument.defaultView ?? window
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    const overflow = win.getComputedStyle(cur).overflowY
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return cur
  }
  return null
}

/**
 * The next frame, or 50 ms, whichever comes first: a window behind others may never paint, and
 * `requestAnimationFrame` then never fires at all.
 */
function soon(win: Window, fn: () => void): () => void {
  let done = false
  const run = () => {
    if (done) return
    done = true
    win.cancelAnimationFrame(frame)
    win.clearTimeout(timer)
    fn()
  }
  const frame = win.requestAnimationFrame(run)
  const timer = win.setTimeout(run, 50)
  return () => {
    done = true
    win.cancelAnimationFrame(frame)
    win.clearTimeout(timer)
  }
}

/** Scrolls `container` so a point at viewport `top` sits `context` pixels below its top edge. */
export function placeAt(container: HTMLElement, top: number, context: number): void {
  const offset = top - container.getBoundingClientRect().top - context
  container.scrollTop = Math.max(0, container.scrollTop + offset)
}

/** For a line of code: a few lines above it stay in view, so it is read in its place. */
export const LINE_CONTEXT: PinOptions = { context: 96 }

const running = new WeakMap<Element, () => void>()

const INTERRUPTIONS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

/**
 * Scrolls the target `locate` finds into view inside the scrolling ancestor of `from`, and keeps
 * it there until the layout settles. A second call for the same tab replaces the first.
 *
 * @param from any element inside the tab: its scrolling ancestor is what gets scrolled
 * @returns a function that stops it early
 */
export function pinIntoView(from: Element, locate: Locate, options: PinOptions = {}): () => void {
  const o = { ...DEFAULTS, ...options }
  const win = from.ownerDocument.defaultView ?? window
  const container = scrollParent(from)
  if (!container) return () => {}

  running.get(container)?.()

  let cancelTick: () => void = () => {}
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    cancelTick()
    for (const type of INTERRUPTIONS) container.removeEventListener(type, stop, true)
    if (running.get(container) === stop) running.delete(container)
  }
  running.set(container, stop)
  for (const type of INTERRUPTIONS)
    container.addEventListener(type, stop, { capture: true, passive: true })

  const started = Date.now()
  let placedAt = 0
  let stillSince = 0

  const tick = () => {
    if (stopped) return
    const now = Date.now()
    if (placedAt ? now - placedAt >= o.settleMs : now - started >= o.waitMs) return stop()

    // A hidden tab has no height: wait until it is shown, then measure.
    const top = container.isConnected && container.clientHeight > 0 ? locate() : null
    if (top !== null) {
      const offset = top - container.getBoundingClientRect().top
      if (placedAt === 0 || Math.abs(offset - o.context) > 2) {
        const before = container.scrollTop
        placeAt(container, top, o.context)
        // At the end of the scroll range the target is as high as it gets: that is still too.
        if (placedAt === 0 || container.scrollTop !== before) stillSince = now
        if (placedAt === 0) placedAt = now
      }
      if (now - stillSince >= o.stillMs) return stop()
    }
    cancelTick = soon(win, tick)
  }

  tick()
  return stop
}

/** The top of an element, for `pinIntoView`; null while it is missing or not laid out. */
export const elementTop =
  (find: () => Element | null | undefined): Locate =>
  () => {
    const el = find()
    if (!el || !el.isConnected || el.getClientRects().length === 0) return null
    return el.getBoundingClientRect().top
  }
