/**
 * The book reader's settings, kept under `reader` in the plugin's settings, and what they turn
 * into: the attributes the engine lays pages out by, and the style every page is given.
 *
 * Everything here is pure, so the translation from a setting to a page is tested without a book.
 */
import { PROGRESS_SHOWS, type ProgressShow } from './readingProgress'

export type ReaderFlow = 'paginated' | 'scrolled'
export type ReaderFont = 'theme' | 'serif' | 'sans' | 'book'
export type ReaderMargin = 'narrow' | 'normal' | 'wide'
/** How a PDF page is sized: to fit the tab whole, to fit its width, or at a fixed zoom. */
export type PdfZoom = 'auto' | 'fit-page' | 'fit-width' | '1' | '1.25' | '1.5' | '2'
export const PDF_ZOOMS: readonly PdfZoom[] = [
  'auto',
  'fit-page',
  'fit-width',
  '1',
  '1.25',
  '1.5',
  '2',
]

export interface ReaderSettings {
  /** Pages turned one at a time, or the chapter as one long scroll. */
  flow: ReaderFlow
  /** Obsidian's text font, a serif, a sans-serif, or whatever the book asks for. */
  font: ReaderFont
  /** Text size, in percent of the book's own. */
  fontSize: number
  /** Line spacing, as a multiple of the text size; 0 keeps the book's own. */
  lineHeight: number
  /** The space around and between columns. */
  margin: ReaderMargin
  /** The widest a column of text may grow, in pixels. */
  maxWidth: number
  /** How many columns side by side when the tab is wide enough: 1 or 2. */
  columns: 1 | 2
  /** Draw the book in the theme's text and background colours instead of its own. */
  themeColors: boolean
  /**
   * PDF files open in the book reader rather than in Obsidian's own PDF viewer. On by default. It
   * was `openPdf`, off by default, before; every setting is saved whole, so a stored `openPdf:
   * false` is mostly that default rather than a choice, and is not read.
   */
  pdfInReader: boolean
  /** A PDF as one continuous scroll, page under page, or as pages turned one at a time. */
  pdfLayout: ReaderFlow
  /** How a PDF page is sized. */
  pdfZoom: PdfZoom
  /** Two PDF pages side by side when the tab is wide enough. */
  pdfTwoPages: boolean
  /** In a dark theme, PDF pages are shown with their light and dark swapped. */
  pdfDarkPages: boolean
  /** The voice books are read aloud in, by its `voiceURI`; empty for the device's own for the book. */
  ttsVoice: string
  /** How fast books are read aloud: 1 is the voice's own pace. */
  ttsRate: number
  /** What the measure beside the progress line shows; a tap on it goes to the next. */
  progressShow: ProgressShow
  /**
   * The file in the vault where each book was left is kept, so every device reads the same one.
   * As typed; `placesPathOf` is the path in use.
   */
  placesPath: string
  /** Where highlights go: a note of each book's own beside it, or one note, `notesPath`. */
  notesTo: NotesTo
  /** The note highlights go to when they go to one note, as typed. */
  notesPath: string
  /** A note that new highlights notes are made from, as typed; empty for none. */
  notesTemplate: string
  /** A book's own choice of the three above, by its key (`bookKey`); what it leaves out is as above. */
  bookNotes: Record<string, BookNotesChoice>
}

export type NotesTo = 'book' | 'note'

/** One book's choice of where its highlights go: a field left out is the choice for every book. */
export interface BookNotesChoice {
  notesTo?: NotesTo
  notesPath?: string
  notesTemplate?: string
}

/** Where one book's highlights go, all said: the note's path and the template's are tidied. */
export interface BookNotesTarget {
  to: NotesTo
  /** The note, when they go to one note. */
  path: string
  /** The template note; empty for none. */
  template: string
  /**
   * The other notes the settings name — the one for every book, and the book's own — where its
   * highlights may be from before the choice changed; they are still read.
   */
  alsoIn: string[]
}

/** The one note highlights go to unless another is named. */
export const DEFAULT_NOTES_PATH = 'Book notes.md'

