/**
 * The kit's two ways into an element it is handed: a whole app (`mountKit`) and one component
 * rendered synchronously (`renderKit`). Both are taken out by their handle and by the owner's
 * unload, once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, onUnmounted } from 'vue'
import type { Component as ObsidianComponent } from 'obsidian'
import { mountKit, renderKit, unrenderKit } from '@/components/obsidian/mount'

/** An owner that runs what was registered when it unloads, as Obsidian's `Component` does. */
function owner() {
  const callbacks: (() => void)[] = []
  return {
    register: (cb: () => void) => callbacks.push(cb),
    unload: () => callbacks.splice(0).forEach((cb) => cb()),
  }
}

const unmounted = vi.fn()
const Sample = defineComponent({
  props: { text: String },
  setup: (props) => {
    onUnmounted(unmounted)
    return () => h('span', { class: 'sample' }, props.text)
  },
})

afterEach(() => {
  unmounted.mockClear()
  document.body.replaceChildren()
})

describe('mountKit', () => {
  it('mounts with props and unmounts once, by the handle or the owner', () => {
    const el = document.body.appendChild(document.createElement('div'))
    const host = owner()
    const ui = mountKit(
      el,
      Sample,
      { text: 'Sample' },
      { owner: host as unknown as ObsidianComponent }
    )
    expect(el.querySelector('.sample')?.textContent).toBe('Sample')
    ui.unmount()
    host.unload()
    ui.unmount()
    expect(unmounted).toHaveBeenCalledOnce()
    expect(el.childElementCount).toBe(0)
    expect(el.isConnected).toBe(true)
  })

  it('takes a container made for it out of the page when asked', () => {
    const el = document.body.appendChild(document.createElement('div'))
    const host = owner()
    mountKit(el, Sample, null, { owner: host as unknown as ObsidianComponent, remove: true })
    host.unload()
    expect(unmounted).toHaveBeenCalledOnce()
    expect(el.isConnected).toBe(false)
  })
})

describe('renderKit', () => {
  it('renders synchronously, redraws in place and is taken out once', () => {
    const el = document.body.appendChild(document.createElement('div'))
    const host = owner()
    renderKit(el, Sample, { text: 'First' })
    expect(el.querySelector('.sample')?.textContent).toBe('First')
    unrenderKit(el)
    expect(unmounted).toHaveBeenCalledOnce()
    const dispose = renderKit(el, Sample, { text: 'Second' }, host as unknown as ObsidianComponent)
    expect(el.textContent).toBe('Second')
    host.unload()
    dispose()
    expect(unmounted).toHaveBeenCalledTimes(2)
    expect(el.childElementCount).toBe(0)
  })
})
