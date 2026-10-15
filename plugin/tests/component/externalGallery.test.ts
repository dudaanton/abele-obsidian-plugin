import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import GalleryView from '@/components/Gallery.vue'
import { Gallery } from '@/entities/Gallery'
import { parseImageLine } from '@/helpers/galleryUtils'
import { useVault } from '../helpers/testEnv'
import { tokenOffloadsOf } from '@/sync/tokenOffloadCoordinator'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>()
  return {
    ...actual,
    Menu: class extends actual.Menu {
      unload() {}
    },
  }
})

afterEach(() => vi.unstubAllGlobals())

it.each(['grid', 'masonry', 'slider'])(
  'loads only visible rows and preserves links in %s galleries',
  async (layout) => {
    let report!: (entries: Partial<IntersectionObserverEntry>[]) => void
    const disconnect = vi.fn()
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof report) {
          report = callback
        }
        observe() {}
        unobserve() {}
        disconnect = disconnect
      }
    )
    const app = useVault([{ path: 'Media/sample.png.abele-ref', content: 'projection' }])
    Object.assign(app.vault, {
      getResourcePath: (file: { path: string }) => `app://vault/${file.path}?1`,
    })
    const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
    manager.remember('sample', [{ path: 'Media/sample.png', size: 100, mtime: 1 }], [])
    const hydrate = vi.fn(async () => {
      await app.vault.create('Media/sample.png', 'image bytes')
    })
    manager.hydrator('sample', hydrate)
    const gallery = new Gallery({
      file: null,
      sourcePath: 'sample.md',
      images: [parseImageLine('![[Media/sample.png]]')!],
      layout,
      height: 300,
      bg: true,
      readonly: true,
    })
    const wrapper = mount(GalleryView, { props: { gallery } })
    await flushPromises()
    const target = wrapper.get('[data-gallery-index]').element
    report([{ target, isIntersecting: false }])
    expect(hydrate).not.toHaveBeenCalled()
    report([{ target, isIntersecting: true }])
    await flushPromises()
    expect(hydrate).toHaveBeenCalledOnce()
    expect(wrapper.get('img').attributes('src')).toContain('Media/sample.png')
    expect(gallery.images[0].raw).toBe('![[Media/sample.png]]')
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalled()
  }
)
