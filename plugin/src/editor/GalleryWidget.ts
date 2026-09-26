import { WidgetType } from '@codemirror/view'
import { Gallery } from '@/entities/Gallery'
import { GalleryImageEntry } from '@/helpers/galleryUtils'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { dropWidgetEntry, setWidgetMount } from '@/helpers/widgetMounts'
import { TFile } from 'obsidian'

export class GalleryWidget extends WidgetType {
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
    this.file = file
    this.images = images
    this.layout = layout
    this.height = height
    this.bg = bg
  }

  toDOM() {
    // A fresh id each time: the same widget can be drawn again after its element is gone.
    const id = genid()
    const container = createDiv()
    container.id = id
    container.classList.add('abele-gallery-widget-container')

    const mount = container.createDiv({
      attr: { 'data-gallery-id': id },
      cls: 'abele-vue-mount',
    })

    const gallery = new Gallery({
      id,
      file: this.file,
      images: [...this.images],
      layout: this.layout,
      height: this.height,
      bg: this.bg,
    })
    // Before the store hears of it: the component is drawn into this element, not looked for.
    // Not `mountEl`, which also tells the orphan sweep to leave the gallery alone.
    setWidgetMount(gallery, mount)
    GlobalStore.getInstance().galleriesContainers.value.push(gallery)

    return container
  }

  destroy(dom: HTMLElement) {
    dropWidgetEntry(GlobalStore.getInstance().galleriesContainers.value, dom)
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
      return true
    }
    return false
  }

  ignoreEvent() {
    return true
  }
}
