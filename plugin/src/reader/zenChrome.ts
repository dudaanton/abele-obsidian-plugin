/**
 * One book tab in zen mode (`zen.ts`): the classes its leaf carries, the peek at the chrome, and
 * — on a phone — Obsidian's own way of hiding its navigation, the same one it uses when a note is
 * scrolled down (`app.mobileNavbar.hideNavigation`): the header slides up, the bar under the tabs
 * slides down, and the phone's status bar goes with them.
 *
 * Obsidian brings its navigation back by itself on any press in the app's window and when another
 * tab comes to the front; while this tab is in front in zen mode, it is hidden again.
 */
import { watch, type WatchStopHandle } from 'vue'
import type { BookModel } from './model'
import {
  type Band,
  PEEK_LEAVE_MS,
  PEEK_MS,
  ZEN_CLASS,
  ZEN_PEEK_CLASS,
  followZen,
  navHidden,
  zen,
  zenFootAtTop,
} from './zen'

/** Obsidian's phone navigation, which it does not publish in its API. */
export interface MobileNavbar {
  hideNavigation(): void
  restoreNavigation(animate?: boolean): void
}

export interface ZenHost {
  /** The tab's leaf element: the header is its child. */
  containerEl: HTMLElement
  model: BookModel
  /** Obsidian's phone navigation, where there is one. */
  navbar(): MobileNavbar | null | undefined
  phone: boolean
  /** A touch screen: a tap in the middle of the page shows the chrome. */
  touch: boolean
  /** This tab is the one in front. */
  front(): boolean
  /** Moves without animation: e-ink mode. */
  still(): boolean
  /** The lines of the words selected, or of the highlight tapped, in the window. */
  words(): Band[]
}

const HIDDEN_NAV = 'is-hidden-nav'

export class ZenChrome {
  private stops: (WatchStopHandle | (() => void))[] = []
  private timer = 0
  private observer: MutationObserver | null = null
  /** This tab hid Obsidian's navigation, and gives it back when it no longer should. */
  private hid = false
  private edge: HTMLElement | null = null

  constructor(private host: ZenHost) {
    const el = host.containerEl
    el.classList.toggle(ZEN_CLASS, zen().on)
    this.stops.push(
      followZen((on) => {
        el.classList.toggle(ZEN_CLASS, on)
        this.peek(false)
        this.syncNav()
      })
    )
    this.stops.push(
      watch(
        () => host.model.zenPeek,
        (peek) => {
          el.classList.toggle(ZEN_PEEK_CLASS, peek)
          this.syncNav()
        }
      )
    )
    // The bar for words goes where it covers none of them, measured once it shows — and again
    // when the page turns under a selection.
    const m = host.model
    this.stops.push(
      watch(
        () => [m.selection, m.active, m.selecting, m.fraction, m.zenPeek, zen().on] as const,
        () => this.placeFoot(),
        { flush: 'post' }
      )
    )
    const body = el.ownerDocument.body
    if (host.phone && host.navbar()) {
      this.observer = new MutationObserver(() => this.syncNav())
      this.observer.observe(body, { attributes: true, attributeFilter: ['class'] })
    }
    if (!host.touch) this.watchMouse()
    this.syncNav()
  }

  /** The window the tab lives in, a pop-out's own. */
  private get win(): Window {
    return this.host.containerEl.ownerDocument.defaultView ?? window
  }

  /** The tab came to the front or went behind. */
  frontChanged(): void {
    if (!this.host.front()) this.peek(false)
    this.syncNav()
  }

  /** A tap in the middle of the page: the chrome shown for a moment, or put away again. */
  middleTap(): void {
    if (!zen().on || !this.host.touch) return
    this.peek(!this.host.model.zenPeek)
  }

  /** The bar for words at the top of the page when at its foot it would cover them. */
  private placeFoot(): void {
    const m = this.host.model
    const el = this.host.containerEl
    const foot = el.querySelector('.abele-book-reader__foot')
    const stage = el.querySelector('.abele-book-reader__stage')
    const top =
      zen().on &&
      !!(m.selection || m.active) &&
      !m.selecting &&
      !!foot &&
      !!stage &&
      zenFootAtTop(
        this.host.words(),
        stage.getBoundingClientRect(),
        foot.getBoundingClientRect().height
      )
    if (m.zenFootTop !== top) m.zenFootTop = top
  }

  /** Shows the chrome for a moment, or hides it again. */
  peek(on: boolean, ms = PEEK_MS): void {
    const win = this.win
    win.clearTimeout(this.timer)
    this.timer = 0
    if (on && !zen().on) on = false
    this.host.model.zenPeek = on
    if (on && ms > 0) this.timer = win.setTimeout(() => this.expire(), ms)
  }

  /** The peek runs out — later, while a menu or a dialog opened from the chrome is still up. */
  private expire(): void {
    const doc = this.host.containerEl.ownerDocument
    if (doc.querySelector('.menu, .modal-container')) {
      this.timer = this.win.setTimeout(() => this.expire(), 1000)
      return
    }
    this.peek(false)
  }

  /** Obsidian's navigation on a phone hidden or given back, as the mode, the tab and a peek say. */
  private syncNav(): void {
    const navbar = this.host.navbar()
    if (!navbar || !this.host.phone) return
    const hide = navHidden({
      on: zen().on,
      front: this.host.front(),
      phone: this.host.phone,
      peek: this.host.model.zenPeek,
    })
    const body = this.host.containerEl.ownerDocument.body
    const hidden = body.classList.contains(HIDDEN_NAV)
    if (hide && !hidden) {
      navbar.hideNavigation()
      this.hid = true
    } else if (!hide && hidden && this.hid) {
      // Another book tab in zen coming to the front hides it again, by the same observer.
      this.hid = false
      navbar.restoreNavigation(!this.host.still())
    } else if (!hide) this.hid = false
  }

  /**
   * On a computer the mouse at the top of the tab shows the chrome, and it stays while the mouse
   * is on the header or the row under the page; a moment after the mouse leaves them it goes.
   */
  private watchMouse(): void {
    const el = this.host.containerEl
    // The header is out of the layout in the mode, so a strip at the top of the tab stands for it.
    this.edge = el.createDiv({ cls: 'abele-book-zen-edge' })
    const keep = (t: EventTarget | null) =>
      !!(t as Element | null)?.closest?.(
        '.view-header, .abele-book-zen-edge, .abele-book-reader__foot'
      )
    const over = (e: MouseEvent) => {
      if (!zen().on) return
      if (keep(e.target)) this.peek(true, 0)
      else if (this.host.model.zenPeek && !this.timer) this.peek(true, PEEK_LEAVE_MS)
    }
    el.addEventListener('mouseover', over)
    this.stops.push(() => el.removeEventListener('mouseover', over))
  }

  destroy(): void {
    this.win.clearTimeout(this.timer)
    for (const stop of this.stops) stop()
    this.stops = []
    this.observer?.disconnect()
    this.observer = null
    this.edge?.remove()
    this.host.containerEl.classList.remove(ZEN_CLASS, ZEN_PEEK_CLASS)
    this.host.model.zenPeek = false
    if (this.hid) {
      this.hid = false
      this.host.navbar()?.restoreNavigation(false)
    }
  }
}
