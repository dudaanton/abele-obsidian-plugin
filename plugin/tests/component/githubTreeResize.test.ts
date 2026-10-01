import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import GithubLayout from '@/components/github/GithubLayout.vue'
import { WIDTH_KEY } from '@/github/tree/panel'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

let observer: ResizeObserverCallback
class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    observer = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const wrappers: VueWrapper[] = []
const app = () => GlobalStore.getInstance().app
const handle = (view: VueWrapper) => view.find('.abele-github-layout__resize')
const sized = async (view: VueWrapper, width = 1000) => {
  observer(
    [{ target: view.element, contentRect: { width } } as ResizeObserverEntry],
    {} as ResizeObserver
  )
  await nextTick()
}
const render = async () => {
  const view = mount(GithubLayout, {
    props: { panel: true },
    attrs: { style: 'font-size: 16px' },
    attachTo: document.body,
  })
  wrappers.push(view)
  await nextTick()
  await sized(view)
  return view
}

beforeEach(() => {
  useVault([])
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GitHub tree split width', () => {
  it('has an accessible separator with arrow keys, bounds and Enter to reset', async () => {
    const view = await render()
    const divider = handle(view)
    expect(divider.attributes()).toMatchObject({
      role: 'separator',
      'aria-label': 'File tree width',
      'aria-orientation': 'vertical',
      tabindex: '0',
      'aria-valuemin': '192',
      'aria-valuemax': '400',
      'aria-valuenow': '288',
    })
    await divider.trigger('keydown', { key: 'ArrowRight' })
    expect(app().loadLocalStorage(WIDTH_KEY)).toBe(304)
    await divider.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
    expect(app().loadLocalStorage(WIDTH_KEY)).toBe(224)
    await divider.trigger('keydown', { key: 'Home' })
    await divider.trigger('keydown', { key: 'ArrowLeft' })
    expect(app().loadLocalStorage(WIDTH_KEY)).toBe(192)
    await divider.trigger('keydown', { key: 'End' })
    await divider.trigger('keydown', { key: 'ArrowRight' })
    expect(app().loadLocalStorage(WIDTH_KEY)).toBe(400)
    await divider.trigger('keydown', { key: 'Enter' })
    expect(app().loadLocalStorage(WIDTH_KEY)).toBeNull()
    expect(divider.attributes('aria-valuenow')).toBe('288')
  })

  it('uses pointer capture, clamps dragging and saves on release, not each move', async () => {
    const view = await render()
    const divider = handle(view)
    const el = divider.element as HTMLElement
    const save = vi.spyOn(app(), 'saveLocalStorage')
    el.setPointerCapture = vi.fn()
    el.hasPointerCapture = vi.fn(() => true)
    el.releasePointerCapture = vi.fn()
    await divider.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 300 })
    expect(el.setPointerCapture).toHaveBeenCalledWith(1)
    await divider.trigger('pointermove', { pointerId: 2, clientX: 900 })
    expect(divider.attributes('aria-valuenow')).toBe('288')
    await divider.trigger('pointermove', { pointerId: 1, clientX: 900 })
    expect(divider.attributes('aria-valuenow')).toBe('400')
    // The host returns null for an absent key; more importantly, moving must not write it.
    expect(app().loadLocalStorage(WIDTH_KEY)).toBeNull()
    expect(save).not.toHaveBeenCalled()
    await divider.trigger('pointermove', { pointerId: 1, clientX: -900 })
    expect(divider.attributes('aria-valuenow')).toBe('192')
    await divider.trigger('pointerup', { pointerId: 1 })
    expect(app().loadLocalStorage(WIDTH_KEY)).toBe(192)
    expect(el.releasePointerCapture).toHaveBeenCalledWith(1)
    expect(divider.classes()).not.toContain('is-active')
  })

  it('remembers a width for another tab and double-click clears that preference', async () => {
    app().saveLocalStorage(WIDTH_KEY, 330)
    const view = await render()
    expect(handle(view).attributes('aria-valuenow')).toBe('330')
    const next = await render()
    expect(handle(next).attributes('aria-valuenow')).toBe('330')
    await handle(next).trigger('dblclick')
    expect(app().loadLocalStorage(WIDTH_KEY)).toBeNull()
    expect(handle(next).attributes('aria-valuenow')).toBe('288')
  })

  it('adapts to a smaller desktop split without overwriting the remembered wide size', async () => {
    app().saveLocalStorage(WIDTH_KEY, 700)
    const view = await render()
    expect(handle(view).attributes('aria-valuenow')).toBe('400')
    await sized(view, 700)
    expect(handle(view).attributes('aria-valuenow')).toBe('280')
    expect(app().loadLocalStorage(WIDTH_KEY)).toBe(700)
    await sized(view, 2000)
    expect(handle(view).attributes('aria-valuemax')).toBe('576')
  })

  it('takes the divider out of the drawer tab order and ignores resizing there', async () => {
    app().saveLocalStorage(WIDTH_KEY, 330)
    const view = await render()
    await sized(view, 390)
    const divider = handle(view)
    expect(divider.attributes('tabindex')).toBe('-1')
    await divider.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 300 })
    await divider.trigger('keydown', { key: 'Home' })
    await divider.trigger('dblclick')
    expect(app().loadLocalStorage(WIDTH_KEY)).toBe(330)
    expect(divider.classes()).not.toContain('is-active')
  })

  it('moves toward the physical arrow in a right-to-left layout', async () => {
    const view = await render()
    ;(handle(view).element as HTMLElement).style.direction = 'rtl'
    await handle(view).trigger('keydown', { key: 'ArrowLeft' })
    expect(app().loadLocalStorage(WIDTH_KEY)).toBe(304)
    await handle(view).trigger('keydown', { key: 'ArrowRight' })
    expect(app().loadLocalStorage(WIDTH_KEY)).toBe(288)
  })

  it.each([null, '330', -1, 0, NaN, Infinity, {}])(
    'ignores malformed stored width %s',
    async (stored) => {
      app().saveLocalStorage(WIDTH_KEY, stored)
      const view = await render()
      expect(handle(view).attributes('aria-valuenow')).toBe('288')
    }
  )
})
