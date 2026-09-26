/**
 * What the pen and the marker draw with on a PDF (`reader/ink/inkModel.ts`): the tool, its colour,
 * and the width the chosen thickness gives it.
 */
import { describe, it, expect } from 'vitest'
import { emptyInk, inkBrush, INK_WIDTHS } from '@/reader/ink/inkModel'

describe("the pen's thickness on a PDF", () => {
  it('draws medium until another is chosen, as fine as a nib and as wide as a highlighter', () => {
    const ink = emptyInk()
    expect(ink.thickness).toBe('medium')
    expect(inkBrush(ink)).toEqual({ tool: 'pen', color: 'black', size: INK_WIDTHS.pen.medium })
    expect(INK_WIDTHS.pen.medium).toBe(2.2)
    expect(INK_WIDTHS.marker.medium).toBe(12)
  })

  it('makes the pen and the marker thinner or wider, each in its own colour', () => {
    const ink = { ...emptyInk(), thickness: 'fine' as const }
    const fine = inkBrush(ink)!.size
    const bold = inkBrush({ ...ink, thickness: 'bold' })!.size
    expect(fine).toBeLessThan(INK_WIDTHS.pen.medium)
    expect(bold).toBeGreaterThan(INK_WIDTHS.pen.medium)
    expect(inkBrush({ ...ink, tool: 'marker', thickness: 'bold' })).toEqual({
      tool: 'marker',
      color: 'yellow',
      size: INK_WIDTHS.marker.bold,
    })
    expect(inkBrush({ ...ink, tool: 'eraser' })).toBeNull()
  })
})
