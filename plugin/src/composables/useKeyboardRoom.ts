import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { KEYBOARD_GAP, liftFor, revealDelta, safeAreaTop } from './keyboardLift'

/**
 * On the dialog's container while it is moved into the room the keyboard leaves, whole; the
 * rules are in `styles.css`.
 */
const FITTED = 'abele-keyboard-room'
/**
 * On the container while its dialog, taller than that room, keeps its size at the room's top and
 * reaches under the keyboard; on the element that scrolls the field, the room to scroll what the
 * keyboard covers up above it.
 */
const COVERED = 'abele-keyboard-cover'
const SCROLLER = 'abele-keyboard-scroller'
/**
 * On a tablet's container while its dialog is moved up by `--abele-keyboard-lift`, only as far
 * as the keyboard covers it — see `keyboardLift.ts`.
 */
const LIFTED = 'abele-keyboard-lift'

/** Obsidian's own: the height of the on-screen keyboard, written by the mobile app. */
export const KEYBOARD_VAR = '--keyboard-height'

/**
 * What the mobile app raises on the window around the keyboard. Obsidian listens to the two
 * `Will` ones itself (its toolbar and navigation bar); the `Did` ones are the Capacitor
 * keyboard plugin's names and cost nothing to hear as well.
 */
export const KEYBOARD_EVENTS = [
  'keyboardWillShow',
  'keyboardDidShow',
  'keyboardWillHide',
  'keyboardDidHide',
] as const

/** A field the on-screen keyboard comes up for. */
const TYPED =
  'textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]):not([type="color"]):not([type="file"])'

/** What the last measurement decided, for the keyboard diagnostics panel. */
export interface KeyboardRoomReport {
  at: number
  /** The container's top and bottom when measured, before any fit. */
  container: [number, number]
  /** Where the visual viewport ends, and where the keyboard height says the keyboard starts. */
  viewportBottom: number | null
  keyboardTop: number | null
  keyboardHeight: number
  fullHeight: number
  typing: boolean
  /** The room given as top and height, or null when the container was left as it was. */
  room: [number, number] | null
  /** On a tablet: how far the dialog was moved up, and how much of it still scrolls. */
  lift?: number
  cover?: number
}

export const keyboardRoomReport: { last: KeyboardRoomReport | null } = { last: null }

