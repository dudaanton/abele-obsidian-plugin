import { WidgetType } from '@codemirror/view'
import { Gallery } from '@/entities/Gallery'
import { GalleryImageEntry } from '@/helpers/galleryUtils'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'

export class GalleryWidget extends WidgetType {
  private readonly id: string
  private readonly filePath: string
  private readonly images: GalleryImageEntry[]
  private readonly layout: string

  constructor(filePath: string, images: GalleryImageEntry[], layout: string) {
    super()
    this.id = genid()
    this.filePath = filePath
    this.images = images
    this.layout = layout
  }

  toDOM() {
    const container = document.createElement('div')
    container.id = this.id
    container.classList.add('abele-gallery-widget-container')

    container.createDiv({ attr: { 'data-gallery-id': this.id }, cls: 'abele-vue-mount' })

    GlobalStore.getInstance().galleriesContainers.value.push(
      new Gallery({
        id: this.id,
        filePath: this.filePath,
        images: [...this.images],
        layout: this.layout,
      })
    )

    return container
  }

  destroy() {
    const store = GlobalStore.getInstance()
    const index = store.galleriesContainers.value.findIndex((g) => g.id === this.id)
    if (index !== -1) {
      store.galleriesContainers.value[index].cleanup()
      store.galleriesContainers.value.splice(index, 1)
    }
  }

  eq(other: GalleryWidget) {
    return (
      this.filePath === other.filePath &&
      this.layout === other.layout &&
      this.images.length === other.images.length &&
      this.images.every((img, i) => img.raw === other.images[i].raw)
    )
  }

  ignoreEvent() {
    return true
  }
}
