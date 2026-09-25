import { describe, it, expect, vi } from 'vitest'

/**
 * The reader's elements are registered under names of one load of the plugin, so turning it off
 * and on — which an update does — registers them again instead of failing on names already taken.
 */
describe('reader element names', () => {
  it('differ from one load of the plugin to the next, and each is defined once', async () => {
    const first = await import('@/vendor/foliate-js/elements.js')
    vi.resetModules()
    const second = await import('@/vendor/foliate-js/elements.js')
    const a = first.tagName('foliate-view')
    const b = second.tagName('foliate-view')
    expect(a).toMatch(/^foliate-view-[a-z]{6}$/)
    expect(b).toMatch(/^foliate-view-[a-z]{6}$/)
    expect(a).not.toBe(b)

    class One extends HTMLElement {}
    class Two extends HTMLElement {}
    expect(first.defineElement('foliate-view', One)).toBe(a)
    expect(() => first.defineElement('foliate-view', One)).not.toThrow()
    expect(second.defineElement('foliate-view', Two)).toBe(b)
    expect(customElements.get(a)).toBe(One)
    expect(customElements.get(b)).toBe(Two)
  })

  it('registers the engine only when a book first asks for an element, not when the plugin loads', async () => {
    // A registered class can never be taken back and holds the whole bundle it came from, so a
    // load that registers nothing is one a reload can let go of.
    vi.resetModules()
    const elements = await import('@/vendor/foliate-js/elements.js')
    class Lazy extends HTMLElement {}
    elements.defineOnFirstUse('foliate-paginator', Lazy)
    const name = 'foliate-paginator-' + elements.tagName('x').slice(2)
    expect(customElements.get(name)).toBeUndefined()

    expect(elements.tagName('foliate-paginator')).toBe(name)
    expect(customElements.get(name)).toBe(Lazy)
    expect(() => elements.tagName('foliate-paginator')).not.toThrow()
  })

  it('leaves the engine unregistered by loading the reader modules', async () => {
    vi.resetModules()
    const elements = await import('@/vendor/foliate-js/elements.js')
    await import('@/vendor/foliate-js/view.js')
    const suffix = elements.tagName('x').slice(2)
    for (const base of ['foliate-view', 'foliate-paginator', 'foliate-fxl'])
      expect(customElements.get(`${base}-${suffix}`), base).toBeUndefined()
    expect(customElements.get(elements.tagName('foliate-view'))).toBeDefined()
  })
})
