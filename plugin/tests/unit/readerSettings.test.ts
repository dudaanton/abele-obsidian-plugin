/**
 * The reader's settings and what they turn into (`src/reader/settings.ts`).
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_READER_SETTINGS,
  darkPdfPages,
  layoutAttributes,
  pageStyles,
  placesPathOf,
  readerSettingsFrom,
  type ThemeValues,
} from '@/reader/settings'

const theme: ThemeValues = {
  text: 'rgb(220, 221, 222)',
  background: 'rgb(30, 30, 30)',
  accent: 'rgb(138, 92, 245)',
  selection: 'rgba(138, 92, 245, 0.25)',
  fontText: 'Inter, sans-serif',
  dark: true,
}

describe('reader settings as stored', () => {
  it('are made whole from nothing', () => {
    expect(readerSettingsFrom(undefined)).toEqual(DEFAULT_READER_SETTINGS)
  })

  it('are brought within range, and unknown values fall back', () => {
    const s = readerSettingsFrom({
      fontSize: 9999,
      lineHeight: -1,
      flow: 'sideways' as never,
      columns: 7 as never,
      maxWidth: Number.NaN,
    })
    expect(s.fontSize).toBe(300)
    expect(s.lineHeight).toBe(1)
    expect(s.flow).toBe('paginated')
    expect(s.columns).toBe(2)
    expect(s.maxWidth).toBe(DEFAULT_READER_SETTINGS.maxWidth)
  })

  it("keep PDFs in Obsidian's viewer, whole pages, one at a time, dark in a dark theme by default", () => {
    const s = readerSettingsFrom({})
    expect(s).toMatchObject({
      openPdf: false,
      pdfZoom: 'auto',
      pdfTwoPages: false,
      pdfDarkPages: true,
    })
    expect(readerSettingsFrom({ pdfZoom: '7' as never }).pdfZoom).toBe('auto')
    // A zoom chosen before stays chosen.
    expect(readerSettingsFrom({ pdfZoom: 'fit-page' }).pdfZoom).toBe('fit-page')
    expect(readerSettingsFrom({ pdfZoom: '1.5' }).pdfZoom).toBe('1.5')
  })

  it("keep 0 as the book's own line spacing", () => {
    expect(readerSettingsFrom({ lineHeight: 0 }).lineHeight).toBe(0)
  })
})

describe('the file the places of books are kept in', () => {
  it('is a JSON file in the vault, at its root by default', () => {
    expect(readerSettingsFrom({}).placesPath).toBe('abele-book-places.json')
    expect(placesPathOf(readerSettingsFrom({}))).toBe('abele-book-places.json')
    expect(placesPathOf(readerSettingsFrom({ placesPath: ' Books//places.json ' }))).toBe(
      'Books/places.json'
    )
  })

  it('is the default until the path is one that can be kept and synced', () => {
    const of = (placesPath: string) => placesPathOf(readerSettingsFrom({ placesPath }))
    // Still being typed, or not a JSON file.
    expect(of('Books/pla')).toBe('abele-book-places.json')
    expect(of('Books/places.md')).toBe('abele-book-places.json')
    // Hidden, which Obsidian Sync never carries, or inside the vault's settings folder.
    expect(of('.abele/places.json')).toBe('abele-book-places.json')
    expect(of('Books/.places.json')).toBe('abele-book-places.json')
    expect(of('.obsidian/places.json')).toBe('abele-book-places.json')
    expect(of('../outside.json')).toBe('abele-book-places.json')
    expect(of('')).toBe('abele-book-places.json')
  })
})

describe('the layout the engine is given', () => {
  it('follows the settings', () => {
    const a = layoutAttributes({ ...DEFAULT_READER_SETTINGS, flow: 'scrolled', columns: 1 }, false)
    expect(a.flow).toBe('scrolled')
    expect(a['max-column-count']).toBe('1')
    expect(a['max-inline-size']).toBe('720px')
  })

  it('keeps the band above the text small on a phone, where Obsidian has its own bars', () => {
    const desk = parseInt(layoutAttributes(DEFAULT_READER_SETTINGS, false).margin)
    const phone = parseInt(layoutAttributes(DEFAULT_READER_SETTINGS, true).margin)
    expect(phone).toBeLessThan(desk)
    expect(phone).toBeLessThanOrEqual(16)
  })
})

describe('the style every page is given', () => {
  it('sets size, spacing and the theme font after the book, so the book cannot undo them', () => {
    const [, after] = pageStyles({ ...DEFAULT_READER_SETTINGS, fontSize: 120 }, theme)
    expect(after).toContain('font-size: 120% !important')
    expect(after).toContain('line-height: 1.5 !important')
    expect(after).toContain('Inter, sans-serif')
  })

  it("leaves the book's font and spacing alone when asked to", () => {
    const [, after] = pageStyles({ ...DEFAULT_READER_SETTINGS, font: 'book', lineHeight: 0 }, theme)
    expect(after).not.toContain('font-family')
    expect(after).not.toContain('line-height')
  })

  it("draws in the theme's colours, dark included", () => {
    const [before, after] = pageStyles(DEFAULT_READER_SETTINGS, theme)
    expect(before).toContain('color-scheme: dark')
    expect(after).toContain(`color: ${theme.text} !important`)
    expect(after).toContain(`color: ${theme.accent} !important`)
  })

  it("puts the book's own colours on paper when theme colours are off", () => {
    const [before, after] = pageStyles({ ...DEFAULT_READER_SETTINGS, themeColors: false }, theme)
    expect(before).toContain('color-scheme: light')
    expect(before).toContain('Canvas')
    expect(after).not.toContain(theme.text)
  })

  it('puts pictures on light paper in a dark theme, where dark line art on transparency vanishes', () => {
    const backdrop = /img, svg:not\(svg svg\) \{ background-color: #fff !important;/
    expect(pageStyles(DEFAULT_READER_SETTINGS, theme)[1]).toMatch(backdrop)
    expect(pageStyles(DEFAULT_READER_SETTINGS, { ...theme, dark: false })[1]).not.toMatch(backdrop)
    // The book's own colours are already on light paper.
    expect(
      pageStyles({ ...DEFAULT_READER_SETTINGS, themeColors: false }, theme).join('')
    ).not.toMatch(backdrop)
  })

  it('cannot be broken out of by a theme value', () => {
    const braces = (css: string) => css.split('{').length + css.split('}').length
    const [, plain] = pageStyles(DEFAULT_READER_SETTINGS, theme)
    const [, after] = pageStyles(DEFAULT_READER_SETTINGS, {
      ...theme,
      fontText: 'x; } body { display: none } a {',
    })
    // No rule of its own: the value stays inside the declaration it was put in.
    expect(braces(after)).toBe(braces(plain))
  })

  it('hides footnotes in the text, which open in a window of their own', () => {
    const [before] = pageStyles(DEFAULT_READER_SETTINGS, theme)
    expect(before).toMatch(/aside\[epub\|type~="footnote"\][^{]*\{ display: none; \}/)
  })
})

describe('PDF pages in a dark theme', () => {
  it('are swapped only when asked and the theme is dark', () => {
    expect(darkPdfPages(DEFAULT_READER_SETTINGS, true)).toBe(true)
    expect(darkPdfPages(DEFAULT_READER_SETTINGS, false)).toBe(false)
    expect(darkPdfPages({ ...DEFAULT_READER_SETTINGS, pdfDarkPages: false }, true)).toBe(false)
  })
})

describe('the zoom a PDF opens at', () => {
  it('is the page width when scrolling and the whole page with pages, unless one was chosen', async () => {
    const { pdfZoomFor } = await import('@/reader/settings')
    const s = DEFAULT_READER_SETTINGS
    expect(pdfZoomFor({ ...s, pdfLayout: 'scrolled' })).toBe('fit-width')
    expect(pdfZoomFor({ ...s, pdfLayout: 'paginated' })).toBe('fit-page')
    expect(pdfZoomFor({ ...s, pdfLayout: 'scrolled', pdfZoom: 'fit-page' })).toBe('fit-page')
    expect(pdfZoomFor({ ...s, pdfZoom: '1.5' })).toBe('1.5')
  })
})