/**
 * Where the places of books are kept unless said otherwise: a JSON file at the root of the vault.
 * Obsidian's file list shows no `.json` file, so it stays out of sight; Obsidian Sync carries it
 * with "Sync all other types" on, as it does chats (`.abchat`). A hidden file would be out of
 * sight as well, but Obsidian Sync never carries a hidden one.
 */
export const DEFAULT_PLACES_PATH = 'abele-book-places.json'

export const TTS_RATES = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  flow: 'paginated',
  font: 'theme',
  fontSize: 100,
  lineHeight: 1.5,
  margin: 'normal',
  maxWidth: 720,
  columns: 2,
  themeColors: true,
  pdfInReader: true,
  pdfLayout: 'scrolled',
  pdfZoom: 'auto',
  pdfTwoPages: false,
  pdfDarkPages: true,
  ttsVoice: '',
  ttsRate: 1,
  progressShow: 'page',
  placesPath: DEFAULT_PLACES_PATH,
  notesTo: 'book',
  notesPath: DEFAULT_NOTES_PATH,
  notesTemplate: '',
  bookNotes: {},
}

export const FONT_SIZES = [70, 80, 90, 100, 110, 120, 135, 150, 175, 200]
export const LINE_HEIGHTS = [0, 1.2, 1.35, 1.5, 1.65, 1.8, 2]
export const MAX_WIDTHS = [480, 600, 720, 840, 1000, 1400]

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback

/** Settings as stored, made whole and brought within range. */
export function readerSettingsFrom(stored?: Partial<ReaderSettings> | null): ReaderSettings {
  const s = stored ?? {}
  const d = DEFAULT_READER_SETTINGS
  return {
    flow: oneOf(s.flow, ['paginated', 'scrolled'] as const, d.flow),
    font: oneOf(s.font, ['theme', 'serif', 'sans', 'book'] as const, d.font),
    fontSize: clamp(s.fontSize, 50, 300, d.fontSize),
    lineHeight: s.lineHeight === 0 ? 0 : clamp(s.lineHeight, 1, 3, d.lineHeight),
    margin: oneOf(s.margin, ['narrow', 'normal', 'wide'] as const, d.margin),
    maxWidth: clamp(s.maxWidth, 300, 3000, d.maxWidth),
    columns: s.columns === 1 ? 1 : 2,
    themeColors: typeof s.themeColors === 'boolean' ? s.themeColors : d.themeColors,
    pdfInReader: typeof s.pdfInReader === 'boolean' ? s.pdfInReader : d.pdfInReader,
    pdfLayout: oneOf(s.pdfLayout, ['paginated', 'scrolled'] as const, d.pdfLayout),
    pdfZoom: oneOf(s.pdfZoom, PDF_ZOOMS, d.pdfZoom),
    pdfTwoPages: typeof s.pdfTwoPages === 'boolean' ? s.pdfTwoPages : d.pdfTwoPages,
    pdfDarkPages: typeof s.pdfDarkPages === 'boolean' ? s.pdfDarkPages : d.pdfDarkPages,
    ttsVoice: typeof s.ttsVoice === 'string' ? s.ttsVoice : d.ttsVoice,
    ttsRate: clamp(s.ttsRate, 0.5, 3, d.ttsRate),
    progressShow: oneOf(s.progressShow, PROGRESS_SHOWS, d.progressShow),
    placesPath: typeof s.placesPath === 'string' ? s.placesPath : d.placesPath,
    notesTo: oneOf(s.notesTo, NOTES_TO, d.notesTo),
    notesPath: typeof s.notesPath === 'string' ? s.notesPath : d.notesPath,
    notesTemplate: typeof s.notesTemplate === 'string' ? s.notesTemplate : d.notesTemplate,
    bookNotes: bookNotesFrom(s.bookNotes),
  }
}

const NOTES_TO = ['book', 'note'] as const

/** One book's choice as stored, without what is no choice; null when nothing is left. */
function choiceFrom(value: unknown): BookNotesChoice | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const out: BookNotesChoice = {}
  if ((NOTES_TO as readonly unknown[]).includes(v.notesTo)) out.notesTo = v.notesTo as NotesTo
  if (typeof v.notesPath === 'string') out.notesPath = v.notesPath
  if (typeof v.notesTemplate === 'string') out.notesTemplate = v.notesTemplate
  return Object.keys(out).length ? out : null
}

