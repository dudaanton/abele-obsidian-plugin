import { describe, expect, it } from 'vitest'
import { InkHistory } from '@/reader/ink/inkHistory'
import { DrawingItems } from '@/drawing/history'
import { WIDTHS } from '@/drawing/model'
import { INK_WIDTHS } from '@/reader/ink/inkModel'

describe('shared pen policies keep surface-specific choices', () => {
  it('preserves every PDF and drawing width', () => {
    expect(INK_WIDTHS).toEqual({
      pen: { fine: 1.2, medium: 2.2, bold: 4 },
      marker: { fine: 7, medium: 12, bold: 20 },
    })
    expect(WIDTHS).toEqual({
      pen: { fine: 1.4, medium: 2.4, bold: 5 },
      marker: { fine: 8, medium: 14, bold: 24 },
      shape: { fine: 1.5, medium: 2.5, bold: 5 },
    })
  })

  it('preserves distinct undo budgets and empties redo on a new step', () => {
    const pdf = new InkHistory()
    const drawing = new DrawingItems()
    for (let i = 0; i < 301; i++) {
      pdf.push({ index: i, added: [], removed: [] })
      drawing.add([
        { id: `sample-${i}`, type: 'text', x: 0, y: 0, text: 'Sample', size: 16, color: 'black' },
      ])
    }
    let pdfUndone = 0,
      drawingUndone = 0
    while (pdf.undo()) pdfUndone++
    while (drawing.undo()) drawingUndone++
    expect(pdfUndone).toBe(200)
    expect(drawingUndone).toBe(300)
    expect(drawing.items).toHaveLength(1)
    expect(pdf.canRedo).toBe(true)
    expect(drawing.canRedo).toBe(true)
    pdf.push({ index: 400, added: [], removed: [] })
    drawing.add([
      { id: 'sample-new', type: 'text', x: 0, y: 0, text: 'New', size: 16, color: 'black' },
    ])
    expect(pdf.canRedo).toBe(false)
    expect(drawing.canRedo).toBe(false)
  })
})
