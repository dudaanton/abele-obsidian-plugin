import { WidgetType } from '@codemirror/view'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { Header } from '@/entities/Header'

export class HeaderWidget extends WidgetType {
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
    container.classList.add('abele-header-widget-container')

    container.createDiv({ attr: { 'data-header-id': this.id }, cls: 'abele-vue-mount' })

    GlobalStore.getInstance().headersContainers.value.push(
      new Header({
        id: this.id,
        filePath: this.filePath,
      })
    )

    return container
  }

  destroy() {
    const store = GlobalStore.getInstance()
    const index = store.headersContainers.value.findIndex((t) => t.id === this.id)
    if (index !== -1) {
      store.headersContainers.value[index].cleanup()
      store.headersContainers.value.splice(index, 1)
    }
  }

  eq(other: HeaderWidget) {
    return this.filePath === other.filePath
  }

  ignoreEvent() {
    return true
  }
}
