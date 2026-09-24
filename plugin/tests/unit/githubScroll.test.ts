/**
 * Scrolling a GitHub tab to what a link points at.
 *
 * happy-dom lays nothing out, so the layout is written by hand: a scrolling pane 500 px tall at
 * y=100, and a target whose place in the content is set by the test. What is asserted is the
 * scroll position of the element that actually scrolls — the one a person sees move.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { elementTop, pinIntoView, scrollParent } from '@/github/scrollTo'

const PANE_TOP = 100

let pane: HTMLElement
let inner: HTMLElement
let target: HTMLElement
/** Where the target sits in the content, as layout would put it. */
let targetY = 0
let paneHeight = 500

function rect(top: number, height = 20): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 100,
    width: 100,
    height,
    x: 0,
    y: top,
    toJSON() {},
  } as DOMRect
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'],
  })
  document.body.replaceChildren()
  pane = document.body.appendChild(document.createElement('div'))
  pane.style.overflowY = 'auto'
  // Clipped, but it does not scroll: the pane around it does.
  inner = pane.appendChild(document.createElement('div'))
  inner.style.overflow = 'hidden'
  target = inner.appendChild(document.createElement('div'))
  targetY = 800
  paneHeight = 500

  Object.defineProperty(pane, 'clientHeight', { get: () => paneHeight, configurable: true })
  pane.getBoundingClientRect = () => rect(PANE_TOP, paneHeight)
  target.getBoundingClientRect = () => rect(PANE_TOP + targetY - pane.scrollTop)
  target.getClientRects = () => [rect(0)] as unknown as DOMRectList
})

afterEach(() => {
  vi.useRealTimers()
})

const find = () => target

describe('pinning a target into view', () => {
  it('scrolls the pane that scrolls, not the clipped element inside it', () => {
    expect(scrollParent(target)).toBe(pane)
    pinIntoView(target, elementTop(find))
    // Near the top, with a little of what comes before it.
    expect(pane.scrollTop).toBe(800 - 16)
  })

  it('leaves the context asked for above a line of code', () => {
    pinIntoView(target, elementTop(find), { context: 96 })
    expect(pane.scrollTop).toBe(800 - 96)
  })

  it('waits for a target that is not there yet', () => {
    let there = false
    pinIntoView(
      target,
      elementTop(() => (there ? target : null))
    )
    vi.advanceTimersByTime(500)
    expect(pane.scrollTop).toBe(0)
    there = true
    vi.advanceTimersByTime(60)
    expect(pane.scrollTop).toBe(784)
  })

  it('waits for a hidden tab to be shown', () => {
    paneHeight = 0
    pinIntoView(target, elementTop(find))
    vi.advanceTimersByTime(300)
    expect(pane.scrollTop).toBe(0)
    paneHeight = 500
    vi.advanceTimersByTime(60)
    expect(pane.scrollTop).toBe(784)
  })

  it('follows the target while what is above it grows', () => {
    pinIntoView(target, elementTop(find))
    expect(pane.scrollTop).toBe(784)
    // An image above loads; the target moves 300 px further down.
    targetY = 1100
    vi.advanceTimersByTime(60)
    expect(pane.scrollTop).toBe(1084)
  })

  it('stops following once the person scrolls', () => {
    pinIntoView(target, elementTop(find))
    pane.dispatchEvent(new Event('wheel'))
    targetY = 1100
    vi.advanceTimersByTime(200)
    expect(pane.scrollTop).toBe(784)
  })

  it('stops once the layout has been still, so later scrolling is left alone', () => {
    pinIntoView(target, elementTop(find))
    vi.advanceTimersByTime(2000)
    targetY = 1100
    vi.advanceTimersByTime(200)
    expect(pane.scrollTop).toBe(784)
  })

  it('a second link replaces the first one being followed', () => {
    const other = inner.appendChild(document.createElement('div'))
    other.getBoundingClientRect = () => rect(PANE_TOP + 300 - pane.scrollTop)
    other.getClientRects = () => [rect(0)] as unknown as DOMRectList

    pinIntoView(target, elementTop(find))
    pinIntoView(
      other,
      elementTop(() => other)
    )
    targetY = 1500
    vi.advanceTimersByTime(200)
    expect(pane.scrollTop).toBe(300 - 16)
  })

  it('follows an estimate until the target is drawn, then settles on where it really is', () => {
    let drawn = false
    pinIntoView(target, () =>
      drawn ? PANE_TOP + 1300 - pane.scrollTop : { estimate: PANE_TOP + 900 - pane.scrollTop }
    )
    expect(pane.scrollTop).toBe(884)
    // Long past the time a drawn target would be taken as settled.
    vi.advanceTimersByTime(1500)
    drawn = true
    vi.advanceTimersByTime(60)
    expect(pane.scrollTop).toBe(1284)
  })
})
