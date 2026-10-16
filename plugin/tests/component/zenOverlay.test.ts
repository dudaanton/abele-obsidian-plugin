/**
 * Zen mode over the open tab: while it is there the body says so and carries the column's width;
 * a page gets the column's edges to drag, a surface goes edge to edge with none.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ZenOverlay from '@/components/zen/ZenOverlay.vue'
import { ZEN_MIN_WIDTH, zenWide, zenWidth } from '@/zen/zenLayout'

let view: VueWrapper | undefined
afterEach(() => view?.unmount())

describe('ZenOverlay', () => {
  it('uses the leaf document rather than the main window', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const doc = frame.contentDocument!
    view = mount(ZenOverlay, { props: { width: 800, wide: true, document: doc } })
    expect(doc.body.classList).toContain('abele-zen')
    expect(document.body.classList).not.toContain('abele-zen')
    view.unmount()
    view = undefined
    expect(doc.body.classList).not.toContain('abele-zen')
    frame.remove()
  })

  it('stops a drag when the overlay leaves the tab', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    view = mount(ZenOverlay, { props: { width: 700, wide: false } })
    await view.get('.abele-zen__edge').trigger('pointerdown', { clientX: 200 })
    view.unmount()
    view = undefined
    expect(remove).toHaveBeenCalledWith('pointerup', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('pointercancel', expect.any(Function))
    remove.mockRestore()
  })
  it('marks the body while mounted, with the width, and clears it after', () => {
    view = mount(ZenOverlay, { props: { width: 700, wide: false } })
    expect(document.body.classList).toContain('abele-zen')
    expect(document.body.style.getPropertyValue('--abele-zen-width')).toBe('700px')
    view.unmount()
    view = undefined
    expect(document.body.classList).not.toContain('abele-zen')
    expect(document.body.style.getPropertyValue('--abele-zen-width')).toBe('')
  })

  it('gives a page two edges that reset to 700 on a double click', async () => {
    view = mount(ZenOverlay, { props: { width: 900, wide: false } })
    const edges = view.findAll('.abele-zen__edge')
    expect(edges).toHaveLength(2)
    await edges[1].trigger('dblclick')
    expect(view.emitted('update:width')).toEqual([[700]])
  })

  it('leaves a surface edge to edge, with no edges', () => {
    view = mount(ZenOverlay, { props: { width: 700, wide: true } })
    expect(view.findAll('.abele-zen__edge')).toHaveLength(0)
    expect(document.body.classList).toContain('abele-zen-wide')
  })

  it('brings the header back while the pointer is at the top', async () => {
    view = mount(ZenOverlay, { props: { width: 700, wide: false } })
    await view.get('.abele-zen__top').trigger('pointerenter')
    expect(document.body.classList).toContain('abele-zen-header')
  })
})

describe('zen layout', () => {
  it('knows a canvas from a note', () => {
    expect(zenWide('canvas')).toBe(true)
    expect(zenWide('markdown')).toBe(false)
  })

  it('keeps the column inside the window and above its least', () => {
    expect(zenWidth(2000, 1200)).toBe(1200)
    expect(zenWidth(100, 1200)).toBe(ZEN_MIN_WIDTH)
  })
})
