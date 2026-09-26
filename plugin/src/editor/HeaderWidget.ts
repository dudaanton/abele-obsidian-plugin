import { WidgetType } from '@codemirror/view'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { setWidgetMount } from '@/helpers/widgetMounts'
import { Header } from '@/entities/Header'

export class HeaderWidget extends WidgetType {
  private id: string
  private readonly filePath: string

  constructor(filePath: string) {
    super()
    this.id = genid()
    this.filePath = filePath
  }

  toDOM() {
    const container = createDiv()
    container.id = this.id
    container.classList.add('abele-header-widget-container')

    const mount = container.createDiv({
      attr: { 'data-header-id': this.id },
      cls: 'abele-vue-mount',
    })

    const header = new Header({
      id: this.id,
      filePath: this.filePath,
    })
    // Before the store hears of it: the component is drawn into this element, not looked for.
    setWidgetMount(header, mount)
    GlobalStore.getInstance().headersContainers.value.push(header)

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
    if (this.filePath === other.filePath) {
      this.id = other.id
      return true
    }
    return false
  }

  ignoreEvent() {
    return true
  }
}
