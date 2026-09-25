/**
 * A page laid out anew once its fonts arrive (`src/reader/pageLayout.ts`): the columns' width
 * nudged and put back as it was, important and all, and nothing done to a page not in columns.
 */
import { describe, it, expect } from 'vitest'
import { relayoutColumns, relayoutOnFonts } from '@/reader/pageLayout'

function page(width?: string): Document {
  const doc = document.implementation.createHTMLDocument('page')
  if (width) doc.documentElement.style.setProperty('column-width', width, 'important')
  return doc
}

describe('laying a page out again', () => {
  it('nudges the column width and puts it back exactly, important included', () => {
    const doc = page('612px')
    const seen: string[] = []
    Object.defineProperty(doc.documentElement, 'offsetHeight', {
      get: () => (seen.push(doc.documentElement.style.getPropertyValue('column-width')), 0),
    })
    expect(relayoutColumns(doc)).toBe(true)
    expect(seen).toEqual(['613px', '612px'])
    expect(doc.documentElement.style.getPropertyValue('column-width')).toBe('612px')
    expect(doc.documentElement.style.getPropertyPriority('column-width')).toBe('important')
  })

  it('leaves a scrolled page, and one the engine has not laid out, alone', () => {
    expect(relayoutColumns(page('auto'))).toBe(false)
    expect(relayoutColumns(page())).toBe(false)
  })

  it('does it each time the fonts finish loading', async () => {
    const doc = page('500px')
    const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() })
    Object.defineProperty(doc, 'fonts', { value: fonts })
    Object.defineProperty(doc, 'defaultView', { value: window })
    let layouts = 0
    Object.defineProperty(doc.documentElement, 'offsetHeight', { get: () => (layouts++, 0) })
    relayoutOnFonts(doc)
    await Promise.resolve()
    expect(layouts).toBe(2)
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(layouts).toBe(4)
  })
})
