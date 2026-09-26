/**
 * When words selected on the page have stopped moving — the moment a bar that offers something
 * to do with them may show. Before that it would jump up under a finger still dragging them out
 * (Anton, 2026-09-27, of the chat on his phone).
 *
 * "Stopped" means no finger and no mouse button is down, and no `selectionchange` has come for a
 * moment. The pause is what catches a handle dragged on iOS: WebKit moves those itself, and the
 * page hears only the selection changing, with no touch of its own. Its length follows what
 * moved the words last — a finger is given the longest, the mouse only has to come up.
 *
 * `cleared` comes at once, whenever the words go, move or a new press starts over; `settled`
 * once, each time they come to rest. What is selected, and where, is the caller's to read.
 */
export const SETTLE_MS = { touch: 450, mouse: 120, key: 300 } as const

type Input = keyof typeof SETTLE_MS

export interface SettledSelectionHandlers {
  settled: () => void
  cleared: () => void
  /** A press here is not a new selection — the bar's own buttons. */
  ignore?: (target: Node) => boolean
}

export class SettledSelection {
  private readonly win: Window
  private readonly abort = new AbortController()
  private fingers = 0
  private mouseDown = false
  private last: Input = 'mouse'
  private timer: number | undefined

  constructor(
    private readonly doc: Document,
    private readonly on: SettledSelectionHandlers
  ) {
    this.win = doc.defaultView ?? window
    const opts = { capture: true, passive: true, signal: this.abort.signal }
    doc.addEventListener('selectionchange', () => this.changed(), { signal: this.abort.signal })
    doc.addEventListener('touchstart', (e) => this.touched(e, true), opts)
    doc.addEventListener('touchend', (e) => this.touched(e, false), opts)
    doc.addEventListener('touchcancel', (e) => this.touched(e, false), opts)
    doc.addEventListener('pointerdown', (e) => this.pressed(e, true), opts)
    doc.addEventListener('pointerup', (e) => this.pressed(e, false), opts)
    doc.addEventListener('pointercancel', (e) => this.pressed(e, false), opts)
    doc.addEventListener('keydown', () => (this.last = 'key'), opts)
  }

  private get down(): boolean {
    return this.fingers > 0 || this.mouseDown
  }

  private selected(): boolean {
    const selection = this.doc.getSelection()
    return !!selection && selection.rangeCount > 0 && !selection.isCollapsed
  }

  private ignored(e: Event): boolean {
    const target = e.target as Node | null
    return !!target && !!this.on.ignore?.(target)
  }

  private touched(e: Event, start: boolean) {
    if (this.ignored(e)) return
    this.last = 'touch'
    const touches = (e as TouchEvent).touches
    this.fingers = touches ? touches.length : start ? this.fingers + 1 : 0
    if (start) this.startOver()
    else if (!this.down) this.wait()
  }

  private pressed(e: Event, start: boolean) {
    if (this.ignored(e)) return
    const p = e as PointerEvent
    if (p.pointerType !== 'mouse') {
      // A finger is followed through its touches, which say how many are down; the pointer
      // only says what moved the words last.
      this.last = 'touch'
      return
    }
    this.last = 'mouse'
    if (start && p.button !== 0) return
    this.mouseDown = start
    if (start) this.startOver()
    else this.wait()
  }

  /** Words moving — a handle dragged, a key pressed — take down what was shown until they stop. */
  private changed() {
    this.cancel()
    this.on.cleared()
    if (this.selected() && !this.down) this.wait()
  }

  private startOver() {
    this.cancel()
    this.on.cleared()
  }

  private wait() {
    this.cancel()
    if (!this.selected()) return
    this.timer = this.win.setTimeout(() => {
      this.timer = undefined
      if (!this.down && this.selected()) this.on.settled()
    }, SETTLE_MS[this.last])
  }

  private cancel() {
    if (this.timer === undefined) return
    this.win.clearTimeout(this.timer)
    this.timer = undefined
  }

  destroy() {
    this.cancel()
    this.abort.abort()
  }
}
