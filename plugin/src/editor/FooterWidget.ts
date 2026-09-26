import { WidgetType } from '@codemirror/view'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { dropWidgetEntry, setWidgetMount } from '@/helpers/widgetMounts'
import { Footer } from '@/entities/Footer'
import { reactive } from 'vue'
import { TFile } from 'obsidian'
import { keepScrollOnShrink } from './keepScrollOnShrink'

/** Kept by the DOM, not the widget: CodeMirror hands a kept DOM over to an equal new widget. */
const scrollKeepers = new WeakMap<HTMLElement, () => void>()

export class FooterWidget extends WidgetType {
  private readonly file: TFile

  constructor(file: TFile) {
    super()
    this.file = file
  }

  toDOM() {
    // A fresh id each time: the same widget can be drawn again after its element is gone.
    const id = genid()
    const container = createDiv()
    container.id = id
    container.classList.add('abele-footer-widget-container')

    const mount = container.createDiv({
      attr: { 'data-footer-id': id },
      cls: 'abele-vue-mount',
    })
    scrollKeepers.set(container, keepScrollOnShrink(container, mount))

    const store = GlobalStore.getInstance()
    const footer = new Footer({
      id,
      filePath: this.file.path,
    })
    // Before the store hears of it: the component is drawn into this element, not looked for.
    setWidgetMount(footer, mount)
    store.footersContainers.value.push(reactive(footer))
    console.debug(
      `[FooterWidget] toDOM id=${id} file=${this.file.path} | total: ${store.footersContainers.value.length}`
    )

    return container
  }

  destroy(dom: HTMLElement) {
    scrollKeepers.get(dom)?.()
    scrollKeepers.delete(dom)
    const store = GlobalStore.getInstance()
    dropWidgetEntry(store.footersContainers.value, dom)
    console.debug(
      `[FooterWidget] destroy file=${this.file.path} | total: ${store.footersContainers.value.length}`
    )
  }

  eq(other: FooterWidget) {
    if (this.file === other.file) {
      return true
    }
    return false
  }

  ignoreEvent() {
    return true
  }
}
