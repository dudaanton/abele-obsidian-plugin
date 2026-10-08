import { afterEach, describe, expect, it, vi } from 'vitest'
import { horizontalOverflow } from '../e2e/helpers/horizontalOverflow'

/** happy-dom has no layout: synthetic rectangles describe the renderer's clipping geometry. */
function element(name: string, left: number, right: number, overflowX = 'visible') {
  const el = document.createElement('div')
  el.className = name
  el.style.overflowX = overflowX
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left,
    right,
    width: right - left,
    top: 0,
    bottom: 30,
    height: 30,
    x: left,
    y: 0,
    toJSON: () => ({}),
  })
  Object.defineProperties(el, {
    clientLeft: { value: 0 },
    clientWidth: { value: right - left },
  })
  return el
}

function pane() {
  const root = element('pane', 0, 356)
  document.body.appendChild(root)
  return root
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('horizontal overflow measured as visible content', () => {
  it.each(['auto', 'scroll'])('ignores tabs clipped by an overflow-x: %s strip', (overflow) => {
    const root = pane()
    const strip = element('strip', 0, 356, overflow)
    const tab = element('tab', 330, 411)
    tab.appendChild(element('label', 342, 399))
    strip.appendChild(tab)
    root.appendChild(strip)
    expect(horizontalOverflow(root)).toEqual([])
  })

  it('still reports the scroll container itself when it stands outside the pane', () => {
    const root = pane()
    root.appendChild(element('strip', 0, 411, 'auto'))
    expect(horizontalOverflow(root)).toEqual(['strip +55'])
  })

  it('reports only the visible reach of descendants inside an oversized scroller', () => {
    const root = pane()
    const strip = element('strip', 0, 380, 'auto')
    strip.appendChild(element('tab', 330, 411))
    root.appendChild(strip)
    expect(horizontalOverflow(root)).toEqual(['strip +24', 'tab +24'])
  })

  it('does not report fully clipped descendants of an oversized scroller', () => {
    const root = pane()
    const strip = element('strip', 0, 380, 'auto')
    strip.appendChild(element('tab', 400, 500))
    root.appendChild(strip)
    expect(horizontalOverflow(root)).toEqual(['strip +24'])
  })

  it('still reports real overflow beside a legitimate strip', () => {
    const root = pane()
    const strip = element('strip', 0, 356, 'auto')
    strip.appendChild(element('tab', 330, 411))
    root.append(strip, element('action', 330, 411))
    expect(horizontalOverflow(root)).toEqual(['action +55'])
  })

  it('does not exempt tabs merely because they have tab classes', () => {
    const root = pane()
    const strip = element('abele-tabs', 0, 356)
    strip.appendChild(element('abele-tabs__tab', 330, 411))
    root.appendChild(strip)
    expect(horizontalOverflow(root)).toEqual(['abele-tabs__tab +55'])
  })

  it('does not let an inner scroller remove an outer clipping boundary', () => {
    const root = pane()
    const outer = element('outer', 0, 356, 'auto')
    const inner = element('inner', 330, 500, 'scroll')
    inner.appendChild(element('label', 400, 550))
    outer.appendChild(inner)
    root.appendChild(outer)
    expect(horizontalOverflow(root)).toEqual([])
  })

  it('runs the same implementation after serialization into a renderer probe', () => {
    const root = pane()
    const strip = element('strip', 0, 356, 'auto')
    strip.appendChild(element('tab', 330, 411))
    root.append(strip, element('action', 330, 411))
    const serialized = new Function('root', `return (${horizontalOverflow.toString()})(root)`)
    expect(serialized(root)).toEqual(['action +55'])
  })
})
