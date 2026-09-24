/**
 * The book reader's settings, kept under `reader` in the plugin's settings, and what they turn
 * into: the attributes the engine lays pages out by, and the style every page is given.
 *
 * Everything here is pure, so the translation from a setting to a page is tested without a book.
 */

export type ReaderFlow = 'paginated' | 'scrolled'
export type ReaderFont = 'theme' | 'serif' | 'sans' | 'book'
export type ReaderMargin = 'narrow' | 'normal' | 'wide'
/** How a PDF page is sized: to fit the tab whole, to fit its width, or at a fixed zoom. */
export type PdfZoom = 'fit-page' | 'fit-width' | '1' | '1.25' | '1.5' | '2'
export const PDF_ZOOMS: readonly PdfZoom[] = ['fit-page', 'fit-width', '1', '1.25', '1.5', '2']

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
  /** PDF files open in the book reader rather than in Obsidian's own PDF viewer. */
  openPdf: boolean
  /** How a PDF page is sized. */
  pdfZoom: PdfZoom
  /** Two PDF pages side by side when the tab is wide enough. */
  pdfTwoPages: boolean
  /** In a dark theme, PDF pages are shown with their light and dark swapped. */
  pdfDarkPages: boolean
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  flow: 'paginated',
  font: 'theme',
  fontSize: 100,
  lineHeight: 1.5,
  margin: 'normal',
  maxWidth: 720,
  columns: 2,
  themeColors: true,
  openPdf: false,
  pdfZoom: 'fit-page',
  pdfTwoPages: false,
  pdfDarkPages: true,
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
    openPdf: typeof s.openPdf === 'boolean' ? s.openPdf : d.openPdf,
    pdfZoom: oneOf(s.pdfZoom, PDF_ZOOMS, d.pdfZoom),
    pdfTwoPages: typeof s.pdfTwoPages === 'boolean' ? s.pdfTwoPages : d.pdfTwoPages,
    pdfDarkPages: typeof s.pdfDarkPages === 'boolean' ? s.pdfDarkPages : d.pdfDarkPages,
  }
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
