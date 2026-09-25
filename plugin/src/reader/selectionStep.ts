/**
 * How far the page moves under a selection carried on — part of a page, not a whole one, so the
 * words just selected stay on screen beside the ones coming (1.42, from the phone) — and where it
 * comes to rest once the selection is let go.
 *
 * - **Scrolled**, the chapter moves by `STEP` of the screen's height.
 * - **Pages of two columns** move by whole columns, as many as make `STEP` of the page: one of
 *   two. The spread shown is then the second column of one page beside the first of the next,
 *   every line whole.
 * - **Pages of one column** — a phone — cannot move by part of a page: part of one shows the ends
 *   of its lines beside the starts of the next page's, every line cut. So while the selection is
 *   carried on the chapter is scrolled, in the page's own box and at its width (the engine's
 *   `setFlow` with `keep`), which moves no line of the text, and moves by `STEP` of it.
 *
 * Once the selection is let go, pages come back — the one holding the selection's end — rather
 * than as soon as its bar shows: that would move the words just as they are about to be used.
 */

/** The share of the page the view moves by under a selection carried on. */
export const STEP = 0.5

/** The engine's page element, as far as moving it under a selection goes. */
export interface StepRenderer extends EventTarget {
  page?: number
  pages?: number
  scrolled?: boolean
  start?: number
  end?: number
  size?: number
  viewSize?: number
  columns?: number
  next?: (distance?: number) => Promise<unknown>
  prev?: (distance?: number) => Promise<unknown>
  stepBy?: (distance: number) => Promise<unknown>
  showAnchor?: (anchor: Range) => Promise<unknown>
  setFlow?: (flow: 'paginated' | 'scrolled', anchor?: Range, keep?: boolean) => void
  hasAttribute?: (name: string) => boolean
}

export class SelectionStep {
  /** Scrolled only while the selection is carried on; pages come back once it is let go. */
  private scrolling = false

  constructor(private readonly renderer: () => StepRenderer | null) {}

  /** Scrolled for now, in place of the pages the reader is set to. */
  get temporary(): boolean {
    const r = this.renderer()
    return this.scrolling && !!r?.scrolled && !!r.hasAttribute?.('data-keep')
  }

  /** Whether the view can move no further that way within its chapter. */
  atEdge(dir: 1 | -1): boolean {
    const r = this.renderer()
    if (!r) return true
    if (r.scrolled) {
      return dir > 0 ? (r.viewSize ?? 0) - (r.end ?? 0) <= 2 : (r.start ?? 0) <= 0
    }
    // The first and last of `pages` are the engine's way into the chapters either side.
    const size = r.size ?? 0
    const start = r.start ?? 0
    const last = ((r.pages ?? 0) - 2) * size
    return dir > 0 ? start >= last - 2 : start <= size + 2
  }

  /**
   * Moves the view by part of a page. `from` is the first word on screen: where the scroll a page
   * of one column goes over to begins, so nothing on screen moves until the step itself.
   */
  async step(dir: 1 | -1, from: Range | null): Promise<boolean> {
    const r = this.renderer()
    if (!r) return false
    if (!r.scrolled && (r.columns ?? 1) < 2 && r.setFlow) {
      await this.scroll(r, from)
      if (!r.scrolled) return false
    }
    if (r.scrolled) {
      const distance = (r.size ?? 0) * STEP
      await (dir > 0 ? r.next?.(distance) : r.prev?.(distance))
      return true
    }
    const columns = r.columns ?? 1
    const width = (r.size ?? 0) / columns
    const distance = Math.max(1, Math.round(columns * STEP)) * width
    await r.stepBy?.(dir * distance)
    return true
  }

  /**
   * The selection let go: pages again, if they were left for a scroll, or put back on a page's
   * edge if they were moved by a column — the page with `end` on it, where the selection ended.
   */
  async settle(end: Range | null): Promise<void> {
    const r = this.renderer()
    if (!r) return
    if (this.scrolling) {
      this.scrolling = false
      // Taken back to pages meanwhile — the settings changed, say — it is already done.
      if (r.scrolled && r.hasAttribute?.('data-keep')) {
        await this.relocated(r, () => r.setFlow?.('paginated', end ?? undefined, false))
      }
      return
    }
    if (r.scrolled || !end) return
    const size = r.size ?? 0
    const start = r.start ?? 0
    if (size && Math.abs(start / size - Math.round(start / size)) > 0.01) await r.showAnchor?.(end)
  }

  private async scroll(r: StepRenderer, from: Range | null): Promise<void> {
    this.scrolling = true
    await this.relocated(r, () => r.setFlow?.('scrolled', from ?? undefined, true))
  }

  /** Does something to the engine and waits until it says where it is, or a moment at most. */
  private relocated(r: StepRenderer, act: () => void): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer = 0
      const done = () => {
        r.removeEventListener('relocate', done)
        window.clearTimeout(timer)
        resolve()
      }
      r.addEventListener('relocate', done)
      timer = window.setTimeout(done, 800)
      act()
    })
  }
}