const px = (value: string | null | undefined): number => {
  const n = parseFloat(value ?? '')
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** The keyboard height the app has written, in CSS pixels; 0 where it writes none. */
export function keyboardVar(doc: Document): number {
  const root = doc.documentElement
  const inline = root.style.getPropertyValue(KEYBOARD_VAR)
  if (inline) return px(inline)
  const view = doc.defaultView
  if (!view) return 0
  return px(view.getComputedStyle(root).getPropertyValue(KEYBOARD_VAR))
}

/**
 * The tallest the page has been at each width. The keyboard is measured from the bottom of the
 * screen, and where the platform shrinks the page for it `innerHeight` shrinks too — so the
 * screen's bottom is remembered from before, or the keyboard would be taken off twice.
 */
const tallest = new Map<number, number>()

function fullHeight(win: Window): number {
  const width = win.innerWidth
  const seen = Math.max(tallest.get(width) ?? 0, win.innerHeight)
  tallest.set(width, seen)
  // The screen, where it is the same shape as the window: covers a dialog first measured with
  // the keyboard already up. iOS never turns `screen` with the device, hence both sides.
  const screen = win.screen
  let whole = 0
  if (screen && Math.abs(screen.width - width) < 2) whole = screen.height
  else if (screen && Math.abs(screen.height - width) < 2) whole = screen.width
  return Math.max(seen, whole)
}

/**
 * Keeps a dialog inside the part of the screen the on-screen keyboard leaves free, and the
 * field being typed into in sight.
 *
 * Every dialog of the plugin gets this through the kit's `Modal`. On a phone the task's date
 * dialog stood centred on the whole screen and the keyboard for its time field covered the
 * lower half of it, with nothing that could be scrolled to bring it back.
 *
 * Where the keyboard is, is told two ways, and which one a platform uses cannot be seen from
 * here — so both are read, and each gives the line the keyboard starts at, never an amount to
 * take off, so that one reading can never be taken on top of the other:
 *
 * - The visual viewport shrinks (a browser, Android). The container still reaches under the
 *   keyboard; it ends where the viewport ends.
 * - Obsidian's iPhone app shrinks nothing: its own stylesheet takes `--keyboard-height` off
 *   `100vh` for the workspace and the toolbar, a variable the native side of the app writes
 *   and announces with `keyboardWillShow` / `keyboardWillHide` on the window. 1.29.0 read only
 *   the viewport and changed nothing there. The keyboard then starts that far above the
 *   bottom of the screen — the screen, not the page: where the page has already shrunk for it
 *   there is nothing left to cover.
 *
 * The second is read only while a field inside the dialog has focus. The variable is written
 * with no event of its own, and a height read from it once stayed after the keyboard had gone
 * (1.19.1). So it is watched as an attribute of the root element, heard through the window
 * events as well, and trusted only while there is something to type into.
 *
 * The dialog ends up no taller than the room and scrolls inside, and the field that has focus
 * is scrolled into view each time the room changes and each time a field takes focus.
 *
 * That is the phone, where Obsidian draws a dialog as a sheet over the screen. On a tablet it
 * stands in the middle, the keyboard covers less of it or none, and the phone's rules jumped it
 * to the top of the screen and scrolled the field to the middle of a box the keyboard still
 * covered — "scrolls very strangely, and the field is still under the keyboard", from the
 * owner's iPad. There the dialog is only moved up by what the keyboard covers of it
 * (`keyboardLift.ts`), the field is scrolled only while it is covered and only inside the
 * dialog, and a measurement that finds what the last one found changes nothing.
 *
 * @param root - An element inside the dialog. The dialog and its container are found from it.
 */
export function useKeyboardRoom(root: Readonly<Ref<HTMLElement | null | undefined>>): void {
  let win: Window | null = null
  let doc: Document | null = null
  let observer: MutationObserver | null = null
  // The container carrying a fit of ours, if any: only then is there anything of ours to undo.
  let fitted: HTMLElement | null = null
  let scroller: HTMLElement | null = null
  // The tablet's move, kept across measurements so that a measurement changes nothing it need not.
  let lifted: HTMLElement | null = null
  let lift = 0
  let cover = 0
  // What a keyboard event said the height was, until one says the keyboard has gone.
  let announced = 0
  const timers: number[] = []

  // Found each time rather than once on mounting: Obsidian may not have finished putting the
  // dialog together when this component mounts inside it.
  const dialog = () => root.value?.closest<HTMLElement>('.modal') ?? null
  const container = () => root.value?.closest<HTMLElement>('.modal-container') ?? null

  const releaseScroller = () => {
    scroller?.classList.remove(SCROLLER)
    scroller?.style.removeProperty('--abele-keyboard-cover')
    scroller?.style.removeProperty('--abele-keyboard-keep')
    scroller = null
  }

  const releaseLift = () => {
    lifted?.classList.remove(LIFTED)
    lifted?.style.removeProperty('--abele-keyboard-lift')
    lifted = null
    lift = 0
    cover = 0
  }

  const release = () => {
    releaseScroller()
    releaseLift()
    if (!fitted) return
    fitted.classList.remove(FITTED, COVERED)
    fitted.style.removeProperty('--abele-room-top')
    fitted.style.removeProperty('--abele-room-height')
    fitted = null
  }

  /**
   * What scrolls under the keyboard: the box the field scrolls in; failing that — a search field
   * above its list of results — the dialog's largest box that scrolls; failing that, the dialog.
   */
  const scrollerOf = (from: Element | null, box: HTMLElement): HTMLElement => {
    const view = box.ownerDocument.defaultView
    const scrolls = (el: Element) => {
      const overflow = view?.getComputedStyle(el).overflowY
      return overflow === 'auto' || overflow === 'scroll'
    }
    for (let el = from?.parentElement ?? null; el && el !== box; el = el.parentElement)
      if (scrolls(el)) return el
    // Walked from the top, never into a box that scrolls: a list of a thousand icons is one box.
    let largest: HTMLElement | null = null
    const walk = (el: Element) => {
      for (const child of Array.from(el.children)) {
        if (scrolls(child)) {
          if (child.clientHeight > (largest?.clientHeight ?? 0)) largest = child as HTMLElement
        } else if (child.childElementCount < 40) walk(child)
      }
    }
    walk(box)
    return largest ?? box
  }

  /** The dialog's element that has focus, if any. */
  const focused = (): Element | null => {
    const box = dialog()
    const active = box?.ownerDocument.activeElement
    // Not `instanceof HTMLElement`: a dialog opened from the settings window lives in that
    // window's document, whose elements belong to another realm.
    if (!box || !active || active === box || !box.contains(active)) return null
    return active
  }

  /**
   * Obsidian's tablet layout: a dialog in the middle of the screen rather than a sheet over it.
   * Obsidian only sets `is-phone` on a mobile device, so a desktop window keeps the phone's rules.
   */
  const tablet = () => {
    const body = doc?.body
    return !!body && body.classList.contains('is-mobile') && !body.classList.contains('is-phone')
  }

  /** Where the field may stand on a tablet: set by the last measurement. */
  let band: [number, number] | null = null

  /** The field brought between the top of the screen and the keyboard, only if it is not. */
  const revealOnTablet = () => {
    const field = focused()
    const panel = dialog()
    if (!field || !panel || !band) return
    const delta = revealDelta(field.getBoundingClientRect(), band[0], band[1])
    if (Math.abs(delta) < 1) return
    // Its own box, never the page: scrolling the page pans the whole app under the keyboard.
    const box = scroller ?? scrollerOf(field, panel)
    box.scrollTop += delta
  }

  const reveal = () => {
    if (tablet()) revealOnTablet()
    else focused()?.scrollIntoView({ block: 'center' })
  }

  /**
   * The tablet's measurement. The dialog is moved up only by what the keyboard covers of it, and
   * only while it covers some; what still does not fit scrolls. Nothing is let go first, so a
   * measurement that finds what the last one found changes nothing and scrolls nothing.
   */
  const fitTablet = (
    box: HTMLElement,
    panel: HTMLElement | null,
    top: number,
    bottom: number,
    covered: boolean
  ): { lift: number; cover: number } | null => {
    if (!panel || !covered) {
      release()
      band = null
      return null
    }
    const ceiling = Math.max(top, safeAreaTop(box.ownerDocument)) + KEYBOARD_GAP
    const floor = bottom - KEYBOARD_GAP
    band = [ceiling, floor]
    const rect = panel.getBoundingClientRect()
    // Where Obsidian put it: our move is a shift and nothing else.
    const wanted = liftFor({ top: rect.top + lift, bottom: rect.bottom + lift }, ceiling, floor)
    if (!wanted) {
      releaseScroller()
      releaseLift()
      return null
    }
    if (lifted !== box || Math.abs(wanted.lift - lift) >= 1) {
      if (lifted !== box) releaseLift()
      box.style.setProperty('--abele-keyboard-lift', `${wanted.lift}px`)
      box.classList.add(LIFTED)
      lifted = box
      lift = wanted.lift
    }
    if (wanted.cover < 1) releaseScroller()
    else if (!scroller || Math.abs(wanted.cover - cover) >= 1) {
      const target = scroller ?? scrollerOf(focused(), panel)
      if (!scroller) {
        // Held at the height it has, so the room added at its end scrolls rather than grows it.
        const held = target.getBoundingClientRect().height
        target.style.setProperty('--abele-keyboard-keep', `${Math.floor(held)}px`)
        target.classList.add(SCROLLER)
        scroller = target
      }
      target.style.setProperty('--abele-keyboard-cover', `${wanted.cover}px`)
    }
    cover = wanted.cover < 1 ? 0 : wanted.cover
    return { lift, cover }
  }

  const fit = () => {
    const onTablet = tablet()
    // Measured as Obsidian left it, so that a keyboard going away gives the room back. A
    // tablet's move is only a shift of the dialog, so it is measured through instead.
    if (!onTablet || fitted) release()
    const box = container()
    if (!box || !win || !doc) return

    const rect = box.getBoundingClientRect()
    const viewport = win.visualViewport
    const offset = viewport?.offsetTop ?? 0
    let top = rect.top
    let bottom = rect.bottom

    const viewportBottom = viewport ? offset + viewport.height : null
    if (viewportBottom !== null) {
      top = Math.max(top, offset)
      bottom = Math.min(bottom, viewportBottom)
    }

    const typing = focused()?.matches(TYPED) ?? false
    const height = Math.max(keyboardVar(doc), announced)
    const full = fullHeight(win)
    let keyboardTop: number | null = null
    // Where the page has already given up the keyboard's height, it is not under the keyboard.
    if (typing && height > 0 && win.innerHeight > full - height + 1) {
      keyboardTop = full - height + offset
      bottom = Math.min(bottom, keyboardTop)
    }

    const covered = top > rect.top + 1 || bottom < rect.bottom - 1

    if (onTablet) {
      const moved = fitTablet(box, dialog(), top, bottom, covered)
      keyboardRoomReport.last = {
        at: Date.now(),
        container: [rect.top, rect.bottom],
        viewportBottom,
        keyboardTop,
        keyboardHeight: height,
        fullHeight: full,
        typing,
        room: covered ? [top, bottom - top] : null,
        lift: moved?.lift ?? 0,
        cover: moved?.cover ?? 0,
      }
      revealOnTablet()
      return
    }

    const room: [number, number] | null = covered && bottom - top > 0 ? [top, bottom - top] : null
    const panel = dialog()
    if (room && panel) {
      box.style.setProperty('--abele-room-top', `${room[0]}px`)
      box.style.setProperty('--abele-room-height', `${room[1]}px`)
      fitted = box
      // A dialog keeps its size. One that fits the room moves into it; one that does not stands
      // at the room's top as tall as it was, and what the keyboard covers of it scrolls up above
      // the keyboard — a dialog squeezed into the room was a squashed one (the search, 1.36).
      if (panel.getBoundingClientRect().height <= room[1] + 1) box.classList.add(FITTED)
      else {
        box.classList.add(COVERED)
        const under = Math.max(0, panel.getBoundingClientRect().bottom - bottom)
        scroller = scrollerOf(focused(), panel)
        // Held at the height it has, so the room added at its end scrolls rather than grows it.
        const held = scroller.getBoundingClientRect().height
        scroller.style.setProperty('--abele-keyboard-cover', `${Math.ceil(under)}px`)
        scroller.style.setProperty('--abele-keyboard-keep', `${Math.floor(held)}px`)
        scroller.classList.add(SCROLLER)
      }
    }

    keyboardRoomReport.last = {
      at: Date.now(),
      container: [rect.top, rect.bottom],
      viewportBottom,
      keyboardTop,
      keyboardHeight: height,
      fullHeight: full,
      typing,
      room,
    }

    // Every time, not only when the room changes: measuring releases the fit first, and the
    // dialog grown back for that moment has already lost its scroll position.
    reveal()
  }

  const later = (ms: number) => {
    const id = win?.setTimeout(fit, ms)
    if (id !== undefined) timers.push(id)
  }

  /** Now, and again as the keyboard finishes sliding: the app animates it over ~300 ms. */
  const refit = () => {
    fit()
    later(50)
    later(350)
  }

  const onKeyboard = (event: Event) => {
    const reported = (event as Event & { keyboardHeight?: unknown }).keyboardHeight
    if (event.type.endsWith('Hide')) announced = 0
    else if (typeof reported === 'number' && reported > 0) announced = reported
    refit()
  }

  const onFocusIn = (event: FocusEvent) => {
    const box = dialog()
    if (!box || !(event.target as Node | null) || !box.contains(event.target as Node)) return
    // After the focus has landed and the platform has had its chance to scroll first. A
    // timeout rather than a frame: a window in the background draws no frames at all.
    win?.setTimeout(reveal, 50)
    refit()
  }

  // Focus moving between two fields passes through the body; look once it has landed.
  const onFocusOut = () => later(0)

  onMounted(() => {
    const el = root.value
    if (!el) return
    doc = el.ownerDocument
    win = doc.defaultView
    if (!win) return

    win.visualViewport?.addEventListener('resize', fit)
    win.visualViewport?.addEventListener('scroll', fit)
    win.addEventListener('resize', fit)
    for (const name of KEYBOARD_EVENTS) win.addEventListener(name, onKeyboard)
    doc.addEventListener('focusin', onFocusIn)
    doc.addEventListener('focusout', onFocusOut)
    // The variable changes with no event of its own; the attribute carrying it does.
    // The window's own constructor: a dialog in the settings window is watched from there.
    const Observer = (win as Window & { MutationObserver: typeof MutationObserver })
      .MutationObserver
    observer = new Observer(() => fit())
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['style'] })
    fit()
  })

  onBeforeUnmount(() => {
    win?.visualViewport?.removeEventListener('resize', fit)
    win?.visualViewport?.removeEventListener('scroll', fit)
    win?.removeEventListener('resize', fit)
    for (const name of KEYBOARD_EVENTS) win?.removeEventListener(name, onKeyboard)
    doc?.removeEventListener('focusin', onFocusIn)
    doc?.removeEventListener('focusout', onFocusOut)
    observer?.disconnect()
    observer = null
    for (const id of timers.splice(0)) win?.clearTimeout(id)
    release()
    win = null
    doc = null
  })
}
