/**
 * A page laid out anew once its fonts arrive (`src/reader/pageLayout.ts`): the columns' width
 * nudged and put back as it was, important and all, and nothing done to a page not in columns;
 * and what is drawn over the words — highlights — drawn again over where the words now are.
 */
import { describe, it, expect } from 'vitest'
import { redrawOver, relayoutColumns, relayoutOnFonts } from '@/reader/pageLayout'

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

  it('draws what is over the words again each time, on a scrolled page too', async () => {
    const doc = page('auto')
    const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() })
    Object.defineProperty(doc, 'fonts', { value: fonts })
    Object.defineProperty(doc, 'defaultView', { value: window })
    let redraws = 0
    relayoutOnFonts(doc, () => redraws++)
    await Promise.resolve()
    expect(redraws).toBe(1)
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(redraws).toBe(2)
  })

  it('redraws only the overlay of the page whose fonts arrived', () => {
    const doc = page()
    const other = page()
    const drawn: string[] = []
    const renderer = {
      getContents: () => [
        { doc: other, overlayer: { redraw: () => drawn.push('other') } },
        { doc, overlayer: { redraw: () => drawn.push('this') } },
        { doc },
      ],
    }
    redrawOver(renderer, doc)
    redrawOver(undefined, doc)
    expect(drawn).toEqual(['this'])
  })

  it('says how far the boxes moved when drawn again, and says it in the console', () => {
    const doc = page()
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const box = (y: number) => {
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      r.setAttribute('x', '10')
      r.setAttribute('y', String(y))
      return r
    }
    svg.append(box(100), box(124))
    let shift = 0
    const renderer = {
      getContents: () => [
        {
          doc,
          overlayer: {
            element: svg,
            redraw: () => svg.replaceChildren(box(100 + shift), box(124 + shift)),
          },
        },
      ],
    }
    const said: unknown[][] = []
    const debug = console.debug
    console.debug = (...args: unknown[]) => void said.push(args)
    try {
      expect(redrawOver(renderer, doc, 'a test')).toBe(0)
      expect(said).toEqual([])
      shift = 48
      expect(redrawOver(renderer, doc, 'a test')).toBe(48)
      expect(said).toHaveLength(1)
      expect(String(said[0][0])).toContain('a test')
      expect(said[0][1]).toBe(48)
    } finally {
      console.debug = debug
    }
  })
})
