import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ScrollMore from '@/components/obsidian/ScrollMore.vue'

let report: ((entries: { isIntersecting: boolean }[]) => void) | undefined
class FakeObserver {
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
    report = cb
  }
  observe() {}
  disconnect() {}
}
const real = window.IntersectionObserver
afterEach(() => {
  window.IntersectionObserver = real
  report = undefined
})

describe('the end of a list that loads as it scrolls', () => {
  it('asks for more when it comes into view, not while a part is on its way, and again if still in view', async () => {
    window.IntersectionObserver = FakeObserver as never
    const w = mount(ScrollMore, { props: { shown: 20 }, attachTo: document.body })
    await nextTick()
    report!([{ isIntersecting: true }])
    expect(w.emitted('more')).toHaveLength(1)
    await w.setProps({ loading: true })
    report!([{ isIntersecting: true }])
    expect(w.emitted('more')).toHaveLength(1)
    expect(w.text()).toBe('Loading…')
    // A short part left the end in view: once it is drawn, more is asked without a crossing.
    await w.setProps({ loading: false, shown: 25 })
    await nextTick()
    expect(w.emitted('more')).toHaveLength(2)
    report!([{ isIntersecting: false }])
    await w.setProps({ shown: 30 })
    await nextTick()
    expect(w.emitted('more')).toHaveLength(2)
    w.unmount()
  })
})