function bookNotesFrom(value: unknown): Record<string, BookNotesChoice> {
  const out: Record<string, BookNotesChoice> = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, choice] of Object.entries(value as Record<string, unknown>)) {
    const kept = choiceFrom(choice)
    if (kept) out[key] = kept
  }
  return out
}

/**
 * A note's path as typed, tidied: `.md` added when it does not end so, and empty when it is no
 * note Obsidian Sync would carry — a part of it hidden, the vault's settings folder included.
 */
export function notePathOf(typed: string): string {
  const path = typed.trim().replace(/\\/g, '/').split('/').filter(Boolean).join('/')
  if (!path || path.split('/').some((p) => p.startsWith('.'))) return ''
  return /\.md$/i.test(path) ? path : `${path}.md`
}

/** Where the highlights of the book kept under `key` go: its own choice over everyone's. */
export function notesTargetFor(settings: ReaderSettings, key: string): BookNotesTarget {
  const own = settings.bookNotes[key] ?? {}
  const typedPath = own.notesPath?.trim() ? own.notesPath : settings.notesPath
  const typedTemplate = own.notesTemplate?.trim() ? own.notesTemplate : settings.notesTemplate
  const to = own.notesTo ?? settings.notesTo
  const path = notePathOf(typedPath) || notePathOf(settings.notesPath) || DEFAULT_NOTES_PATH
  const named = [
    notePathOf(settings.notesPath) || DEFAULT_NOTES_PATH,
    notePathOf(own.notesPath ?? ''),
  ]
  const alsoIn = named.filter(
    (p, i) => p && named.indexOf(p) === i && !(to === 'note' && p === path)
  )
  return { to, path, template: notePathOf(typedTemplate), alsoIn }
}

/** The books' choices with one book's set anew; a choice of nothing forgets the book. */
export function withBookNotes(
  all: Record<string, BookNotesChoice>,
  key: string,
  choice: BookNotesChoice
): Record<string, BookNotesChoice> {
  const out = { ...all }
  const kept = choiceFrom(choice)
  if (kept) out[key] = kept
  else delete out[key]
  return out
}

/** The choices with a book kept by its path moved to its new path; null when there is none. */
export function renamedBookNotes(
  all: Record<string, BookNotesChoice>,
  oldPath: string,
  newPath: string
): Record<string, BookNotesChoice> | null {
  const from = `path:${oldPath}`
  if (!(from in all)) return null
  const out: Record<string, BookNotesChoice> = {}
  for (const [key, choice] of Object.entries(all))
    out[key === from ? `path:${newPath}` : key] = choice
  return out
}

/**
 * The file the places are kept in: the path set, tidied, once it is a `.json` file in the vault
 * that Obsidian Sync can carry — no part of it hidden, the vault's settings folder included —
 * and the default until then, a path half typed included.
 */
export function placesPathOf(settings: ReaderSettings): string {
  const path = settings.placesPath.trim().replace(/\\/g, '/').split('/').filter(Boolean).join('/')
  const parts = path.split('/')
  const fine = /\.json$/i.test(path) && path.length > 5 && parts.every((p) => !p.startsWith('.'))
  return fine ? path : DEFAULT_PLACES_PATH
}

/** The engine's layout attributes for these settings. */
export function layoutAttributes(
  settings: ReaderSettings,
  phone: boolean
): Record<'flow' | 'gap' | 'margin' | 'max-inline-size' | 'max-column-count', string> {
  const gap = { narrow: 4, normal: 7, wide: 12 }[settings.margin]
  // The band above and below the text, where the engine would print running heads. On a phone
  // Obsidian's own header and bar already take that room, so the text starts close to them.
  const margin = phone
    ? { narrow: 8, normal: 16, wide: 28 }[settings.margin]
    : { narrow: 24, normal: 40, wide: 64 }[settings.margin]
  return {
    flow: settings.flow,
    gap: `${phone ? Math.max(gap, 6) : gap}%`,
    margin: `${margin}px`,
    'max-inline-size': `${settings.maxWidth}px`,
    'max-column-count': String(settings.columns),
  }
}

