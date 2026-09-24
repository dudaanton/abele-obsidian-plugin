/**
 * The reader's settings and what they turn into (`src/reader/settings.ts`).
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_READER_SETTINGS,
  layoutAttributes,
  pageStyles,
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

  it("keep 0 as the book's own line spacing", () => {
    expect(readerSettingsFrom({ lineHeight: 0 }).lineHeight).toBe(0)
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
