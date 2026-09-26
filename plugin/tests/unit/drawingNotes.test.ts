/**
 * Notes shown on a drawing, without a screen: the note item (`drawing/items.ts`), its card in the
 * drawing's file (`drawing/noteCard.ts`), the lasso and the eraser with it, what the agent is told
 * of it, and a note's rename followed (`drawing/noteRenames.ts`).
 */
import { describe, it, expect } from 'vitest'
import {
  boundsOf,
  itemFrom,
  moveItem,
  scaleItem,
  type NoteItem,
  type StrokeItem,
} from '@/drawing/items'
import { drawingSvg, paperOf, parseDrawingSvg } from '@/drawing/drawingFile'
import { lassoPick } from '@/drawing/selection'
import { DrawingItems } from '@/drawing/history'
import { eraseGesture } from '@/drawing/tools'
import { renamedNotes } from '@/drawing/noteRenames'
import { noteName } from '@/drawing/noteCard'

const note = (over: Partial<NoteItem> = {}): NoteItem => ({
  id: 'n',
  type: 'note',
  x: 100,
  y: 100,
  w: 300,
  h: 200,
  scale: 1,
  path: 'Projects/Plan.md',
  ...over,
})
const line: StrokeItem = {
  id: 's',
  type: 'stroke',
  tool: 'pen',
  color: 'black',
  size: 2,
  points: [150, 150, 0.5, 250, 150, 0.5],
}

describe('a note on a drawing', () => {
  it('is kept in the file with its box, and shown there as a card with its name', () => {
    const svg = drawingSvg({ items: [note(), line] })
    expect(parseDrawingSvg(svg)?.items[0]).toEqual(note())
    expect(svg).toContain('<rect x="100" y="100" width="300" height="200"')
    expect(svg).toContain('>Plan</text>')
    expect(paperOf([note()]).w).toBeGreaterThan(300)
    expect(noteName('A/B/Some note.md')).toBe('Some note')
  })

  it('is refused from a file when its path is not a vault path or its box has no size', () => {
    expect(itemFrom(note({ path: '../../etc/passwd' }))).toBeNull()
    expect(itemFrom(note({ path: '' }))).toBeNull()
    expect(itemFrom(note({ path: 'a\u0000b.md' }))).toBeNull()
    expect(itemFrom(note({ w: 0 }))).toBeNull()
    expect(itemFrom({ ...note(), scale: 'big' })).toMatchObject({ scale: 1 })
  })

  it('moves, and scales as a picture of the note: box and text alike', () => {
    expect(moveItem(note(), 10, -10)).toMatchObject({ x: 110, y: 90 })
    expect(scaleItem(note(), 100, 100, 2)).toMatchObject({
      x: 100,
      y: 100,
      w: 600,
      h: 400,
      scale: 2,
    })
    expect(boundsOf(note())).toEqual({ x: 100, y: 100, w: 300, h: 200 })
  })

  it('is picked by a lasso round it, and passed over by the eraser', () => {
    expect(lassoPick([note()], [90, 90, 410, 90, 410, 310, 90, 310])).toEqual(['n'])
    const items = new DrawingItems()
    items.load([note(), line])
    const g = eraseGesture(
      { items, zoom: () => 1, added: () => {}, repaint: () => {}, changed: () => {} },
      { x: 200, y: 150, p: 0.5 }
    )
    g.end(false)
    expect(items.items.map((i) => i.id)).toEqual(['n'])
  })

  it('follows its note when the note is renamed', () => {
    const next = renamedNotes([note(), line], 'Projects/Plan.md', 'Archive/Plan.md')
    expect(next?.[0]).toMatchObject({ path: 'Archive/Plan.md' })
    expect(next?.[1]).toBe(line)
    expect(renamedNotes([line], 'Projects/Plan.md', 'x.md')).toBeNull()
  })
})
