/**
 * E-ink mode: the reader made for a screen of electronic paper — a Boox, a Kindle-like tablet
 * running Obsidian — rather than for glass.
 *
 * Such a screen redraws slowly and leaves a ghost of what was there before, and shows no colour or
 * only a washed-out one. So in this mode the pages are turned, never scrolled or slid, and nothing
 * moves or fades; the text is black on white, nothing is grey; a highlight is told by the shape of
 * its line rather than by a pale fill of colour; the left and right thirds of the page turn it; a
 * full black-and-white flash every so many pages can clear the ghosting; and the page keys such a
 * device has turn the pages.
 *
 * It is a choice of the device, not of the vault: the same vault is read on a phone and on the
 * reader, and only the reader wants it. So it is kept in Obsidian's local storage — per vault, on
 * this device — and neither the settings file nor the settings transfer carries it.
 */
import { reactive, watch } from 'vue'
import type { ReaderSettings, ThemeValues } from './settings'
import type { HighlightColor } from './highlights'

/** What this device keeps for e-ink mode. */
export interface EinkState {
  /** The mode is on, on this device. */
  on: boolean
  /** A full black-and-white flash every so many page turns, to clear the ghosting; 0 never. */
  refreshEvery: number
  /** The last key the reader heard is shown over the page, and every key is logged. */
  showKeys: boolean
}

/** Where it is kept, by `App.saveLocalStorage` — which keeps it per vault on this device. */
export const EINK_KEY = 'abele-reader-eink'
/** The choices of how often the page flashes. */
export const REFRESH_EVERY = [0, 5, 10, 20, 50] as const
/** The class a book tab carries while the mode is on: every e-ink style hangs off it. */
export const EINK_CLASS = 'abele-book_eink'
/**
 * The class the app's body carries while the mode is on: what floats over a book from outside
 * it — the quick button — holds still by it too.
 */
export const EINK_BODY_CLASS = 'abele-eink'
/** The share of the page's width, from either edge, a tap turns the page in. */
export const TAP_SHARE = 0.25
export const EINK_TAP_SHARE = 1 / 3

export const DEFAULT_EINK: EinkState = { on: false, refreshEvery: 0, showKeys: false }

/** The state as stored, made whole: anything unknown is the default. */
export function einkStateFrom(stored: unknown): EinkState {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<EinkState>
  return {
    on: s.on === true,
    refreshEvery:
      typeof s.refreshEvery === 'number' &&
      (REFRESH_EVERY as readonly number[]).includes(s.refreshEvery)
        ? s.refreshEvery
        : DEFAULT_EINK.refreshEvery,
    showKeys: s.showKeys === true,
  }
}

interface LocalStore {
  loadLocalStorage(key: string): unknown
  saveLocalStorage(key: string, value: unknown): void
}

/** The last key heard, while the keys are shown: what it was called, and where it arrived. */
export interface HeardKey {
  key: string
  code: string
  keyCode: number
  /** Where it arrived: the page, or the tab around it. */
  where: string
  /** What the reader did with it: the way it turned, or nothing. */
  way: PageWay | null
  at: number
}

const state = reactive<EinkState & { heard: HeardKey | null }>({ ...DEFAULT_EINK, heard: null })
let store: LocalStore | null = null

/** Reads this device's choice; called once, as the reader is registered. */
export function initEink(app: LocalStore | null): void {
  store = app
  Object.assign(state, einkStateFrom(app?.loadLocalStorage(EINK_KEY)), { heard: null })
}

/** This device's e-ink state, reactive: the reader's tabs and dialogs follow it. */
export function eink(): Readonly<EinkState & { heard: HeardKey | null }> {
  return state
}

/** Changes this device's choice and keeps it, on this device only. */
export function setEink(patch: Partial<EinkState>): void {
  const next = einkStateFrom({ ...einkStateFrom(state), ...patch })
  Object.assign(state, next)
  if (!next.showKeys) state.heard = null
  // Nothing is kept while it is all the default: a device that never used the mode has no entry.
  const plain = !next.on && !next.showKeys && next.refreshEvery === DEFAULT_EINK.refreshEvery
  store?.saveLocalStorage(EINK_KEY, plain ? null : next)
}

/**
 * A book tab following the mode: it carries `EINK_CLASS` while the mode is on, and `changed` is
 * called whenever the mode is switched — not for the keys shown or the flash. Returns the stop.
 */
export function followEink(
  el: HTMLElement,
  changed: (on: boolean) => void,
  cls = EINK_CLASS
): () => void {
  el.classList.toggle(cls, state.on)
  return watch(
    () => state.on,
    (on) => {
      el.classList.toggle(cls, on)
      changed(on)
    }
  )
}

