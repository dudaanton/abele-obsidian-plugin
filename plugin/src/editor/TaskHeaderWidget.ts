import { WidgetType } from '@codemirror/view'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { TaskHeader } from '@/entities/TaskHeader'

export class TaskHeaderWidget extends WidgetType {
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
    container.classList.add('abele-task-header-widget-container')

    container.createDiv({ attr: { 'data-task-header-id': this.id }, cls: 'abele-vue-mount' })

    GlobalStore.getInstance().tasksHeadersContainers.value.push(
      new TaskHeader({
        id: this.id,
        filePath: this.filePath,
      })
    )

    return container
  }

  destroy() {
    const store = GlobalStore.getInstance()
    const index = store.tasksHeadersContainers.value.findIndex((t) => t.id === this.id)
    if (index !== -1) {
      store.tasksHeadersContainers.value[index].cleanup()
      store.tasksHeadersContainers.value.splice(index, 1)
    }
  }

  eq(other: TaskHeaderWidget) {
    return this.filePath === other.filePath
  }

  ignoreEvent() {
    return true
  }
}
