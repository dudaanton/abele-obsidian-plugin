import { WidgetType } from '@codemirror/view'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { Footer } from '@/entities/Footer'
import { reactive } from 'vue'

export class FooterWidget extends WidgetType {
  private id: string
  private readonly filePath: string

  constructor(filePath: string) {
    super()
    this.id = genid()
    this.filePath = filePath
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
          filePath: this.filePath,
        })
      )
    )
    console.debug(
      `[FooterWidget] toDOM id=${this.id} file=${this.filePath} | total: ${store.footersContainers.value.length}`
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
        `[FooterWidget] destroy OK id=${this.id} file=${this.filePath} | total: ${store.footersContainers.value.length}`
      )
    } else {
      console.debug(
        `[FooterWidget] destroy MISS id=${this.id} file=${this.filePath} | total: ${store.footersContainers.value.length}`
      )
    }
  }

  eq(other: FooterWidget) {
    if (this.filePath === other.filePath) {
      other.id = this.id
      return true
    }
    return false
  }

  ignoreEvent() {
    return true
  }
}
