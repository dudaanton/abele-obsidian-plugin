import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import GalleryViewer from '@/components/GalleryViewer.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { buildFakeVault } from '../helpers/fakeVault'

let wrapper: VueWrapper | undefined
const images = [0, 1].map((i) => ({
  url: `https://example.invalid/sample-${i}.png`,
  path: `https://example.invalid/sample-${i}.png`,
  alt: `Sample ${i}`,
  type: 'remote' as const,
}))
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function open() {
  ;(GlobalStore.getInstance() as any)._app = buildFakeVault([])
  wrapper = mount(GalleryViewer, {
    props: { images, startIndex: 0, galleryFilePath: '' },
    global: { stubs: { teleport: true, ObsidianModal: { template: '<div><slot /></div>' } } },
  })
  await flushPromises()
  return wrapper
}

it('keeps arrow-key navigation, wraps around and closes on Escape', async () => {
  const viewer = await open()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
  await flushPromises()
  expect(viewer.find('img').attributes('alt')).toBe('Sample 1')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
  await flushPromises()
  expect(viewer.find('img').attributes('alt')).toBe('Sample 0')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(viewer.emitted('close')).toHaveLength(1)
})

// BUG: the gallery has a separate touch-only gesture path rather than the shared pointer viewer.
it('pinches with two pointers, pans with the remaining finger and resets for the next image', async () => {
  const viewer = await open()
  const frame = viewer.find('.abele-gallery-viewer__image-wrap')
  const fire = (type: string, id: number, x: number, y: number) =>
    frame.element.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        bubbles: true,
      })
    )
  fire('pointerdown', 1, 100, 100)
  fire('pointerdown', 2, 200, 100)
  fire('pointermove', 2, 300, 100)
  await flushPromises()
  const scaled = viewer.find('img').element.closest('[style*="scale"]') as HTMLElement
  expect(scaled?.style.transform).toContain('scale(2)')
  const before = scaled.style.transform
  fire('pointerup', 2, 300, 100)
  fire('pointermove', 1, 120, 120)
  await flushPromises()
  expect(scaled.style.transform).not.toBe(before)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
  await flushPromises()
  expect(
    (viewer.find('img').element.closest('[style*="scale"]') as HTMLElement).style.transform
  ).toContain('scale(1)')
})

it('swipes at fit, but never navigates on a cancelled gesture', async () => {
  const viewer = await open()
  const frame = viewer.find('.abele-gallery-viewer__image-wrap')
  const fire = (type: string, x: number) =>
    frame.element.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        pointerType: 'touch',
        clientX: x,
        clientY: 100,
        bubbles: true,
      })
    )
  fire('pointerdown', 200)
  fire('pointermove', 100)
  fire('pointercancel', 100)
  await flushPromises()
  expect(viewer.find('img').attributes('alt')).toBe('Sample 0')
  fire('pointerdown', 200)
  fire('pointermove', 100)
  fire('pointerup', 100)
  await flushPromises()
  expect(viewer.find('img').attributes('alt')).toBe('Sample 1')
})
