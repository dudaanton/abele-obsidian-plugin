/**
 * Pictures and tables on a book's page (`src/reader/figures.ts`): which taps open one full
 * screen, and the page a table is shown on.
 */
import { describe, it, expect } from 'vitest'
import { figureAt, fitFigures, tablePage, MIN_FIGURE_PX } from '@/reader/figures'

const page = (html: string) => {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.body.replaceChildren(...Array.from(parsed.body.childNodes))
  return document
}
const sized = (el: Element, width: number, height: number) => {
  el.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height }) as DOMRect
}

describe('what a tap on a page opens', () => {
  it('a picture as large as a figure, not an icon among the words', () => {
    const doc = page(
      '<p><img id="big" src="blob:app/1" alt="A table of rates"></p><p>An <img id="icon" src="blob:app/2"> icon</p>'
    )
    const big = doc.getElementById('big')!
    const icon = doc.getElementById('icon')!
    sized(big, 300, 420)
    sized(icon, 16, 16)
    expect(figureAt(big)).toMatchObject({
      kind: 'image',
      src: 'blob:app/1',
      alt: 'A table of rates',
    })
    expect(figureAt(icon)).toBeNull()
    expect(MIN_FIGURE_PX).toBeGreaterThan(16)
  })

  it('a picture inside an SVG, the way covers and plates are drawn', () => {
    const doc = page(
      '<svg id="s" xmlns:xlink="http://www.w3.org/1999/xlink"><image width="600" height="900" xlink:href="blob:app/3"/></svg>'
    )
    const svg = doc.getElementById('s')!
    sized(svg, 300, 450)
    expect(figureAt(svg.querySelector('image'))).toMatchObject({
      kind: 'image',
      src: 'blob:app/3',
      width: 600,
      height: 900,
    })
  })

  it('a table, and not a link inside it or a picture that is a link', () => {
    const doc = page(
      '<table id="t"><tr><td id="cell">1</td><td><a href="#n" id="link">2</a></td></tr></table><a href="#x"><img id="linked" src="blob:app/4"></a>'
    )
    sized(doc.getElementById('linked')!, 300, 300)
    expect(figureAt(doc.getElementById('cell'))).toMatchObject({ kind: 'table' })
    expect(figureAt(doc.getElementById('link'))).toBeNull()
    expect(figureAt(doc.getElementById('linked'))).toBeNull()
    expect(figureAt(doc.body)).toBeNull()
  })
})

describe('the page a table is shown on', () => {
  it('carries the book’s policy and nothing that runs, whatever the table held', () => {
    const doc = page(
      '<table id="t"><tr><td onclick="alert(1)">x<script>alert(2)</script></td><td><a href="javascript:alert(3)">y</a></td></tr></table>'
    )
    const html = tablePage(doc.getElementById('t') as HTMLTableElement)
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("script-src 'none'")
    expect(html).not.toMatch(/onclick|<script|javascript:/i)
    expect(html).toContain('<td')
  })
})

describe('pictures and tables laid out on the page', () => {
  it('centres a picture that stands alone, and leaves one among words where it is', () => {
    const doc = page(
      '<p><img id="alone" src="blob:app/1"></p><p>Words <img id="inline" src="blob:app/2"> around</p>'
    )
    sized(doc.getElementById('alone')!, 200, 300)
    sized(doc.getElementById('inline')!, 200, 300)
    fitFigures(doc)
    expect(doc.getElementById('alone')!.style.display).toBe('block')
    expect(doc.getElementById('inline')!.style.display).toBe('')
  })

  it('lets a table wider than its column scroll sideways in it', () => {
    const doc = page(
      '<div id="col"><table id="wide"><tr><td>x</td></tr></table><table id="narrow"><tr><td>y</td></tr></table></div>'
    )
    Object.defineProperty(doc.getElementById('col')!, 'clientWidth', { value: 300 })
    Object.defineProperty(doc.getElementById('wide')!, 'scrollWidth', { value: 900 })
    Object.defineProperty(doc.getElementById('narrow')!, 'scrollWidth', { value: 200 })
    fitFigures(doc)
    expect(doc.getElementById('wide')!.style.overflowX).toBe('auto')
    expect(doc.getElementById('narrow')!.style.overflowX).toBe('')
  })
})
