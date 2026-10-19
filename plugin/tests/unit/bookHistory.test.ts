import { describe, expect, it, vi } from 'vitest'
import { View } from '@/vendor/foliate-js/view.js'
import { tagName } from '@/vendor/foliate-js/elements.js'

function reader() {
  tagName('foliate-view')
  const view = new View()
  const goTo = vi.fn(async (target: { index: number }) => {
    view.lastLocation = { cfi: String(target.index) }
  })
  view.renderer = { goTo, destroy: vi.fn(), remove: vi.fn() } as never
  vi.spyOn(view, 'resolveNavigation').mockImplementation((target) => ({ index: Number(target) }))
  return { view, goTo }
}

describe('book jump history', () => {
  it('keeps the departure when a renderer reports scroll during a jump or history replay', async () => {
    class Renderer extends HTMLElement {
      open() {}
      async goTo({ index }: { index: number }) {
        this.dispatchEvent(
          new CustomEvent('relocate', {
            detail: { reason: 'scroll', index, fraction: 0, size: 1 },
          })
        )
      }
    }
    customElements.define('sample-history-renderer', Renderer)
    tagName('foliate-view')
    const view = new View()
    vi.spyOn(view, 'getCFI').mockImplementation((index) => String(index))
    vi.spyOn(view, 'resolveNavigation').mockImplementation((target) => ({ index: Number(target) }))
    await view.open({
      sections: [0, 1, 2].map((id) => ({ id, size: 100, load: () => '' })),
      rendition: { layout: 'pre-paginated' },
      fixedLayoutRenderer: 'sample-history-renderer',
      splitTOCHref: () => [],
      getTOCFragment: () => null,
    })
    await view.init({ lastLocation: '0' })
    await view.goToFraction(0.8)
    expect(view.history.canGoBack).toBe(true)
    view.history.back()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.lastLocation?.cfi).toBe('0')
    expect(view.history.canGoBack).toBe(false)
    expect(view.history.canGoForward).toBe(true)
    // Replay resolves the saved fraction through the engine's normal resolver.
    vi.mocked(view.resolveNavigation).mockImplementation((target) => ({
      index: typeof target === 'object' ? 2 : Number(target),
    }))
    view.history.forward()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.lastLocation?.cfi).toBe('2')
  })

  it('does not turn page reads into jumps, and truncates forward after a new jump', async () => {
    const { view } = reader()
    await view.init({ lastLocation: '1' })
    view.lastLocation = { cfi: '2' }
    expect(view.history.canGoBack).toBe(false)
    await view.goTo('3')
    view.history.back()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(view.history.canGoForward).toBe(true)
    await view.goTo('5')
    expect(view.history.canGoForward).toBe(false)
  })

  it.each(['goTo', 'select'] as const)(
    'captures the visible place before %s when revisiting the initial target',
    async (method) => {
      const { view, goTo } = reader()
      await view.init({ lastLocation: '1' })
      view.lastLocation = { cfi: '2' }
      await view[method]('1')
      expect(view.history.canGoBack).toBe(true)
      view.history.back()
      expect(goTo).toHaveBeenLastCalledWith({ index: 2 })
      expect(view.history.canGoForward).toBe(true)
    }
  )

  it('preserves the place read after a jump when going back then forward', async () => {
    const { view, goTo } = reader()
    await view.init({ lastLocation: '1' })
    view.lastLocation = { cfi: '2' }
    await view.goTo('3')
    view.lastLocation = { cfi: '4' }
    view.history.back()
    expect(goTo).toHaveBeenLastCalledWith({ index: 2 })
    view.history.forward()
    expect(goTo).toHaveBeenLastCalledWith({ index: 4 })
  })

  it('clears availability when the book closes', async () => {
    const { view } = reader()
    await view.init({ lastLocation: '1' })
    await view.goTo('2')
    const changed = vi.fn()
    view.history.addEventListener('index-change', changed)
    view.close()
    expect(view.history.canGoBack).toBe(false)
    expect(view.history.canGoForward).toBe(false)
    expect(changed).toHaveBeenCalled()
  })
})
