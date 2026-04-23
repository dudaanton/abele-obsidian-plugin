import { WidgetType } from '@codemirror/view'
import { Gallery } from '@/entities/Gallery'
import { GalleryImageEntry } from '@/helpers/galleryUtils'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { TFile } from 'obsidian'

export class GalleryWidget extends WidgetType {
  private id: string
  private readonly file: TFile
  private readonly images: GalleryImageEntry[]
  private readonly layout: string
  private readonly height: number
  private readonly bg: boolean

  constructor(
    file: TFile,
    images: GalleryImageEntry[],
    layout: string,
    height: number,
    bg: boolean
  ) {
    super()
    this.id = genid()
    this.file = file
    this.images = images
    this.layout = layout
    this.height = height
    this.bg = bg
  }

  toDOM() {
    const container = document.createElement('div')
    container.id = this.id
    container.classList.add('abele-gallery-widget-container')

    container.createDiv({ attr: { 'data-gallery-id': this.id }, cls: 'abele-vue-mount' })

    GlobalStore.getInstance().galleriesContainers.value.push(
      new Gallery({
        id: this.id,
        filePath: this.file.path,
        images: [...this.images],
        layout: this.layout,
        height: this.height,
        bg: this.bg,
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
    if (
      this.file === other.file &&
      this.layout === other.layout &&
      this.height === other.height &&
      this.bg === other.bg &&
      this.images.length === other.images.length &&
      this.images.every((img, i) => img.raw === other.images[i].raw)
    ) {
      this.id = other.id
      return true
    }
    return false
  }

  ignoreEvent() {
    return true
  }
}
