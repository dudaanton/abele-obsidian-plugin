/**
 * Drawing on a PDF's pages: the strokes' shapes (`ink/stroke.ts`), the file a page's ink is kept
 * in and its callout in the book's note (`ink/inkFile.ts`), undo (`ink/inkHistory.ts`) and who
 * draws — the pen, the mouse, a finger — and who only moves the page (`ink/inkRoute.ts`).
 */
import { describe, it, expect } from 'vitest'
import {
  INK_COLORS,
  hitStroke,
  inkLiteral,
  penWidth,
  roundPoint,
  strokePath,
  type InkStroke,
} from '@/reader/ink/stroke'
import {
  inkCallout,
  inkFolderOf,
  inkPageOf,
  inkPathOf,
  inkSvg,
  parseInkSvg,
  removeInkCallout,
  upsertInkCallout,
} from '@/reader/ink/inkFile'
import { InkHistory } from '@/reader/ink/inkHistory'
import { routePointer } from '@/reader/ink/inkRoute'

const pen = (points: number[], over: Partial<InkStroke> = {}): InkStroke => ({
  tool: 'pen',
  color: 'black',
  size: 2,
  points,
  ...over,
})

describe('a stroke', () => {
  it('is wider where the pen presses harder, and as wide as set at half pressure', () => {
    expect(penWidth(2, 0.5)).toBeCloseTo(2)
    expect(penWidth(2, 1)).toBeGreaterThan(penWidth(2, 0.5))
    expect(penWidth(2, 0.1)).toBeLessThan(penWidth(2, 0.5))
    expect(penWidth(2, 0)).toBeGreaterThan(0)
  })

  it('keeps its points to a tenth of a unit and its pressure to a hundredth', () => {
    expect(roundPoint(10.04, 20.06, 0.4567)).toEqual([10, 20.1, 0.46])
    expect(roundPoint(1, 2, 7)).toEqual([1, 2, 1])
  })

  it('is drawn as a closed outline for the pen, a line for the marker, a dot for one point', () => {
    const outline = strokePath(pen([0, 0, 0.5, 10, 0, 0.5, 20, 5, 0.8]))
    expect(outline).toMatch(/^M[\d.-]+ [\d.-]+/)
    expect(outline).toMatch(/Z$/)
    expect(outline).not.toMatch(/NaN/)
    const dot = strokePath(pen([5, 5, 0.5]))
    expect(dot).toMatch(/A/)
    expect(dot).not.toMatch(/NaN/)
    const line = strokePath(pen([0, 0, 0.5, 10, 10, 0.5], { tool: 'marker', size: 12 }))
    expect(line).toMatch(/^M0 0/)
    expect(line).not.toMatch(/Z$/)
  })

  it('draws a stroke whose points all fall on one spot as a dot, not as nothing', () => {
    const same = strokePath(pen([5, 5, 0.5, 5, 5, 0.5, 5, 5, 0.5]))
    expect(same).toMatch(/A/)
    expect(same).not.toMatch(/NaN/)
  })

  it('is hit by an eraser that comes within its reach, and not from further away', () => {
    const s = pen([0, 0, 0.5, 100, 0, 0.5])
    expect(hitStroke(s, 50, 3, 3)).toBe(true)
    expect(hitStroke(s, 50, 10, 3)).toBe(false)
    expect(hitStroke(s, 104, 0, 3)).toBe(true)
    expect(hitStroke(pen([5, 5, 0.5]), 6, 6, 1)).toBe(true)
    const marker = pen([0, 0, 0.5, 100, 0, 0.5], { tool: 'marker', size: 12 })
    expect(hitStroke(marker, 50, 7, 2)).toBe(true)
  })

  it('has a paper colour for every colour the bar offers', () => {
    for (const color of [...INK_COLORS.pen, ...INK_COLORS.marker])
      expect(inkLiteral(color)).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe("a page's ink in the vault", () => {
  it('is kept in a folder beside the book, a file per page named after the book, numbered as the pages are', () => {
    expect(inkFolderOf('Papers/Paper.pdf')).toBe('Papers/Paper ink')
    expect(inkFolderOf('Paper.pdf')).toBe('Paper ink')
    expect(inkPathOf('Papers/Paper.pdf', 3)).toBe('Papers/Paper ink/Paper page 4.svg')
    expect(inkPageOf('Papers/Paper ink/Paper page 4.svg', 'Papers/Paper.pdf')).toBe(3)
    expect(inkPageOf('Papers/Paper ink/notes.svg', 'Papers/Paper.pdf')).toBeNull()
    expect(inkPageOf('Papers/Other ink/Paper page 4.svg', 'Papers/Paper.pdf')).toBeNull()
    expect(inkPageOf('Papers/Paper ink/Paper page 0.svg', 'Papers/Paper.pdf')).toBeNull()
  })

  it('is an SVG the size of the page, on white paper, that reads back as the strokes it holds', () => {
    const strokes = [
      pen([10, 20, 0.5, 30, 40, 0.75]),
      pen([50, 60, 0.5, 70, 60, 0.5], { tool: 'marker', color: 'yellow', size: 12 }),
    ]
    const svg = inkSvg({ width: 612, height: 792, strokes })
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    expect(svg).toContain('viewBox="0 0 612 792"')
    expect(svg).toMatch(/<rect[^>]*fill="#ffffff"/)
    const back = parseInkSvg(svg)
    expect(back).toEqual({ width: 612, height: 792, strokes })
  })

  it('reads nothing it did not write: a stranger SVG, a broken number, a script', () => {
    expect(parseInkSvg('<svg><path d="M0 0"/></svg>')).toEqual(null)
    const svg = inkSvg({ width: 100, height: 100, strokes: [pen([1, 2, 0.5])] })
    const broken = svg.replace(/data-points="[^"]*"/, 'data-points="1 x 3"')
    expect(parseInkSvg(broken)?.strokes).toEqual([])
    const odd = svg.replace(/data-color="black"/, 'data-color="url(#x)"')
    expect(parseInkSvg(odd)?.strokes[0].color).toBe('black')
    const scripted = svg.replace('</svg>', '<script>alert(1)</script></svg>')
    expect(parseInkSvg(scripted)?.strokes).toHaveLength(1)
  })
})

describe("a page's ink in the book's note", () => {
  const svg4 = 'Papers/Paper ink/Paper page 4.svg'
  const svg2 = 'Papers/Paper ink/Paper page 2.svg'
  const svg9 = 'Papers/Paper ink/Paper page 9.svg'
  const block = (page: number, path: string) =>
    inkCallout(`[[Papers/Paper.pdf#page=${page}|Page ${page}]]`, path)

  it('is a callout with a link to the page and the picture embedded', () => {
    expect(block(4, svg4)).toBe(
      '> [!ink] [[Papers/Paper.pdf#page=4|Page 4]]\n> ![[Papers/Paper ink/Paper page 4.svg]]'
    )
  })

  it('goes in once, among the other pages in their order, the rest of the note untouched', () => {
    const note =
      '---\ntype: book-highlights\n---\n\n# Paper\n\n> [!quote|yellow] [[x#cfi=/6/2|p]]\n> words\n'
    let md = upsertInkCallout(note, svg4, block(4, svg4))
    expect(md).toContain('> [!quote|yellow] [[x#cfi=/6/2|p]]\n> words\n\n> [!ink]')
    expect(upsertInkCallout(md, svg4, block(4, svg4))).toBe(md)
    md = upsertInkCallout(md, svg9, block(9, svg9))
    md = upsertInkCallout(md, svg2, block(2, svg2))
    const order = [...md.matchAll(/page (\d)\.svg/g)].map((m) => Number(m[1]))
    expect(order).toEqual([2, 4, 9])
    expect(md.startsWith(note.trimEnd())).toBe(true)
  })

  it('finds its callout by the picture, however the link to it is written', () => {
    const md =
      '# Paper\n\n> [!ink] [Page 4](Papers/Paper.pdf#page=4)\n> ![](Papers/Paper%20ink/Paper%20page%204.svg)\n\nmine\n'
    expect(upsertInkCallout(md, svg4, block(4, svg4))).toBe(md)
    expect(removeInkCallout(md, svg4)).toBe('# Paper\n\nmine\n')
    // Shortened to the file's name alone, as Obsidian does when it updates links.
    const short = '> [!ink] [[Paper.pdf#page=4|Page 4]]\n> ![[Paper page 4.svg]]\n'
    expect(upsertInkCallout(short, svg4, block(4, svg4))).toBe(short)
    // Another book's page 4 is not this book's.
    const other = '> [!ink] [[Other.pdf#page=4|Page 4]]\n> ![[Other ink/Other page 4.svg]]\n'
    expect(upsertInkCallout(other, svg4, block(4, svg4))).toContain('Paper page 4.svg')
  })

  it('goes away with its page, and leaves another page and everything else', () => {
    let md = upsertInkCallout('# Paper\n', svg4, block(4, svg4))
    md = upsertInkCallout(md, svg9, block(9, svg9))
    const out = removeInkCallout(md, svg4)
    expect(out).not.toContain('page 4.svg')
    expect(out).toContain('page 9.svg')
    expect(out.startsWith('# Paper\n')).toBe(true)
    expect(removeInkCallout('# Paper\n', svg4)).toBe('# Paper\n')
  })
})

describe('undo', () => {
  it('takes back what was drawn and erased, in turn, and gives it again', () => {
    const h = new InkHistory()
    expect(h.canUndo).toBe(false)
    const a = pen([1, 1, 0.5])
    h.push({ index: 0, added: [a], removed: [] })
    h.push({ index: 0, added: [], removed: [{ stroke: a, at: 0 }] })
    expect(h.undo()?.removed).toHaveLength(1)
    expect(h.canRedo).toBe(true)
    expect(h.undo()?.added).toEqual([a])
    expect(h.undo()).toBeNull()
    expect(h.redo()?.added).toEqual([a])
    h.push({ index: 1, added: [a], removed: [] })
    expect(h.canRedo).toBe(false)
  })

  it('keeps a bounded past', () => {
    const h = new InkHistory(3)
    for (let i = 0; i < 5; i++) h.push({ index: i, added: [], removed: [] })
    expect([h.undo()?.index, h.undo()?.index, h.undo()?.index, h.undo()]).toEqual([4, 3, 2, null])
  })
})

describe('who draws', () => {
  const state = { finger: false, penDown: false }
  it('the pen draws, and its eraser end erases', () => {
    expect(routePointer(state, { pointerType: 'pen', buttons: 1 })).toBe('ink')
    expect(routePointer(state, { pointerType: 'pen', buttons: 32 })).toBe('erase')
  })

  it('the mouse draws with its main button, and nothing with the others', () => {
    expect(routePointer(state, { pointerType: 'mouse', buttons: 1 })).toBe('ink')
    expect(routePointer(state, { pointerType: 'mouse', buttons: 2 })).toBe('ignore')
  })

  it('a finger moves the page, or draws when asked to, and does nothing while the pen is down', () => {
    expect(routePointer(state, { pointerType: 'touch', buttons: 1 })).toBe('pan')
    expect(routePointer({ ...state, finger: true }, { pointerType: 'touch', buttons: 1 })).toBe(
      'ink'
    )
    expect(
      routePointer({ finger: true, penDown: true }, { pointerType: 'touch', buttons: 1 })
    ).toBe('ignore')
  })
})
