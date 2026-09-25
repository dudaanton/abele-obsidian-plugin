/**
 * The page of the chapter, the pages left in it and the place in the book
 * (`src/reader/readingProgress.ts`).
 */
import { describe, it, expect } from 'vitest'
import { nextShow, progressOf, progressText } from '@/reader/readingProgress'

describe('how far into the chapter and the book a page is', () => {
  it('counts a book laid out in pages by its pages, not the engine’s two ways into the next chapters', () => {
    const p = progressOf({ location: { current: 119, total: 830 } }, { page: 3, pages: 14 })
    expect(p).toEqual({ page: 3, pages: 12, location: 120, locations: 830 })
    expect(progressText('page', p, '14%')).toBe('Page 3 of 12')
    expect(progressText('left', p, '14%')).toBe('9 pages left in chapter')
    expect(progressText('location', p, '14%')).toBe('Loc 120 of 830')
    expect(progressText('percent', p, '14%')).toBe('14%')
  })

  it('says the last page and one page left the way a person would', () => {
    expect(progressText('left', progressOf({}, { page: 12, pages: 14 }), '')).toBe(
      'Last page in chapter'
    )
    expect(progressText('left', progressOf({}, { page: 11, pages: 14 }), '')).toBe(
      '1 page left in chapter'
    )
  })

  it('counts a scrolled chapter by screens', () => {
    const p = progressOf({}, { scrolled: true, start: 1200, size: 600, viewSize: 3000 })
    expect(p).toMatchObject({ page: 3, pages: 5 })
    expect(progressOf({}, { scrolled: true, start: 0, size: 0, viewSize: 0 })).toBeNull()
  })

  it('goes round its ways on a tap, past any it has nothing to say for', () => {
    const p = progressOf({ location: { current: 0, total: 10 } }, { page: 1, pages: 5 })
    expect(nextShow('page', p)).toBe('left')
    expect(nextShow('left', p)).toBe('location')
    expect(nextShow('location', p)).toBe('percent')
    expect(nextShow('percent', p)).toBe('page')
    // No locations (a book the engine could not measure): straight from pages left to percent.
    const noLoc = progressOf({}, { page: 1, pages: 5 })
    expect(nextShow('left', noLoc)).toBe('percent')
    // Nothing known of pages at all: the percentage only.
    expect(nextShow('percent', null)).toBe('percent')
  })
})