/**
 * The reader's settings as this device reads them: in e-ink mode pages are turned, never
 * scrolled — a PDF's too — and the page is drawn in the reader's colours, never dark.
 */
export function withEink(settings: ReaderSettings, on: boolean): ReaderSettings {
  if (!on) return settings
  return {
    ...settings,
    flow: 'paginated',
    pdfLayout: 'paginated',
    themeColors: true,
    pdfDarkPages: false,
  }
}

/**
 * The colours a page is drawn in, in e-ink mode: the platform's own paper and ink under a light
 * scheme — black on white — whatever the theme, and links in the ink too, told by their
 * underline. Words selected are the ink itself, the text on them turned to paper.
 */
export function einkTheme(theme: ThemeValues): ThemeValues {
  return {
    ...theme,
    text: 'CanvasText',
    background: 'Canvas',
    accent: 'CanvasText',
    selection: 'CanvasText',
    dark: false,
  }
}

/** What an e-ink page is given over the reader's own style: nothing grey, links underlined. */
export const EINK_PAGE_STYLE = `
  html { color-scheme: light !important; }
  body * { opacity: 1 !important; text-shadow: none !important; }
  a:any-link { text-decoration: underline !important; }
  ::selection { color: Canvas !important; }
  * { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
`

/** Which way a key turns the page: through the book, or towards a side of the screen. */
export type PageWay = 'next' | 'prev' | 'left' | 'right'

type KeyLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'keyCode' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'
>

/**
 * The page key of a keyboard, a remote or a reader's own buttons, and which way it turns.
 *
 * The arrows left and right turn towards their side of the screen; Page Up and Down, the space
 * bar (Shift with it back) and — where pages are turned, not scrolled — the arrows up and down go
 * through the book. In e-ink mode the keys a reader's page buttons may be set to send are heard
 * too: the volume keys (when the app is handed them) and the media track keys. A key held with
 * Mod, Ctrl or Alt is a shortcut, never a page turn.
 */
export function pageKeyWay(e: KeyLike, opts: { eink: boolean; paged: boolean }): PageWay | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  // A key the browser has no name for may still carry the classic code of Page Up or Down.
  const key = e.key === 'Unidentified' || !e.key ? byKeyCode(e.keyCode) : e.key
  switch (key) {
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    case 'PageUp':
      return 'prev'
    case 'PageDown':
      return 'next'
    case ' ':
    case 'Spacebar':
      return e.shiftKey ? 'prev' : 'next'
    case 'ArrowUp':
      return opts.paged || opts.eink ? 'prev' : null
    case 'ArrowDown':
      return opts.paged || opts.eink ? 'next' : null
  }
  if (!opts.eink) return null
  switch (key) {
    case 'AudioVolumeUp':
    case 'VolumeUp':
    case 'MediaTrackPrevious':
    case 'MediaRewind':
      return 'prev'
    case 'AudioVolumeDown':
    case 'VolumeDown':
    case 'MediaTrackNext':
    case 'MediaFastForward':
      return 'next'
  }
  return null
}

const byKeyCode = (code: number): string =>
  ({
    33: 'PageUp',
    34: 'PageDown',
    37: 'ArrowLeft',
    38: 'ArrowUp',
    39: 'ArrowRight',
    40: 'ArrowDown',
  })[code] ?? ''

/** Notes a key the reader heard, while the keys are shown: over the page, and in the console. */
export function heardKey(e: KeyLike, where: string, way: PageWay | null): void {
  if (!state.showKeys) return
  const heard = { key: e.key, code: e.code, keyCode: e.keyCode, where, way, at: Date.now() }
  state.heard = heard
  console.debug('[Abele] e-ink: key', heard)
}

/**
 * How an e-ink highlight is drawn: a black line whose shape says its colour, since a grey screen
 * cannot. Each colour a shape of its own; a note's link keeps its dotted line.
 */
export type EinkShape = 'underline' | 'double' | 'dashed' | 'box' | 'dashed-box' | 'over-under'

const SHAPES: Record<HighlightColor, EinkShape> = {
  yellow: 'underline',
  green: 'double',
  blue: 'dashed',
  pink: 'box',
  purple: 'dashed-box',
  orange: 'over-under',
}

export function einkShape(color: HighlightColor): EinkShape {
  return SHAPES[color] ?? 'underline'
}

/** Whether this page turn is one the page flashes on: every `every` turns, never for 0. */
export function flashDue(turns: number, every: number): boolean {
  return every > 0 && turns > 0 && turns % every === 0
}