/** The theme's values a page needs, read as literals: a page frame cannot see Obsidian's variables. */
export interface ThemeValues {
  text: string
  background: string
  accent: string
  selection: string
  fontText: string
  dark: boolean
}

const FONT_STACKS: Record<Exclude<ReaderFont, 'book' | 'theme'>, string> = {
  serif: 'Charter, "Iowan Old Style", Georgia, Cambria, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
}

/** A CSS string value made safe to put inside a stylesheet. */
const cssText = (value: string) => value.replace(/[<>{};]/g, '')

/**
 * The style every page is given, as the pair the engine takes: the first goes before the book's
 * own stylesheets, as defaults the book may override; the second after, as what it may not.
 */
export function pageStyles(settings: ReaderSettings, theme: ThemeValues): [string, string] {
  const family =
    settings.font === 'theme'
      ? cssText(theme.fontText) || FONT_STACKS.serif
      : settings.font === 'book'
        ? ''
        : FONT_STACKS[settings.font]
  const before = `
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${settings.themeColors && theme.dark ? 'dark' : 'light'}; }
    body { overflow-wrap: break-word; }
    img, svg, video { max-width: 100%; height: auto; }
    /* Notes open in a window of their own when their mark is tapped, as in Apple Books. */
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"],
    aside[epub|type~="rearnote"], aside[role="doc-footnote"] { display: none; }
  `
  const rules: string[] = []
  rules.push(
    `html { font-size: ${settings.fontSize}% !important; -webkit-text-size-adjust: none; }`
  )
  if (family)
    rules.push(
      `html, body, p, li, blockquote, dd, div, span { font-family: ${family} !important; }`
    )
  if (settings.lineHeight)
    rules.push(`p, li, blockquote, dd, div { line-height: ${settings.lineHeight} !important; }`)
  if (settings.themeColors) {
    rules.push(
      `html, body { color: ${cssText(theme.text)} !important; background: transparent !important; }`,
      `body *:not(a):not(img):not(svg):not(svg *) { color: inherit !important; background-color: transparent !important; border-color: currentColor !important; }`,
      `a:any-link { color: ${cssText(theme.accent)} !important; }`,
      `::selection { background: ${cssText(theme.selection)}; }`
    )
    // Line art is often dark lines on transparency, made for white paper: on a dark theme's
    // background it vanishes. Pictures get the paper back; an opaque one covers it anyway. The
    // figure viewer does the same.
    if (theme.dark)
      rules.push(`img, svg:not(svg svg) { background-color: #fff !important; border-radius: 2px; }`)
  }
  // The book's own colours, on paper: a book that sets none is dark text on light, whatever the
  // theme, rather than dark text on a dark theme's background. Before the book's styles, so its
  // own colours win.
  const paper = settings.themeColors ? '' : 'html { background-color: Canvas; color: CanvasText; }'
  return [before + paper, rules.join('\n')]
}

/** The theme's values, read off an element inside it. */
export function themeValues(el: HTMLElement): ThemeValues {
  const style = getComputedStyle(el)
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    text: v('--text-normal', 'CanvasText'),
    background: v('--background-primary', 'Canvas'),
    accent: v('--text-accent', 'LinkText'),
    selection: v('--text-selection', 'Highlight'),
    fontText: v('--font-text', ''),
    dark: el.ownerDocument.body.classList.contains('theme-dark'),
  }
}

/** Whether a PDF's pages are shown with light and dark swapped: asked for, and the theme is dark. */
export function darkPdfPages(settings: ReaderSettings, dark: boolean): boolean {
  return settings.pdfDarkPages && dark
}

/**
 * The zoom a PDF is drawn at: `auto`, the default, is the page's width in the continuous scroll —
 * what a PDF viewer usually shows — and the whole page when pages are turned one at a time.
 */
export function pdfZoomFor(settings: ReaderSettings): Exclude<PdfZoom, 'auto'> {
  if (settings.pdfZoom !== 'auto') return settings.pdfZoom
  return settings.pdfLayout === 'scrolled' ? 'fit-width' : 'fit-page'
}
