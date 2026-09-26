/**
 * When the quick button is out of the way, and when it is not there at all.
 *
 * Two different things. *Gone* is for moments the button would be in the way of something the
 * person is doing — typing, selecting words, a dialog, drawing on a PDF: it simply is not there.
 * *Tucked* is for reading: after a scroll down, or a page turned forward, it slides to the edge
 * of the screen with a sliver still showing, which is enough to press, and comes back on a
 * scroll up — the way Obsidian's own navigation bar hides while reading.
 */

export type QuickPlatform = 'phone' | 'tablet' | 'desktop'

export interface QuickSignals {
  enabled: boolean
  platform: QuickPlatform
  /** The setting that puts it on a tablet too. */
  tablet: boolean
  /** A field the on-screen keyboard comes up for has focus. */
  typing: boolean
  /** The keyboard height Obsidian's mobile app has written; 0 where it wrote none. */
  keyboard: number
  /** Words are selected on the page. */
  selection: boolean
  /** A dialog is open. */
  dialog: boolean
  /**
   * A sidebar drawer over the screen: none, one whose view has a quick menu of its own (the
   * chat), or any other.
   */
  drawer: 'closed' | 'quick' | 'other'
  /** The view in front says it is busy with something the button would get in the way of. */
  viewBusy: boolean
}

export type GoneReason =
  | 'off'
  | 'desktop'
  | 'tablet'
  | 'keyboard'
  | 'selection'
  | 'dialog'
  | 'drawer'
  | 'view'

/** Why the button is not there at all, or null when it is. */
export function goneReason(s: QuickSignals): GoneReason | null {
  if (!s.enabled) return 'off'
  if (s.platform === 'desktop') return 'desktop'
  if (s.platform === 'tablet' && !s.tablet) return 'tablet'
  if (s.typing || s.keyboard > 0) return 'keyboard'
  if (s.selection) return 'selection'
  if (s.dialog) return 'dialog'
  if (s.drawer === 'other') return 'drawer'
  if (s.viewBusy) return 'view'
  return null
}

/**
 * Which way things are being scrolled, per scroller.
 *
 * A scroll down of at least `threshold` pixels, taken together, tucks the button; the same up
 * brings it back; so does arriving at the top. A turn of direction starts the count again, so a
 * finger resting on the screen does not flicker it.
 */
export class ScrollWatch {
  private last = new Map<string, number>()
  private run = new Map<string, number>()
  /** What was last said, so each change is said once. */
  private state: 'tuck' | 'show' = 'show'

  constructor(private readonly threshold: number) {}

  /** A scroller's new position; says `tuck` or `show` when that changes, null otherwise. */
  feed(key: string, top: number): 'tuck' | 'show' | null {
    const before = this.last.get(key)
    this.last.set(key, top)
    if (before === undefined) return null
    if (top <= 4 && before > top) {
      this.run.set(key, 0)
      return this.say('show')
    }
    const delta = top - before
    if (delta === 0) return null
    const run = this.run.get(key) ?? 0
    const next = Math.sign(run) === Math.sign(delta) ? run + delta : delta
    if (Math.abs(next) < this.threshold) {
      this.run.set(key, next)
      return null
    }
    this.run.set(key, 0)
    return this.say(next > 0 ? 'tuck' : 'show')
  }

  /** Something else moved it — another view came to the front: start from shown. */
  reset(): void {
    this.last.clear()
    this.run.clear()
    this.state = 'show'
  }

  /** The button was tucked or brought back by something else: a page turned, a press. */
  note(state: 'tuck' | 'show'): void {
    this.state = state
  }

  private say(state: 'tuck' | 'show'): 'tuck' | 'show' | null {
    if (state === this.state) return null
    this.state = state
    return state
  }
}
