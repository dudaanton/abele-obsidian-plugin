/**
 * What the page can learn about the on-screen keyboard: the shared vocabulary of the dialog
 * shell's keyboard room (`keyboardRoom.ts`), the quick button and the diagnostics panel.
 */

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
export const TYPED =
  'textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]):not([type="color"]):not([type="file"])'

/**
 * A field that brings a scroller of its own: Obsidian's note editor, put into forms as a note
 * field. What is scrolled to keep it above the keyboard is the dialog around it, never the
 * editor's own box — room given to that one left the field itself under the keyboard, with
 * nothing that could scroll it out (2026-09-27, a form an agent made, on the iPhone).
 */
export const FIELD_WIDGET = '.cm-editor'

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
  /** The top of Obsidian's editing toolbar over the keyboard, while it shows. */
  toolbarTop?: number | null
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

export function fullHeight(win: Window): number {
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
 * The top of Obsidian's editing toolbar, where it stands over the keyboard; null while it is not
 * shown. It comes up for the note field of a form, a row of buttons between the field and the
 * keyboard, and a field scrolled to just above the keyboard was behind it.
 */
export function toolbarTop(doc: Document): number | null {
  const bar = doc.querySelector<HTMLElement>('.mobile-toolbar')
  if (!bar || !doc.body.classList.contains('is-mobile')) return null
  const view = doc.defaultView
  const style = view?.getComputedStyle(bar)
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return null
  const rect = bar.getBoundingClientRect()
  return rect.height > 0 ? rect.top : null
}

/**
 * Where the caret of the field is, or the field itself where it has no caret to ask about.
 * A note field is a box many lines tall: bringing the whole of it into sight put its first line
 * there and left the line being typed under the keyboard.
 */
export function caretRect(field: Element): { top: number; bottom: number } {
  const whole = field.getBoundingClientRect()
  if (!field.matches('[contenteditable="true"]')) return whole
  const selection = field.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return whole
  const range = selection.getRangeAt(0)
  if (!field.contains(range.endContainer)) return whole
  const rects = range.getClientRects?.()
  const last = rects && rects.length ? rects[rects.length - 1] : range.getBoundingClientRect?.()
  if (!last || (last.height === 0 && last.top === 0)) {
    // A collapsed caret at the start of an empty line has no rect; its line does.
    const node = range.endContainer
    const line = (node.nodeType === 1 ? (node as Element) : node.parentElement) ?? field
    const rect = line.getBoundingClientRect()
    return rect.height > 0 ? rect : whole
  }
  return { top: last.top, bottom: last.bottom }
}
