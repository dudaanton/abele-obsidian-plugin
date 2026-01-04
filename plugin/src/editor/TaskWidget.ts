import { WidgetType } from '@codemirror/view'
import { Task } from '@/entities/Task'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'

export class TaskWidget extends WidgetType {
  private readonly id: string
  private readonly filePath: string // path of the file, where the task link is located
  private readonly wikilink: string // wikilink to the task note

  constructor(filePath: string, wikilink: string) {
    super()
    this.id = genid()
    this.filePath = filePath
    this.wikilink = wikilink
  }

  toDOM() {
    const container = document.createElement('div')
    container.id = this.id
    container.classList.add('abele-task-widget-container')

    container.createDiv({ attr: { 'data-task-id': this.id }, cls: 'abele-vue-mount' })

    GlobalStore.getInstance().tasksContainers.value.push(
      new Task({
        id: this.id,
        filePath: this.filePath,
        wikilink: this.wikilink,
      })
    )

    return container
  }

  destroy() {
    const store = GlobalStore.getInstance()
    const index = store.tasksContainers.value.findIndex((t) => t.id === this.id)
    if (index !== -1) {
      store.tasksContainers.value[index].cleanup()
      store.tasksContainers.value.splice(index, 1)
    }
  }

  eq(other: TaskWidget) {
    return this.wikilink === other.wikilink
  }

  ignoreEvent() {
    return true
  }
}
