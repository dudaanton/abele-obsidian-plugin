import { WidgetType } from '@codemirror/view'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { dropWidgetEntry, setWidgetMount } from '@/helpers/widgetMounts'
import { TaskHeader } from '@/entities/TaskHeader'

export class TaskHeaderWidget extends WidgetType {
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
    container.classList.add('abele-task-header-widget-container')

    const mount = container.createDiv({
      attr: { 'data-task-header-id': id },
      cls: 'abele-vue-mount',
    })

    const header = new TaskHeader({
      id,
      filePath: this.filePath,
    })
    // Before the store hears of it: the component is drawn into this element, not looked for.
    setWidgetMount(header, mount)
    GlobalStore.getInstance().tasksHeadersContainers.value.push(header)

    return container
  }

  destroy(dom: HTMLElement) {
    dropWidgetEntry(GlobalStore.getInstance().tasksHeadersContainers.value, dom)
  }

  eq(other: TaskHeaderWidget) {
    if (this.filePath === other.filePath) {
      return true
    }
    return false
  }

  ignoreEvent() {
    return true
  }
}
