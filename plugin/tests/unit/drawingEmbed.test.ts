/**
 * A drawing shown in a note (`drawing/embedFormat.ts`): the callout that shows it, the part of it
 * the callout's header names, and that header rewritten when another part is kept.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_EMBED_HEIGHT,
  drawingCallout,
  embedBox,
  formatEmbedSize,
  parseEmbedSize,
  withEmbedSize,
  formatView,
  isDrawingHeader,
  paperOfSvg,
  parseView,
  withView,
} from '@/drawing/embedFormat'
import { drawingSvg } from '@/drawing/drawingFile'

describe('a drawing in a note', () => {
  it('is a callout with the picture embedded, and the part in its header', () => {
    expect(drawingCallout('![[D/Sketch.svg]]')).toBe('> [!drawing]\n> ![[D/Sketch.svg]]')
    expect(drawingCallout('![[D/Sketch.svg]]', { x: 10.4, y: -20.6, w: 300, h: 200 })).toBe(
      '> [!drawing|10 -21 300 200]\n> ![[D/Sketch.svg]]'
    )
  })

  it('reads the part back only when it is four numbers with a size', () => {
    expect(parseView('10 -21 300 200')).toEqual({ x: 10, y: -21, w: 300, h: 200 })
    expect(parseView('10,20,30,40')).toEqual({ x: 10, y: 20, w: 30, h: 40 })
    expect(parseView('')).toBeNull()
    expect(parseView('1 2 3')).toBeNull()
    expect(parseView('1 2 0 4')).toBeNull()
    expect(parseView('a b c d')).toBeNull()
    expect(formatView({ x: 1.6, y: 2, w: 3, h: 4 })).toBe('2 2 3 4')
  })

  it('knows its own callout from others', () => {
    expect(isDrawingHeader('> [!drawing]')).toBe(true)
    expect(isDrawingHeader('> [!drawing|1 2 3 4] Title')).toBe(true)
    expect(isDrawingHeader('> [!Drawing]-')).toBe(true)
    expect(isDrawingHeader('> [!note]')).toBe(false)
    expect(isDrawingHeader('[!drawing]')).toBe(false)
  })

  it('takes the paper from a drawing’s file', () => {
    const svg = drawingSvg({ items: [] })
    expect(paperOfSvg(svg)).toEqual({ x: 0, y: 0, w: 800, h: 600 })
    expect(paperOfSvg('<svg width="3">')).toBeNull()
  })
})

describe('keeping another part', () => {
  const note = [
    '# Notes',
    '',
    '> [!drawing|0 0 100 100] Plan',
    '> ![[Sketch.svg]]',
    '',
    '> [!drawing]',
    '> ![[Other.svg]]',
    '',
  ].join('\n')

  it('rewrites the header at the line it was rendered from, title and all', () => {
    const next = withView(
      note,
      { x: 5, y: 6, w: 70, h: 80 },
      { line: 2, file: 'Sketch.svg', was: null }
    )
    expect(next?.split('\n')[2]).toBe('> [!drawing|5 6 70 80] Plan')
  })

  it('finds the callout by the file and the part it named when the line is not known', () => {
    const next = withView(
      note,
      { x: 1, y: 2, w: 3, h: 4 },
      {
        file: 'Drawings/Other.svg',
        was: null,
      }
    )
    expect(next?.split('\n')[5]).toBe('> [!drawing|1 2 3 4]')
    expect(next?.split('\n')[2]).toBe('> [!drawing|0 0 100 100] Plan')
  })

  it('takes the part out for the whole drawing, and finds nothing where there is nothing', () => {
    const whole = withView(note, null, {
      line: 2,
      file: 'Sketch.svg',
      was: { x: 0, y: 0, w: 100, h: 100 },
    })
    expect(whole?.split('\n')[2]).toBe('> [!drawing] Plan')
    expect(withView(note, null, { file: 'Missing.svg', was: null })).toBeNull()
    // A line that is not a drawing's header is not written over.
    expect(withView(note, null, { line: 0, file: 'Missing.svg', was: null })).toBeNull()
  })
})

describe('the size a drawing is shown at', () => {
  it('reads Obsidian’s own size from an embed: a width, or a width and a height', () => {
    expect(parseEmbedSize('300')).toEqual({ w: 300 })
    expect(parseEmbedSize('300x120')).toEqual({ w: 300, h: 120 })
    expect(parseEmbedSize(' 300 x 120 ')).toEqual({ w: 300, h: 120 })
    expect(parseEmbedSize('Sketch.svg')).toBeNull()
    expect(parseEmbedSize('0')).toBeNull()
    expect(parseEmbedSize(null)).toBeNull()
    expect(formatEmbedSize({ w: 300.4 })).toBe('300')
    expect(formatEmbedSize({ w: 300, h: 119.6 })).toBe('300x120')
  })

  it('shows a drawing no bigger than it is by default, within the note and a sane height', () => {
    // A small drawing is not blown up to the note's width.
    expect(embedBox(700, { x: 0, y: 0, w: 212, h: 132 }, null)).toEqual({ w: 212, h: 132 })
    // A wide one fits the note.
    expect(embedBox(700, { x: 0, y: 0, w: 1400, h: 700 }, null)).toEqual({ w: 700, h: 350 })
    // A tall one, and a new empty one, stop at the default height.
    const tall = embedBox(700, { x: 0, y: 0, w: 600, h: 1200 }, null)
    expect(tall.h).toBe(DEFAULT_EMBED_HEIGHT)
    expect(tall.w).toBe(DEFAULT_EMBED_HEIGHT / 2)
    expect(embedBox(700, { x: 0, y: 0, w: 800, h: 600 }, null).h).toBe(DEFAULT_EMBED_HEIGHT)
    // A dot still gets a box that can be seen and pressed.
    const dot = embedBox(700, { x: 0, y: 0, w: 20, h: 20 }, null)
    expect(dot.w).toBeGreaterThanOrEqual(120)
    expect(dot.h).toBeGreaterThanOrEqual(80)
  })

  it('takes the size the embed names, the height from the drawing when only the width is named', () => {
    const r = { x: 0, y: 0, w: 212, h: 132 }
    expect(embedBox(700, r, { w: 424 })).toEqual({ w: 424, h: 264 })
    expect(embedBox(700, r, { w: 300, h: 100 })).toEqual({ w: 300, h: 100 })
    // Never wider than the note; a named height shrinks with it.
    expect(embedBox(200, r, { w: 400, h: 100 })).toEqual({ w: 200, h: 50 })
  })
})

describe('keeping the size in the note', () => {
  it('writes it into the embed at the line it was rendered from, the one it was of several', () => {
    const note = 'A ![[D/Sketch.svg]] and ![[Sketch.svg|200]]\n\n![[Other.svg]]'
    const first = withEmbedSize(note, { from: 0, file: 'D/Sketch.svg', nth: 0 }, { w: 320 })
    expect(first?.split('\n')[0]).toBe('A ![[D/Sketch.svg|320]] and ![[Sketch.svg|200]]')
    const second = withEmbedSize(note, { from: 0, file: 'D/Sketch.svg', nth: 1 }, { w: 90, h: 40 })
    expect(second?.split('\n')[0]).toBe('A ![[D/Sketch.svg]] and ![[Sketch.svg|90x40]]')
    // Taken out again: the drawing's own size.
    expect(withEmbedSize(note, { from: 0, file: 'Sketch.svg', nth: 1 }, null)?.split('\n')[0]).toBe(
      'A ![[D/Sketch.svg]] and ![[Sketch.svg]]'
    )
    expect(withEmbedSize(note, { from: 0, file: 'Sketch.svg', nth: 2 }, { w: 1 })).toBeNull()
    expect(withEmbedSize(note, { from: 2, file: 'Sketch.svg', nth: 0 }, { w: 1 })).toBeNull()
  })

  it('keeps a caption and a heading of the link, and reads a callout to its end', () => {
    const note =
      '> [!drawing|0 0 10 10]\n> ![[Sketch.svg#x|Plan|300]]\n>\n> ![](Drawings/Sketch%20B.svg)\n\n![[Sketch.svg]]'
    const a = withEmbedSize(note, { from: 0, file: 'Sketch.svg', nth: 0 }, { w: 500 })
    expect(a?.split('\n')[1]).toBe('> ![[Sketch.svg#x|Plan|500]]')
    const b = withEmbedSize(note, { from: 0, file: 'Drawings/Sketch B.svg', nth: 0 }, { w: 250 })
    expect(b?.split('\n')[3]).toBe('> ![250](Drawings/Sketch%20B.svg)')
    // The embed after the callout is not the callout's.
    expect(withEmbedSize(note, { from: 0, file: 'Sketch.svg', nth: 1 }, { w: 1 })).toBeNull()
  })

  it('reads a paragraph over the lines it was given', () => {
    const note = 'one\n![[Sketch.svg]]\n![[Sketch.svg]]'
    const next = withEmbedSize(note, { from: 0, to: 2, file: 'Sketch.svg', nth: 1 }, { w: 10 })
    expect(next).toBe('one\n![[Sketch.svg]]\n![[Sketch.svg|10]]')
  })
})
