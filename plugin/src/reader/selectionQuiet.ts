/**
 * Whether words are still being selected: what keeps the bar for them hidden until they are made.
 *
 * iOS tells a page nothing while a selection handle is dragged — no move, no lift — so the only
 * sign the finger has stopped is that nothing has changed for a while: the selection, or a pointer
 * that does report itself. `busy` says what else still counts as at it: a mouse button down, a
 * selection held at the page's edge.
 */

/**
 * How long a selection has to rest — no change to it, no touch or pointer moving — before it is
 * taken as made and its bar comes back.
 */
export const QUIET_MS = 500

export class SelectionQuiet {
  private on = false
  private last = 0
  private timer = 0

  constructor(
    /** Told `true` when words begin to be selected, `false` once they are made. */
    private readonly tell: (on: boolean) => void,
    private readonly busy: () => boolean
  ) {}

  /** Something moved while words are selected. */
  active(): void {
    this.last = Date.now()
    if (!this.on) {
      this.on = true
      this.tell(true)
    }
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.settle(), QUIET_MS + 20)
  }

  /** Keeps it hidden `ms` longer than the quiet alone would. */
  extend(ms: number): void {
    this.last += ms
  }

  /** Made: the host hears it, unless something is still moving — or at once, `now`. */
  settle(now = false): void {
    window.clearTimeout(this.timer)
    if (!now && (this.busy() || Date.now() - this.last < QUIET_MS)) {
      this.timer = window.setTimeout(() => this.settle(), QUIET_MS)
      return
    }
    if (!this.on) return
    this.on = false
    this.tell(false)
  }

  dispose(): void {
    window.clearTimeout(this.timer)
  }
}
