/**
 * The margin column beside the text.
 *
 * Footnotes have hung there since they shipped; comments join them in phase 2, and both go
 * through one overlay so that a comment and a footnote anchored two words apart do not draw
 * on top of each other. What can be pinned down without a browser is the arithmetic: given a
 * measured top and height per entry, where does each one end up. happy-dom computes no
 * layout — `getBoundingClientRect` returns zeros and `coordsAtPos` needs a real one — so the
 * measuring is kept out of this function and stubbed in the tests that drive the overlay.
 */
import { describe, it, expect } from 'vitest'
import { stackEntries, MARGIN_MIN_SPACE, SIDENOTE_GAP } from '@/editor/MarginOverlay'

describe('stacking margin entries', () => {
  it('leaves an entry where its anchor is when nothing is above it', () => {
    expect(
      stackEntries([
        { id: 'a', anchorPos: 10, top: 0, height: 20 },
        { id: 'b', anchorPos: 90, top: 200, height: 20 },
      ])
    ).toEqual([
      { id: 'a', top: 0 },
      { id: 'b', top: 200 },
    ])
  })

  it('orders footnotes and comments together by document position, not by kind', () => {
    // The ids name the kind for readability only: the arithmetic sees anchorPos and nothing else.
    const placements = stackEntries([
      { id: 'comment-2', anchorPos: 300, top: 90, height: 30 },
      { id: 'footnote-1', anchorPos: 10, top: 0, height: 40 },
      { id: 'comment-1', anchorPos: 20, top: 10, height: 50 },
      { id: 'footnote-2', anchorPos: 400, top: 400, height: 10 },
    ])

    expect(placements.map((p) => p.id)).toEqual([
      'footnote-1',
      'comment-1',
      'comment-2',
      'footnote-2',
    ])
    // 0 → bottom 40; max(10, 44) = 44 → bottom 94; max(90, 98) = 98 → bottom 128; 400 clears it.
    expect(placements.map((p) => p.top)).toEqual([0, 44, 98, 400])
  })

  it('keeps the gap between two entries anchored on the same line', () => {
    const [first, second] = stackEntries([
      { id: 'footnote-1', anchorPos: 10, top: 100, height: 24 },
      { id: 'comment-1', anchorPos: 12, top: 100, height: 24 },
    ])

    expect(first.top).toBe(100)
    expect(second.top).toBe(100 + 24 + SIDENOTE_GAP)
  })

  it('hides an entry whose anchor is out of view and stacks the rest as if it were not there', () => {
    expect(
      stackEntries([
        { id: 'a', anchorPos: 10, top: 0, height: 40 },
        { id: 'b', anchorPos: 20, top: null, height: 40 },
        { id: 'c', anchorPos: 30, top: 10, height: 40 },
      ])
    ).toEqual([
      { id: 'a', top: 0 },
      { id: 'b', top: null },
      { id: 'c', top: 44 },
    ])
  })

  it('does not mutate the list it is given', () => {
    const items = [
      { id: 'b', anchorPos: 90, top: 200, height: 20 },
      { id: 'a', anchorPos: 10, top: 0, height: 20 },
    ]

    stackEntries(items)

    expect(items.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('states the width below which the margin is unusable', () => {
    expect(MARGIN_MIN_SPACE).toBe(200)
    expect(SIDENOTE_GAP).toBe(4)
  })
})
