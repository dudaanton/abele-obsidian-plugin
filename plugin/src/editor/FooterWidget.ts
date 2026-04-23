import { WidgetType } from '@codemirror/view'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { Footer } from '@/entities/Footer'
import { reactive } from 'vue'
import { TFile } from 'obsidian'

export class FooterWidget extends WidgetType {
  private id: string
  private readonly file: TFile

  constructor(file: TFile) {
    super()
    this.id = genid()
    this.file = file
  }

  toDOM() {
    const container = document.createElement('div')
    container.id = this.id
    container.classList.add('abele-footer-widget-container')

    container.createDiv({ attr: { 'data-footer-id': this.id }, cls: 'abele-vue-mount' })

    const store = GlobalStore.getInstance()
    store.footersContainers.value.push(
      reactive(
        new Footer({
          id: this.id,
          filePath: this.file.path,
        })
      )
    )
    console.debug(
      `[FooterWidget] toDOM id=${this.id} file=${this.file.path} | total: ${store.footersContainers.value.length}`
    )

    return container
  }

  destroy() {
    const store = GlobalStore.getInstance()
    const index = store.footersContainers.value.findIndex((t) => t.id === this.id)
    if (index !== -1) {
      store.footersContainers.value[index].cleanup()
      store.footersContainers.value.splice(index, 1)
      console.debug(
        `[FooterWidget] destroy OK id=${this.id} file=${this.file.path} | total: ${store.footersContainers.value.length}`
      )
    } else {
      console.debug(
        `[FooterWidget] destroy MISS id=${this.id} file=${this.file.path} | total: ${store.footersContainers.value.length}`
      )
    }
  }

  eq(other: FooterWidget) {
    if (this.file === other.file) {
      this.id = other.id
      return true
    }
    return false
  }

  ignoreEvent() {
    return true
  }
}
