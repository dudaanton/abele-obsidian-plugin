import { describe, expect, it } from 'vitest'
import { visibleToolbarTarget, findToolbarScroller } from '../helpers/visibleToolbarTarget'

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
})
describe('native toolbar touch coordinates', () => {
  it('uses the actual scrollable viewport, not the overflowing flex list inside it', () => {
    const bar = document.createElement('div'),
      viewport = document.createElement('div'),
      list = document.createElement('div'),
      button = document.createElement('button')
    document.body.append(bar)
    bar.append(viewport)
    viewport.append(list)
    list.append(button)
    viewport.style.overflowX = 'auto'
    list.style.overflowX = 'visible'
    for (const node of [viewport, list])
      Object.defineProperties(node, { scrollWidth: { value: 808 }, clientWidth: { value: 324 } })
    try {
      expect(findToolbarScroller(button, bar)).toBe(viewport)
    } finally {
      bar.remove()
    }
  })
  it('does not tap the off-screen centre of a horizontally clipped item', () => {
    expect(
      visibleToolbarTarget(rect(380, 400, 420, 440), rect(8, 400, 370, 444), rect(0, 0, 390, 844))
    ).toEqual({ scroll: 'left' })
  })
  it('requests the opposite swipe for an item hidden to the left', () => {
    expect(
      visibleToolbarTarget(rect(-30, 400, 10, 440), rect(8, 400, 370, 444), rect(0, 0, 390, 844))
    ).toEqual({ scroll: 'right' })
  })
  it('uses actual viewport coordinates after scrolling, not the old item position', () => {
    expect(
      visibleToolbarTarget(rect(190, 400, 230, 440), rect(8, 400, 370, 444), rect(0, 0, 390, 844))
    ).toEqual({ point: { x: 210, y: 420 } })
  })
  it('does not tap a toolbar below or above the viewport', () => {
    expect(
      visibleToolbarTarget(rect(100, 850, 140, 890), rect(0, 850, 390, 900), rect(0, 0, 390, 844))
    ).toEqual({ unavailable: true })
  })
})
