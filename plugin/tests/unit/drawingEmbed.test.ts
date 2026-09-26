/**
 * A drawing shown in a note (`drawing/embedFormat.ts`): the callout that shows it, the part of it
 * the callout's header names, and that header rewritten when another part is kept.
 */
import { describe, it, expect } from 'vitest'
import {
  drawingCallout,
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
