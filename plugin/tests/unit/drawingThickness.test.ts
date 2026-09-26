/**
 * How thick the pen draws on a drawing is kept, as on a PDF: chosen once from the bar, it is what
 * every drawing opens with after (`src/drawing/penThickness.ts`).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_READER_SETTINGS, readerSettingsFrom } from '@/reader/settings'
import { keepDrawingThickness, keptDrawingThickness } from '@/drawing/penThickness'

beforeEach(() => {
  AbeleConfig.getInstance().reader = { ...DEFAULT_READER_SETTINGS }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

describe("a drawing's pen thickness", () => {
  it('is medium until chosen, and a stored value out of range reads as medium', () => {
    expect(readerSettingsFrom({}).drawingInkThickness).toBe('medium')
    expect(readerSettingsFrom({ drawingInkThickness: 'bold' }).drawingInkThickness).toBe('bold')
    expect(readerSettingsFrom({ drawingInkThickness: 'huge' as never }).drawingInkThickness).toBe(
      'medium'
    )
    expect(keptDrawingThickness()).toBe('medium')
  })

  it("is saved when chosen and read back, apart from the PDF's", () => {
    const config = AbeleConfig.getInstance()
    config.reader = { ...config.reader, pdfInkThickness: 'fine' }
    keepDrawingThickness('bold')
    expect(config.saveSettings).toHaveBeenCalled()
    expect(config.reader.drawingInkThickness).toBe('bold')
    expect(config.reader.pdfInkThickness).toBe('fine')
    expect(keptDrawingThickness()).toBe('bold')
  })
})
