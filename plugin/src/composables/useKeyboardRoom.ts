import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/** On the dialog's container while it is fitted to the room; the rule is in `styles.css`. */
const FITTED = 'abele-keyboard-room'

/**
 * Keeps a small dialog inside the part of the screen the on-screen keyboard leaves free, and
 * the field being typed into in sight.
 *
 * On a phone the task's date dialog stood centred on the whole screen, and the keyboard that
 * came up for its time field covered the lower half of it — the field, the preset times and
 * the buttons — with nothing that could be scrolled to bring them back.
 *
 * Two things go wrong there, and which one depends on how the platform makes room for the
 * keyboard, which cannot be seen from here:
 *
 * - The page stays the height of the screen and only the visual viewport shrinks. The dialog's
 *   container then still reaches under the keyboard, and the dialog is centred in it. So the
 *   container is fitted to the visual viewport here, for as long as the viewport is smaller.
 * - The page shrinks, but the dialog's own cap is written in `vh`, which does not. The dialog
 *   then stays taller than the room it stands in and is cut at both ends instead of
 *   scrolling. That half is the dialog's stylesheet: its `max-height` never exceeds its
 *   container.
 *
 * Either way the dialog ends up no taller than the room and scrolls inside, and the field that
 * has focus is scrolled into view each time the room changes — the keyboard coming up is one
 * of those changes — and each time a field takes focus.
 *
 * Only the visual viewport is read, never `--keyboard-height`: that one changes with no event
 * to hear it by, and a size computed from it once stayed after the keyboard had gone (1.19.1).
 * A viewport that has not shrunk leaves the container exactly as Obsidian made it.
 *
 * @param root - An element inside the dialog. The dialog and its container are found from it.
 */
export function useKeyboardRoom(root: Readonly<Ref<HTMLElement | null | undefined>>): void {
  let win: Window | null = null
  let doc: Document | null = null
  // The container carrying a fit of ours, if any: only then is there anything of ours to undo.
  let fitted: HTMLElement | null = null

  // Found each time rather than once on mounting: Obsidian may not have finished putting the
  // dialog together when this component mounts inside it.
  const dialog = () => root.value?.closest<HTMLElement>('.modal') ?? null
  const container = () => root.value?.closest<HTMLElement>('.modal-container') ?? null

  const release = () => {
    if (!fitted) return
    fitted.classList.remove(FITTED)
    fitted.style.removeProperty('--abele-room-top')
    fitted.style.removeProperty('--abele-room-height')
    fitted = null
  }

  const reveal = () => {
    const box = dialog()
    const active = box?.ownerDocument.activeElement
    // Not `instanceof HTMLElement`: a dialog opened from the settings window lives in that
    // window's document, whose elements belong to another realm.
    if (!box || !active || active === box || !box.contains(active)) return
    active.scrollIntoView({ block: 'center' })
  }

  const fit = () => {
    // Measured as Obsidian left it, so that a keyboard going away gives the room back.
    release()

    const box = container()
    const viewport = win?.visualViewport
    if (box && viewport) {
      const rect = box.getBoundingClientRect()
      const top = Math.max(rect.top, viewport.offsetTop)
      const bottom = Math.min(rect.bottom, viewport.offsetTop + viewport.height)
      const covered = top > rect.top + 1 || bottom < rect.bottom - 1
      if (covered && bottom - top > 0) {
        box.style.setProperty('--abele-room-top', `${top}px`)
        box.style.setProperty('--abele-room-height', `${bottom - top}px`)
        box.classList.add(FITTED)
        fitted = box
      }
    }

    reveal()
  }

  const onFocusIn = (event: FocusEvent) => {
    const box = dialog()
    if (!box || !(event.target as Node | null) || !box.contains(event.target as Node)) return
    // After the focus has landed and the platform has had its chance to scroll first. A
    // timeout rather than a frame: a window in the background draws no frames at all.
    win?.setTimeout(reveal, 50)
  }

  onMounted(() => {
    const el = root.value
    if (!el) return
    doc = el.ownerDocument
    win = doc.defaultView
    if (!win) return

    win.visualViewport?.addEventListener('resize', fit)
    win.visualViewport?.addEventListener('scroll', fit)
    win.addEventListener('resize', fit)
    doc.addEventListener('focusin', onFocusIn)
    fit()
  })

  onBeforeUnmount(() => {
    win?.visualViewport?.removeEventListener('resize', fit)
    win?.visualViewport?.removeEventListener('scroll', fit)
    win?.removeEventListener('resize', fit)
    doc?.removeEventListener('focusin', onFocusIn)
    release()
    win = null
    doc = null
  })
}
