import { WidgetType } from '@codemirror/view'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { dropWidgetEntry, setWidgetMount } from '@/helpers/widgetMounts'
import { Header } from '@/entities/Header'

export class HeaderWidget extends WidgetType {
  private readonly filePath: string

  constructor(filePath: string) {
    super()
    this.filePath = filePath
  }

  toDOM() {
    // A fresh id each time: the same widget can be drawn again after its element is gone.
    const id = genid()
    const container = createDiv()
    container.id = id
    container.classList.add('abele-header-widget-container')

    const mount = container.createDiv({
      attr: { 'data-header-id': id },
      cls: 'abele-vue-mount',
    })

    const header = new Header({
      id,
      filePath: this.filePath,
    })
    // Before the store hears of it: the component is drawn into this element, not looked for.
    setWidgetMount(header, mount)
    GlobalStore.getInstance().headersContainers.value.push(header)

    return container
  }

  destroy(dom: HTMLElement) {
    dropWidgetEntry(GlobalStore.getInstance().headersContainers.value, dom)
  }

  eq(other: HeaderWidget) {
    if (this.filePath === other.filePath) {
      return true
    }
    return false
  }

  ignoreEvent() {
    return true
  }
}
