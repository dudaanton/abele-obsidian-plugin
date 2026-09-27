/**
 * Zen mode: the book's text and nothing else on screen. The tab's header, the reader's row under
 * the page and, on a phone, Obsidian's own navigation bar go, and the page takes their room; they
 * come back for a moment ("a peek") when asked — a tap in the middle of the page on a phone or a
 * tablet, the mouse at the top of the tab on a computer — and the mode is left from the tab's
 * menu, the command, or Esc.
 *
 * Words selected still bring up the bar for them, over the page rather than under it, so the page
 * is laid out once as the mode is switched and never again for a bar or a peek.
 *
 * Like e-ink mode it is the device's own choice, kept in Obsidian's local storage — per vault, on
 * this device — and neither the settings file nor the settings transfer carries it: the phone
 * may read in zen while the computer beside it does not.
 */
import { reactive, watch } from 'vue'
import type { BookModel } from './model'

/** What this device keeps for zen mode. */
export interface ZenState {
  on: boolean
}

/** Where it is kept, by `App.saveLocalStorage` — per vault, on this device. */
export const ZEN_KEY = 'abele-reader-zen'
/** The class a book tab's leaf carries while the mode is on: every zen style hangs off it. */
export const ZEN_CLASS = 'abele-book_zen'
/** The class it carries while the chrome is shown for a moment. */
export const ZEN_PEEK_CLASS = 'abele-book_zen-peek'
/** How long a peek lasts before the chrome goes again by itself. */
export const PEEK_MS = 4000
/** How long after the mouse leaves the header and the row under the page they go on a computer. */
export const PEEK_LEAVE_MS = 800

export const DEFAULT_ZEN: ZenState = { on: false }

/** The state as stored, made whole: anything unknown is the default. */
export function zenStateFrom(stored: unknown): ZenState {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<ZenState>
  return { on: s.on === true }
}

interface LocalStore {
  loadLocalStorage(key: string): unknown
  saveLocalStorage(key: string, value: unknown): void
}

const state = reactive<ZenState>({ ...DEFAULT_ZEN })
let store: LocalStore | null = null

/** Reads this device's choice; called once, as the reader is registered. */
export function initZen(app: LocalStore | null): void {
  store = app
  Object.assign(state, zenStateFrom(app?.loadLocalStorage(ZEN_KEY)))
}

/** This device's zen state, reactive: the reader's tabs follow it. */
export function zen(): Readonly<ZenState> {
  return state
}

/** Switches the mode on this device and keeps it there; off leaves no entry behind. */
export function setZen(on: boolean): void {
  state.on = on
  store?.saveLocalStorage(ZEN_KEY, on ? { on } : null)
}

/** Calls `changed` whenever the mode is switched. Returns the stop. */
export function followZen(changed: (on: boolean) => void): () => void {
  return watch(() => state.on, changed)
}

type Busy = Pick<
  BookModel,
  | 'selection'
  | 'active'
  | 'selecting'
  | 'ink'
  | 'panel'
  | 'settingsOpen'
  | 'footnote'
  | 'figure'
  | 'commenting'
  | 'zenPeek'
>

/**
 * Whether the row under the page shows in zen mode: while the chrome is peeked at, while drawing
 * on a PDF, and for the bar over words selected or a highlight tapped, once the finger or the
 * mouse has let go of them.
 */
export function zenFootShown(m: Busy): boolean {
  return m.zenPeek || m.ink.on || (!!(m.selection || m.active) && !m.selecting)
}

/** Whether Esc leaves the mode: only when it has nothing nearer to close. */
export function escLeavesZen(m: Busy): boolean {
  return !(
    m.selection ||
    m.active ||
    m.ink.on ||
    m.panel ||
    m.settingsOpen ||
    m.footnote ||
    m.figure ||
    m.commenting
  )
}

/**
 * Whether Obsidian's own navigation — a phone's header and bar under the tabs — is to be hidden
 * for this tab: the mode on, the tab in front, on a phone, and no peek.
 */
export function navHidden(o: { on: boolean; front: boolean; phone: boolean; peek: boolean }) {
  return o.on && o.front && o.phone && !o.peek
}

/** Top and bottom of a box, in the window. */
export interface Band {
  top: number
  bottom: number
}

/**
 * Whether the bar for words selected, or a highlight tapped, goes to the top of the page rather
 * than its foot: when at the foot, `foot` tall, it would cover them, and at the top it would not.
 * Words at both ends leave nowhere free, and the bar stays where it always is.
 */
export function zenFootAtTop(words: Band[], page: Band, foot: number): boolean {
  if (!words.length || !(foot > 0)) return false
  const low = words.some((w) => w.bottom > page.bottom - foot)
  const high = words.some((w) => w.top < page.top + foot)
  return low && !high
}
