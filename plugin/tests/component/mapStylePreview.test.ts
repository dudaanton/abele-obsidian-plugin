import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const drawn: { style: string; destroy: ReturnType<typeof vi.fn> }[] = []
vi.mock('@/helpers/mapRender', () => ({
  renderMap: vi.fn(async (_el: HTMLElement, config: { style: string; interactive: boolean }) => {
    const handle = { style: config.style, destroy: vi.fn() }
    drawn.push(handle)
    return handle
  }),
}))

import MapStylePreview from '@/components/settings/MapStylePreview.vue'

// The window the preview is drawn in decides what is in view.
const watchWith = (View: unknown) => {
  ;(document.defaultView as unknown as Record<string, unknown>).IntersectionObserver = View
}

// The preview is in view as soon as it is watched.
class InView {
  constructor(private readonly seen: (entries: { isIntersecting: boolean }[]) => void) {}
  observe() {
    this.seen([{ isIntersecting: true }])
  }
  disconnect() {}
}

beforeEach(() => {
  drawn.length = 0
  watchWith(InView)
})
afterEach(() => {
  watchWith(undefined)
})

it('draws nothing while it has not been scrolled into view', async () => {
  watchWith(
    class {
      observe() {}
      disconnect() {}
    }
  )
  const preview = mount(MapStylePreview, { props: { choice: 'positron', url: '' } })
  await flushPromises()
  await preview.setProps({ choice: 'fiord' })
  await flushPromises()
  expect(drawn).toEqual([])
  preview.unmount()
})

it('draws the picked style as a still picture and draws it again when the choice changes', async () => {
  const preview = mount(MapStylePreview, { props: { choice: 'positron', url: '' } })
  await flushPromises()
  expect(drawn.map((d) => d.style)).toEqual(['https://tiles.openfreemap.org/styles/positron'])

  await preview.setProps({ choice: 'fiord' })
  await flushPromises()
  expect(drawn.map((d) => d.style)).toEqual([
    'https://tiles.openfreemap.org/styles/positron',
    'https://tiles.openfreemap.org/styles/fiord',
  ])
  expect(drawn[0].destroy).toHaveBeenCalledOnce()

  preview.unmount()
  expect(drawn[1].destroy).toHaveBeenCalledOnce()
})

it('shows an own style once its address is given, and the theme style until then', async () => {
  const preview = mount(MapStylePreview, { props: { choice: 'custom', url: '' } })
  await flushPromises()
  await preview.setProps({ url: 'https://example.com/style.json' })
  await flushPromises()
  expect(drawn.map((d) => d.style)).toEqual([
    'https://tiles.openfreemap.org/styles/bright',
    'https://example.com/style.json',
  ])
  preview.unmount()
})
