/**
 * A page laid out anew once its fonts arrive (`src/reader/pageLayout.ts`): the columns' width
 * nudged and put back as it was, important and all, and nothing done to a page not in columns;
 * and what is drawn over the words — highlights — drawn again over where the words now are.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  redrawOver,
  relayoutColumns,
  relayoutOnFonts,
  relayoutOnPictures,
  keepMarksOnText,
  FONT_CHECKS_MS,
  relayoutText,
} from '@/reader/pageLayout'

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
    // The lines set anew (two layouts) and the columns (two more).
    expect(layouts).toBe(4)
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(layouts).toBe(8)
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

  it('lays the page out again when a picture on it has loaded, and draws what is over it again', () => {
    const doc = page('500px')
    Object.defineProperty(doc, 'defaultView', { value: window })
    let layouts = 0
    Object.defineProperty(doc.documentElement, 'offsetHeight', { get: () => (layouts++, 0) })
    const img = doc.createElement('img')
    doc.body.append(img)
    let redraws = 0
    relayoutOnPictures(doc, () => redraws++)
    img.dispatchEvent(new Event('load'))
    expect(layouts).toBe(2)
    expect(redraws).toBe(1)
    // A picture that failed changes the page as much as one that came.
    img.dispatchEvent(new Event('error'))
    expect(layouts).toBe(4)
    expect(redraws).toBe(2)
    // Anything else loading on the page is not a picture.
    doc.body.dispatchEvent(new Event('load'))
    expect(layouts).toBe(4)
  })

  it("draws what is over the words again when the page's styles change, as a font changed in the settings does", async () => {
    const doc = page('500px')
    Object.defineProperty(doc, 'defaultView', { value: window })
    let redraws = 0
    const renderer = Object.assign(new EventTarget(), {
      getContents: () => [{ doc, overlayer: { redraw: () => redraws++ } }],
    })
    keepMarksOnText(doc, () => renderer)
    const frame = () => new Promise((r) => window.requestAnimationFrame(() => r(null)))
    await frame()
    const before = redraws
    const style = doc.createElement('style')
    doc.head.append(style)
    await Promise.resolve()
    await frame()
    expect(redraws).toBe(before + 1)
    style.textContent = 'p { font-family: serif }'
    await Promise.resolve()
    await frame()
    expect(redraws).toBe(before + 2)
  })

  it('lays the page out again a few times after it comes, and draws what is over it again', async () => {
    vi.useFakeTimers()
    try {
      const doc = page('500px')
      Object.defineProperty(doc, 'defaultView', { value: window })
      let layouts = 0
      Object.defineProperty(doc.documentElement, 'offsetHeight', { get: () => (layouts++, 0) })
      let redraws = 0
      const renderer = Object.assign(new EventTarget(), {
        getContents: () => [{ doc, overlayer: { redraw: () => redraws++ } }],
      })
      keepMarksOnText(doc, () => renderer)
      await vi.advanceTimersByTimeAsync(FONT_CHECKS_MS[FONT_CHECKS_MS.length - 1] + 100)
      // Each check sets the lines anew and nudges the columns: four layouts.
      expect(layouts).toBe(FONT_CHECKS_MS.length * 4)
      expect(redraws).toBeGreaterThanOrEqual(1)
      // Nothing more once they are done.
      const done = layouts
      await vi.advanceTimersByTimeAsync(30_000)
      expect(layouts).toBe(done)
    } finally {
      vi.useRealTimers()
    }
  })

  it('coalesces late content style changes and stops watching when the page leaves', async () => {
    const doc = page('500px')
    Object.defineProperty(doc, 'defaultView', { value: window })
    doc.body.innerHTML = '<p><span>Sample words</span></p>'
    const redraw = vi.fn()
    const renderer = Object.assign(new EventTarget(), {
      getContents: () => [{ doc, overlayer: { redraw } }],
    })
    const frame = () => new Promise((resolve) => window.requestAnimationFrame(resolve))
    keepMarksOnText(doc, () => renderer)
    await frame()
    redraw.mockClear()
    doc.querySelector('p')!.style.textIndent = '4em'
    doc.querySelector('span')!.classList.add('alternate-font')
    await Promise.resolve()
    await frame()
    expect(redraw).toHaveBeenCalledTimes(1)
    // Leaving cancels even a redraw already queued for the next frame.
    doc.body.classList.add('compact')
    await Promise.resolve()
    window.dispatchEvent(new Event('pagehide'))
    renderer.dispatchEvent(new Event('relocate'))
    doc.querySelector('p')!.style.textIndent = '2em'
    await frame()
    expect(redraw).toHaveBeenCalledTimes(1)
  })

  it('remeasures glyph boxes immediately on a frame viewport change and stops on pagehide', () => {
    const doc = page('500px')
    Object.defineProperty(doc, 'defaultView', { value: window })
    const redraw = vi.fn()
    const renderer = { getContents: () => [{ doc, overlayer: { redraw } }] }
    keepMarksOnText(doc, () => renderer)
    // Browser zoom can change font pixel metrics without a font load or block-size change.
    window.dispatchEvent(new Event('resize'))
    expect(redraw).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('resize'))
    expect(redraw).toHaveBeenCalledTimes(1)
  })

  it('watches new blocks for later resizes and releases blocks removed from the page', async () => {
    const observe = vi.spyOn(ResizeObserver.prototype, 'observe')
    const unobserve = vi.spyOn(ResizeObserver.prototype, 'unobserve')
    const doc = page()
    Object.defineProperty(doc, 'defaultView', { value: window })
    doc.body.innerHTML = '<p>First paragraph</p>'
    try {
      keepMarksOnText(doc, () => undefined)
      const first = doc.querySelector('p')!
      expect(observe).toHaveBeenCalledWith(first)
      const second = doc.createElement('p')
      second.textContent = 'A later paragraph'
      doc.body.append(second)
      first.remove()
      await Promise.resolve()
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      expect(observe).toHaveBeenCalledWith(second)
      expect(unobserve).toHaveBeenCalledWith(first)
    } finally {
      window.dispatchEvent(new Event('pagehide'))
      observe.mockRestore()
      unobserve.mockRestore()
    }
  })

  it('sets every line of the page anew with its font made anew, and leaves nothing behind', () => {
    const doc = page('500px')
    doc.head.innerHTML = '<style id="book">p { text-align: justify }</style>'
    doc.body.innerHTML = '<p style="text-align: justify !important">a</p>'
    const seen: string[] = []
    Object.defineProperty(doc.documentElement, 'offsetHeight', {
      get: () => (seen.push(doc.head.innerHTML), 0),
    })
    relayoutText(doc)
    // Laid out once with a font property given to every piece of the text, over whatever the
    // book says, then once without it.
    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatch(
      /<style data-abele-relayout="">html, body, body \* \{ font-variant-east-asian: \w+ !important; \}<\/style>$/
    )
    expect(seen[1]).toBe('<style id="book">p { text-align: justify }</style>')
    // The book's own styles are not touched.
    expect(doc.body.innerHTML).toBe('<p style="text-align: justify !important">a</p>')
  })
})
