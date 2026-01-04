import { WidgetType } from '@codemirror/view'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { Footer } from '@/entities/Footer'
import { reactive } from 'vue'

export class FooterWidget extends WidgetType {
  private readonly id: string
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

    GlobalStore.getInstance().footersContainers.value.push(
      reactive(
        new Footer({
          id: this.id,
          filePath: this.filePath,
        })
      )
    )

    return container
  }

  destroy() {
    const store = GlobalStore.getInstance()
    const index = store.footersContainers.value.findIndex((t) => t.id === this.id)
    if (index !== -1) {
      store.footersContainers.value[index].cleanup()
      store.footersContainers.value.splice(index, 1)
    }
  }

  eq(other: FooterWidget) {
    return this.filePath === other.filePath
  }

  ignoreEvent() {
    return true
  }
}
