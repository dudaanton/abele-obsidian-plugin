import { describe, expect, it } from 'vitest'
import { cardFolds, cardPanels, panelsShown } from '@/canvas/cardPanels'

describe("a note card's header and footer", () => {
  it('shows them whole, as codes or not at all by the size on the screen', () => {
    expect(cardPanels({ width: 420, height: 640 })).toBe('full')
    expect(cardPanels({ width: 300, height: 170 })).toBe('codes')
    expect(cardPanels({ width: 230, height: 350 })).toBe('codes')
    expect(cardPanels({ width: 129, height: 73 })).toBe('none')
    expect(cardPanels({ width: 105, height: 160 })).toBe('none')
  })

  it("takes the card's own choice over the canvas's default, only for markdown notes", () => {
    const note = { type: 'file', file: 'Projects/Station.md' }
    expect(panelsShown(note, false)).toBe(false)
    expect(panelsShown(note, true)).toBe(true)
    expect(panelsShown({ ...note, abele: { panels: true } }, false)).toBe(true)
    expect(panelsShown({ ...note, abele: { panels: false } }, true)).toBe(false)
    expect(panelsShown({ type: 'file', file: 'sketch.png', abele: { panels: true } }, true)).toBe(
      false
    )
    expect(panelsShown({ type: 'text' }, true)).toBe(false)
  })

  it('folds every list but the first', () => {
    expect(cardFolds(['tasks', 'calendar', 'backlinks'])).toEqual(['calendar', 'backlinks'])
    expect(cardFolds([])).toEqual([])
  })
})
