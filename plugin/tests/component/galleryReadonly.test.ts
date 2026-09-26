/**
 * A gallery drawn where nothing can be edited.
 *
 * Reading mode, an embed and a script view have no editor behind them, so the header's add,
 * edit, settings and delete would do nothing there. They are not shown at all; the pictures
 * and the viewer are.
 */
import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import GalleryView from '@/components/Gallery.vue'
import { Gallery } from '@/entities/Gallery'
import { GlobalStore } from '@/stores/GlobalStore'
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

  it('does not turn into a drop target', async () => {
    const w = mount(GalleryView, { props: { gallery: gallery(true) } })

    await w.trigger('dragenter', { dataTransfer: { types: ['Files'], files: [] } })

    expect(w.classes()).not.toContain('abele-gallery_dragging')
    expect(w.find('.abele-gallery__drop-zone').exists()).toBe(false)
  })
})

describe('dropping files from the system onto an editable gallery', () => {
  it('copies pictures and videos into the note attachment folder and adds them to the gallery', async () => {
    const item = gallery(false)
    const addImages = vi.spyOn(item, 'addImages').mockImplementation(() => {})
    const { app } = GlobalStore.getInstance()
    ;(app.vault as unknown as { getConfig: () => string }).getConfig = () => './Media'

    const photo = new File(['photo'], 'summer.jpg', { type: 'image/jpeg' })
    const video = new File(['video'], 'walk.mp4', { type: 'video/mp4' })
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    for (const file of [photo, video, text]) {
      Object.defineProperty(file, 'arrayBuffer', {
        value: async () => new TextEncoder().encode(await file.text()).buffer,
      })
    }

    const w = mount(GalleryView, { props: { gallery: item } })
    const transfer = { types: ['Files'], files: [photo, video, text] }
    await w.trigger('dragenter', { dataTransfer: transfer })

    expect(w.classes()).toContain('abele-gallery_dragging')
    expect(w.find('.abele-gallery__drop-zone').text()).toContain('Drop')

    await w.trigger('drop', { dataTransfer: transfer })
    await flushPromises()

    expect(w.classes()).not.toContain('abele-gallery_dragging')
    expect(app.vault.getAbstractFileByPath('Notes/Media/summer.jpg')).not.toBeNull()
    expect(app.vault.getAbstractFileByPath('Notes/Media/walk.mp4')).not.toBeNull()
    expect(app.vault.getAbstractFileByPath('Notes/Media/notes.txt')).toBeNull()
    expect(addImages).toHaveBeenCalledWith(['Notes/Media/summer.jpg', 'Notes/Media/walk.mp4'])
  })
})

describe('a picture that is not in the vault yet', () => {
  it('shows up as soon as it arrives, without the note being opened again', async () => {
    // On a phone the note often arrives from sync before its attachment does.
    const item = gallery(true)
    const app = GlobalStore.getInstance().app as unknown as ReturnType<typeof useVault>
    const arrived = app.vault.getAbstractFileByPath('Attachments/a.jpg')
    const resolve = app.metadataCache.getFirstLinkpathDest.bind(app.metadataCache)
    let there = false
    app.metadataCache.getFirstLinkpathDest = (link, source) =>
      there ? resolve(link, source) : null

    const w = mount(GalleryView, { props: { gallery: item } })
    expect(w.find('.abele-gallery__image-error').exists()).toBe(true)

    there = true
    app.emit('vault', 'create', arrived)
    await flushPromises()

    expect(w.find('.abele-gallery__image-error').exists()).toBe(false)
    expect(w.find('.abele-gallery__image').attributes('src')).toBe('app://vault/Attachments/a.jpg')
  })
})
