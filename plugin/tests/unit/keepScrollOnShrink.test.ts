import { describe, it, expect } from 'vitest'
import { BOTTOM_MARGIN, heightToHold, heightToKeep } from '@/editor/keepScrollOnShrink'

describe('keeping the scroll when the block under a note shrinks', () => {
  // Scrolled to 572 in a 722-tall window; the list shrank and the browser pulled the scroll to 369.
  const clamped = { scrollTop: 369, scrollHeight: 1091, clientHeight: 722 }

  it('holds enough room for the old scroll, and a margin so the editor never sees the bottom', () => {
    const hold = heightToHold(clamped, 572, 600, 2125)
    expect(hold).toBe(600 + (572 + 722 + BOTTOM_MARGIN - 1091))
  })

  it('leaves a scroll the user moved alone', () => {
    // Scrolled up by hand: not at the end, and the block did not shrink.
    expect(
      heightToHold({ scrollTop: 300, scrollHeight: 2616, clientHeight: 722 }, 572, 2125, 2125)
    ).toBeNull()
  })

  it('leaves a clamp alone when the block did not shrink', () => {
    expect(heightToHold(clamped, 572, 2125, 2125)).toBeNull()
  })

  it('gives the room back as the user scrolls up', () => {
    // Held 1111 for content 600; scrolled up 200 past the margin.
    const box = { scrollTop: 372, scrollHeight: 1302, clientHeight: 722 }
    expect(heightToKeep(box, 1111, 600)).toBe(1111 - 200)
  })

  it('keeps the room while it is all in use', () => {
    const box = { scrollTop: 572, scrollHeight: 1302, clientHeight: 722 }
    expect(heightToKeep(box, 1111, 600)).toBe(1111)
  })

  it('lets go once the content fills the block again', () => {
    const box = { scrollTop: 572, scrollHeight: 2616, clientHeight: 722 }
    expect(heightToKeep(box, 1111, 2125)).toBeNull()
    expect(
      heightToKeep({ scrollTop: 0, scrollHeight: 1302, clientHeight: 722 }, 1111, 600)
    ).toBeNull()
  })
})
