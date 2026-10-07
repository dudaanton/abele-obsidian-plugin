import { KEYBOARD_GAP, liftFor, revealDelta, safeAreaTop } from './keyboardLift'
import {
  FIELD_WIDGET,
  KEYBOARD_EVENTS,
  TYPED,
  caretRect,
  fullHeight,
  keyboardRoomReport,
  keyboardVar,
  toolbarTop,
  watchToolbar,
} from './keyboard'

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
/**
 * On a tablet's dialog of the shell still covered once moved as far up as it goes: held to
 * `--abele-keyboard-cap`, its body scrolling in that and its buttons above the keyboard.
 */
const CAPPED = 'abele-keyboard-capped'

/**
 * Keeps a dialog inside the part of the screen the on-screen keyboard leaves free, and the
 * field being typed into in sight.
 *
 * Every dialog of the plugin gets this through the dialog shell (`ShellModal`), attached when it
 * opens. On a phone the task's date dialog stood centred on the whole screen and the keyboard for
 * its time field covered the lower half of it, with nothing that could be scrolled to bring it
 * back.
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
 * A dialog of the shell ends up in the room, standing on the keyboard, its body scrolling and its
 * buttons above the keyboard; Obsidian's big sheet keeps its size and what the keyboard covers
 * of it scrolls up above it. Obsidian's editing toolbar, standing on the keyboard while a note
 * field is typed into, counts as keyboard. The field that has focus is scrolled into view each
 * time the room changes, each time a field takes focus and — by its caret, for a note field
 * many lines tall — each time it is typed into.
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
export function attachKeyboardRoom(root: HTMLElement): () => void {
  const doc: Document = root.ownerDocument
  const win: Window | null = doc.defaultView
  if (!win) return () => {}
  let observer: MutationObserver | null = null
  // The container carrying a fit of ours, if any: only then is there anything of ours to undo.
  let fitted: HTMLElement | null = null
  let scroller: HTMLElement | null = null
  // The tablet's move, kept across measurements so that a measurement changes nothing it need not.
  let lifted: HTMLElement | null = null
  let lift = 0
  let cover = 0
  // The tablet's dialog held shorter, and the height it had before.
  let capped: HTMLElement | null = null
  let natural = 0
  // What a keyboard event said the height was, until one says the keyboard has gone.
  let announced = 0
  // Where Obsidian's toolbar stood at the last measurement; null while it did not show.
  let fittedBar: number | null = null
  const timers: number[] = []
  let holdingAction = false
  let disposed = false

  // Found each time rather than once on mounting: Obsidian may not have finished putting the
  // dialog together when this component mounts inside it.
  const dialog = () => root.closest<HTMLElement>('.modal')
  const container = () => root.closest<HTMLElement>('.modal-container')

  const releaseScroller = () => {
    scroller?.classList.remove(SCROLLER)
    scroller?.style.removeProperty('--abele-keyboard-cover')
    scroller?.style.removeProperty('--abele-keyboard-keep')
    scroller = null
  }

  const releaseCap = () => {
    capped?.classList.remove(CAPPED)
    capped?.style.removeProperty('--abele-keyboard-cap')
    capped = null
    natural = 0
  }

  const releaseLift = () => {
    releaseCap()
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
    // Above the field's own widget: an editor scrolls inside itself, and room given to that box
    // leaves the field where it is.
    const field = from?.closest(FIELD_WIDGET) ?? from
    // The shell's body is the box a dialog's content scrolls in, by construction.
    for (let el = field?.parentElement ?? null; el && el !== box; el = el.parentElement)
      if (scrolls(el) || el.classList.contains('abele-modal__body')) return el
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

  /**
   * A dialog of the shell whose body is what scrolls. Tall forms with a pinned footer shrink
   * too: padding the body of a big sheet cannot bring its Save button above the toolbar.
   * Unfooted big sheets keep Obsidian's existing list/screen behaviour. The form is fitted
   * into the room even when it is taller: its body scrolls in less height,
   * and its title and buttons stay in sight, where the buttons of a dialog keeping its size stood
   * under the keyboard.
   */
  const shrinks = (panel: HTMLElement) =>
    panel.classList.contains('abele-modal') &&
    (!panel.classList.contains('mod-lg') || panel.classList.contains('abele-modal_footed'))

  /** The typing field that has focus — never a select, button, card or list row. */
  const focused = (): Element | null => {
    const box = dialog()
    const active = box?.ownerDocument.activeElement
    // Not `instanceof HTMLElement`: a dialog opened from the settings window lives in that
    // window's document, whose elements belong to another realm.
    if (!box || !active || active === box || !box.contains(active) || !active.matches(TYPED))
      return null
    // Focus lands between pointerdown and click. Scrolling an action here can move it away
    // from the press and swallow a touch click. Native selects open an anchored popover,
    // not a keyboard: revealing one moves both the control and the menu for no reason.
    return active
  }

  /**
   * Obsidian's tablet layout: a dialog in the middle of the screen rather than a sheet over it.
   * Obsidian only sets `is-phone` on a mobile device, so a desktop window keeps the phone's rules.
   */
  const tablet = () => {
    const body = doc.body
    return !!body && body.classList.contains('is-mobile') && !body.classList.contains('is-phone')
  }

  /** Where the field may stand while the keyboard is up: set by the last measurement. */
  let band: [number, number] | null = null

  /**
   * The field — its caret, for a field many lines tall — brought between the top of the screen
   * and the keyboard, only if it is not there. Its own box is scrolled, never the page: scrolling
   * the page pans the whole app under the keyboard.
   */
  const revealInBand = () => {
    const field = focused()
    const panel = dialog()
    if (!field || !panel || !band) return
    const box = scroller ?? scrollerOf(field, panel)
    // Inside what the box shows, too: the dialog's pinned buttons stand under its body, and a
    // line kept only above the keyboard stood behind them.
    const shown = box.getBoundingClientRect()
    const ceiling = shown.height > 0 ? Math.max(band[0], shown.top + KEYBOARD_GAP) : band[0]
    const floor = shown.height > 0 ? Math.min(band[1], shown.bottom - KEYBOARD_GAP) : band[1]
    const delta = revealDelta(caretRect(field), ceiling, Math.max(ceiling, floor))
    if (Math.abs(delta) < 1) return
    box.scrollTop += delta
  }

  const reveal = () => {
    const field = focused()
    if (!field) return
    // A field of one line is centred, as the platform would; one many lines tall, the note
    // field, is kept by its caret: centring the whole of it put the line being typed under the
    // keyboard.
    if (tablet() || field.closest(FIELD_WIDGET) || field.matches('[contenteditable="true"]'))
      revealInBand()
    else field.scrollIntoView({ block: 'center' })
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
    // Where Obsidian put it: our move is a shift and nothing else, and a hold on its height is
    // measured through as well.
    const height = capped === panel ? natural : rect.height
    const wanted = liftFor(
      { top: rect.top + lift, bottom: rect.top + height + lift },
      ceiling,
      floor
    )
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
    if (wanted.cover >= 1 && shrinks(panel)) {
      // A dialog of the shell is held above the keyboard instead: its body scrolls in less
      // height and its buttons stay in sight, where they stood under the keyboard.
      releaseScroller()
      if (capped !== panel) {
        releaseCap()
        natural = rect.height
        capped = panel
        panel.classList.add(CAPPED)
      }
      const cap = `${Math.floor(natural - wanted.cover)}px`
      if (panel.style.getPropertyValue('--abele-keyboard-cap') !== cap)
        panel.style.setProperty('--abele-keyboard-cap', cap)
    } else if (wanted.cover < 1) {
      releaseScroller()
      releaseCap()
    } else if (!scroller || Math.abs(wanted.cover - cover) >= 1) {
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
    // A native press focuses a button before delivering its click. Releasing the keyboard
    // fit on that blur moves the button away from the finger and swallows the action.
    if (holdingAction) return
    const onTablet = tablet()
    // Measured as Obsidian left it, so that a keyboard going away gives the room back. A
    // tablet's move is only a shift of the dialog, so it is measured through instead.
    if (!onTablet || fitted) release()
    const box = container()
    if (!box || !win) return

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

    const typing = focused() !== null
    const height = Math.max(keyboardVar(doc), announced)
    const full = fullHeight(win)
    let keyboardTop: number | null = null
    // Where the page has already given up the keyboard's height, it is not under the keyboard.
    if (typing && height > 0 && win.innerHeight > full - height + 1) {
      keyboardTop = full - height + offset
      bottom = Math.min(bottom, keyboardTop)
    }

    // Obsidian's editing toolbar stands on the keyboard while a note field is typed into.
    const bar = typing ? toolbarTop(doc) : null
    fittedBar = bar
    if (bar !== null && bar < bottom) bottom = bar
    // Fitting a tall footed form overrides the sheet's natural top. Keep its title and close
    // action below the same resolved safe area used to reveal the editor caret.
    if (!onTablet && (bar !== null || keyboardTop !== null)) top = Math.max(top, safeAreaTop(doc))

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
        toolbarTop: bar,
        room: covered ? [top, bottom - top] : null,
        lift: moved?.lift ?? 0,
        cover: moved?.cover ?? 0,
      }
      revealInBand()
      return
    }

    // The band a field is kept in on a phone: under the top of the room, above the keyboard.
    band = covered ? [Math.max(top, safeAreaTop(doc)) + KEYBOARD_GAP, bottom - KEYBOARD_GAP] : null

    const room: [number, number] | null = covered && bottom - top > 0 ? [top, bottom - top] : null
    const panel = dialog()
    if (room && panel) {
      box.style.setProperty('--abele-room-top', `${room[0]}px`)
      box.style.setProperty('--abele-room-height', `${room[1]}px`)
      fitted = box
      // One that fits the room moves into it, and so does a form of the shell, its body scrolling
      // in less height. Obsidian's big sheet keeps its size: it stands at the room's top as tall
      // as it was, and what the keyboard covers of it scrolls up above the keyboard — a list
      // squeezed into the room was a squashed one (the search, 1.36).
      if (panel.getBoundingClientRect().height <= room[1] + 1 || shrinks(panel))
        box.classList.add(FITTED)
      else {
        box.classList.add(COVERED)
        const target = scrollerOf(focused(), panel)
        const rect = target.getBoundingClientRect()
        // What the keyboard covers of the box that scrolls, not of the dialog: on an iPhone
        // Obsidian's own stylesheet already stops a dialog's content above the keyboard, and
        // room added for it again squeezed the content into what was left — the icon picker's
        // grid 8 px tall, the chat history's list gone.
        const under = Math.max(0, rect.bottom - bottom)
        if (under >= 1) {
          scroller = target
          // Held at the height it has, so the room added at its end scrolls rather than grows it.
          scroller.style.setProperty('--abele-keyboard-cover', `${Math.ceil(under)}px`)
          scroller.style.setProperty('--abele-keyboard-keep', `${Math.floor(rect.height)}px`)
          scroller.classList.add(SCROLLER)
        }
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
      toolbarTop: bar,
      room,
    }

    // Every time, not only when the room changes: measuring releases the fit first, and the
    // dialog grown back for that moment has already lost its scroll position.
    reveal()
  }

  const later = (ms: number) => {
    const id = win.setTimeout(fit, ms)
    if (id !== undefined) timers.push(id)
  }

  // Obsidian's toolbar lands after the keyboard: measured again where it stands still.
  const toolbar = watchToolbar(
    win,
    () => (focused() ? toolbarTop(doc) : null),
    () => fittedBar,
    fit
  )

  /** Now, and again as the keyboard finishes sliding (~300 ms); then the toolbar is watched. */
  const refit = () => {
    fit()
    later(50)
    later(350)
    toolbar.watch()
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
    win.setTimeout(reveal, 50)
    refit()
  }

  // Focus moving between two fields passes through the body; look once it has landed.
  const onFocusOut = () => later(0)

  /**
   * While typing: a note field grows a line at a time, and the line being typed walked down under
   * the keyboard with nothing following it. Kept in sight after each change of the text or of
   * where the caret is, once the editor has drawn it.
   */
  let typingTimer: number | undefined
  const onTyping = () => {
    const field = focused()
    // Only a field that grows: a line of text stays where it was put, and scrolling under it
    // while it is typed into is only a chance to lose a keystroke.
    if (
      !field ||
      !band ||
      !(field.closest(FIELD_WIDGET) || field.matches('[contenteditable="true"]'))
    )
      return
    if (typingTimer !== undefined) win.clearTimeout(typingTimer)
    typingTimer = win.setTimeout(() => {
      typingTimer = undefined
      revealInBand()
    }, 30)
  }

  const onActionPress = (event: Event) => {
    const target = (event.target as Element | null)?.closest?.('button, [role="button"]')
    if (!target || target.matches(':disabled, [aria-disabled="true"]')) return
    if (dialog()?.contains(target) && focused()) holdingAction = true
  }
  const endActionPress = () => {
    if (!holdingAction) return
    queueMicrotask(() => {
      if (disposed) return
      holdingAction = false
      fit()
    })
  }
  doc.addEventListener('pointerdown', onActionPress, true)
  doc.addEventListener('touchstart', onActionPress, true)
  doc.addEventListener('mousedown', onActionPress, true)
  doc.addEventListener('click', endActionPress, true)
  doc.addEventListener('pointercancel', endActionPress, true)

  win.visualViewport?.addEventListener('resize', fit)
  win.visualViewport?.addEventListener('scroll', fit)
  win.addEventListener('resize', fit)
  for (const name of KEYBOARD_EVENTS) win.addEventListener(name, onKeyboard)
  doc.addEventListener('focusin', onFocusIn)
  doc.addEventListener('focusout', onFocusOut)
  doc.addEventListener('input', onTyping, true)
  doc.addEventListener('selectionchange', onTyping)
  doc.addEventListener('transitionend', toolbar.landed, true)
  doc.addEventListener('animationend', toolbar.landed, true)
  // The variable changes with no event of its own; the attribute carrying it does.
  // The window's own constructor: a dialog in the settings window is watched from there.
  const Observer = (win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver
  observer = new Observer(() => {
    fit()
    toolbar.watch()
  })
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['style'] })
  fit()

  return () => {
    disposed = true
    doc.removeEventListener('pointerdown', onActionPress, true)
    doc.removeEventListener('touchstart', onActionPress, true)
    doc.removeEventListener('mousedown', onActionPress, true)
    doc.removeEventListener('click', endActionPress, true)
    doc.removeEventListener('pointercancel', endActionPress, true)
    win.visualViewport?.removeEventListener('resize', fit)
    win.visualViewport?.removeEventListener('scroll', fit)
    win.removeEventListener('resize', fit)
    for (const name of KEYBOARD_EVENTS) win.removeEventListener(name, onKeyboard)
    doc.removeEventListener('focusin', onFocusIn)
    doc.removeEventListener('focusout', onFocusOut)
    doc.removeEventListener('input', onTyping, true)
    doc.removeEventListener('selectionchange', onTyping)
    doc.removeEventListener('transitionend', toolbar.landed, true)
    doc.removeEventListener('animationend', toolbar.landed, true)
    toolbar.stop()
    observer?.disconnect()
    observer = null
    if (typingTimer !== undefined) win.clearTimeout(typingTimer)
    for (const id of timers.splice(0)) win.clearTimeout(id)
    release()
  }
}
