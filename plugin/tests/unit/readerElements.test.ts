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
})
