/**
 * A gallery drawn where nothing can be edited.
 *
 * Reading mode, an embed and a script view have no editor behind them, so the header's add,
 * edit, settings and delete would do nothing there. They are not shown at all; the pictures
 * and the viewer are.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GalleryView from '@/components/Gallery.vue'
import { Gallery } from '@/entities/Gallery'
import { parseImageLine } from '@/helpers/galleryUtils'
import { useVault } from '../helpers/testEnv'

function gallery(readonly: boolean) {
  const app = useVault([{ path: 'Notes/A.md', content: '' }, { path: 'Attachments/a.jpg', content: '' }])
  ;(
    app.vault as unknown as { getResourcePath: (f: { path: string }) => string }
  ).getResourcePath = (f) => `app://vault/${f.path}`
  return new Gallery({
    file: null,
    sourcePath: 'Notes/A.md',
    images: [parseImageLine('![[a.jpg]]')!],
    layout: 'grid',
    height: 300,
    bg: true,
    readonly,
  })
}

describe('a read-only gallery', () => {
  it('shows the pictures and none of the editing controls', () => {
    const w = mount(GalleryView, { props: { gallery: gallery(true) } })

    expect(w.find('.abele-gallery__header').exists()).toBe(false)
    expect(w.classes()).toContain('abele-gallery_readonly')
    expect(w.find('.abele-gallery__image').attributes('src')).toBe('app://vault/Attachments/a.jpg')
  })

  it('is the editable one everywhere else', () => {
    const w = mount(GalleryView, { props: { gallery: gallery(false) } })

    expect(w.find('.abele-gallery__header').exists()).toBe(true)
  })
})
