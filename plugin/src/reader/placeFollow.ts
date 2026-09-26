/**
 * An open book and the place another device leaves it at. While the book is read on one device,
 * every few page turns reach the others through the places file; a tab open there follows them
 * only while it is not being read itself, and says so once.
 *
 * - Read here in the last minute (`READING_MS`): what arrives waits. The next page turned here
 *   wins over it; the tab coming back into view (the app shown again, the tab picked) goes to
 *   it.
 * - Not read here for that long: what arrives is gone to at once — or, if it arrived meanwhile,
 *   at the next page turned here, instead of that turn.
 * - The notice is shown once, not at every place that arrives after it: again only after the tab
 *   came back into view or a page was turned here.
 * - The move made to follow is not this device's reading, so it is not written back as its place:
 *   written with a fresh time, it would reach the other device as newer than where that one is.
 */
import { Notice, type ItemView } from 'obsidian'
import type { BookPlaces } from './positions'

/** How long after its last page turn a tab counts as being read. */
export const READING_MS = 60_000

export const FOLLOWED_NOTICE = 'Moved to where this book was left on another device.'

type Store = Pick<BookPlaces, 'get' | 'onNewer'>

export class PlaceFollow {
  /** When a page was last turned here; 0 since opening or coming back. */
  private turnedAt = 0
  /** Another device's place, not gone to yet. */
  private waiting: string | null = null
  /** The notice was shown since opening or coming back. */
  private said = false
  /** Going to another device's place: the relocations that makes are not this device's. */
  private moving = false
  /** The page on screen, as the engine last said. */
  private at: string | undefined
  private readonly stopHearing: () => void

  constructor(
    private readonly store: Store,
    private readonly key: string,
    private readonly current: () => string | undefined,
    private readonly go: (cfi: string) => Promise<unknown>
  ) {
    this.at = current()
    this.stopHearing = store.onNewer((keys) => {
      if (keys.includes(key)) void this.heard()
    })
  }

  private reading(): boolean {
    return this.turnedAt > 0 && Date.now() - this.turnedAt < READING_MS
  }

  private async heard(): Promise<void> {
    const place = await this.store.get(this.key)
    if (!place || place.cfi === this.current()) return
    if (this.moving || this.reading()) this.waiting = place.cfi
    else await this.follow(place.cfi)
  }

  private async follow(cfi: string): Promise<void> {
    this.waiting = null
    this.moving = true
    try {
      await this.go(cfi)
    } catch (e) {
      console.warn('[Abele] could not go where another device left the book', e)
      return
    } finally {
      this.moving = false
    }
    if (this.said) return
    this.said = true
    new Notice(FOLLOWED_NOTICE)
  }

  /**
   * The engine says where the page is (`cfi`). False when that is not this device's reading — the
   * tab following another device — and so not to be written as this device's place. The same
   * page said again — the tab laid out anew, shown again, resized — is no page turned.
   */
  turned(cfi: string | undefined): boolean {
    if (this.moving) {
      this.at = cfi
      return false
    }
    if (cfi === this.at) return true
    this.at = cfi
    if (this.waiting && !this.reading()) {
      void this.follow(this.waiting)
      return false
    }
    this.waiting = null
    this.turnedAt = Date.now()
    // Read here since: the next time it follows, that is news again.
    this.said = false
    return true
  }

  /** The tab came back into view: not being read until a page is turned, and told again. */
  back(): void {
    this.turnedAt = 0
    this.said = false
    if (this.waiting && !this.moving) void this.follow(this.waiting)
  }

  stop(): void {
    this.stopHearing()
  }
}

/** How long a tab shown again is given to be laid out before it goes anywhere. */
const LAID_OUT_MS = 150

/**
 * Calls `then` when the tab is looked at again — the app shown, the tab picked — once it is laid
 * out at its size again: a hidden tab has none, and a move made then is lost when it is laid out.
 */
export function onLookedAgain(view: ItemView, then: () => void): void {
  const win = view.containerEl.win
  const doc = view.containerEl.doc
  const again = () =>
    win.setTimeout(() => {
      if (view.contentEl.isShown()) then()
    }, LAID_OUT_MS)
  view.registerEvent(
    view.app.workspace.on('active-leaf-change', (leaf) => {
      if (leaf === view.leaf) again()
    })
  )
  view.registerDomEvent(doc, 'visibilitychange', () => {
    if (doc.visibilityState === 'visible') again()
  })
}
