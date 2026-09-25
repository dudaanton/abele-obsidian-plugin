/**
 * Where the bar for selected words stands (`src/reader/barPlace.ts`): at the head of the page
 * when the words are in its lower part, so the bar never covers them.
 */
import { describe, it, expect } from 'vitest'
import { barAtTop, bottomOnScreen, LOWER_PART } from '@/reader/barPlace'

const stage = { top: 100, bottom: 700, left: 0, right: 400, height: 600, width: 400 } as DOMRect

const rangeWith = (rects: Partial<DOMRect>[]) =>
  ({
    startContainer: { ownerDocument: null },
    getClientRects: () => rects.map((r) => ({ width: 50, ...r })),
  }) as unknown as Range

describe('where the bar for selected words stands', () => {
  it('at the foot of the page for words in its upper part, at its head for words in the lower', () => {
    expect(barAtTop(150, stage)).toBe(false)
    expect(barAtTop(100 + 600 * LOWER_PART - 1, stage)).toBe(false)
    expect(barAtTop(690, stage)).toBe(true)
    expect(barAtTop(null, stage)).toBe(false)
  })

  it('goes by the lowest line of the words on screen, not those on pages either side', () => {
    const range = rangeWith([
      { left: 20, bottom: 200 },
      { left: 30, bottom: 650 },
      // On the next page, off to the right: not on screen.
      { left: 420, bottom: 690 },
    ])
    expect(bottomOnScreen(range, stage)).toBe(650)
    expect(bottomOnScreen(rangeWith([{ left: 500, bottom: 300 }]), stage)).toBeNull()
  })

  it('leaves out a line of the page before that ends right on the edge of this one', () => {
    // A whole line of the last page, its right end touching the page's left edge — after a turn
    // under words selected across the two, it sent the bar over the head of the new page.
    const range = rangeWith([
      { left: -335, width: 335, bottom: 600 },
      { left: 400, width: 30, bottom: 650 },
      { left: 20, bottom: 150 },
    ])
    expect(bottomOnScreen(range, stage)).toBe(150)
  })
})
