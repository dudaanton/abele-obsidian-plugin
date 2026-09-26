import { WidgetType } from '@codemirror/view'
import { Task } from '@/entities/Task'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { setWidgetMount } from '@/helpers/widgetMounts'

export class TaskWidget extends WidgetType {
  private id: string
  private readonly filePath: string // path of the file, where the task link is located
  private readonly wikilink: string // wikilink to the task note

  constructor(filePath: string, wikilink: string) {
    super()
    this.id = genid()
    this.filePath = filePath
    this.wikilink = wikilink
  }

  toDOM() {
    const container = createDiv()
    container.id = this.id
    container.classList.add('abele-task-widget-container')

    const mount = container.createDiv({ attr: { 'data-task-id': this.id }, cls: 'abele-vue-mount' })

    const task = new Task({
      id: this.id,
      filePath: this.filePath,
      wikilink: this.wikilink,
    })
    // Before the store hears of it: the component is drawn into this element, not looked for.
    setWidgetMount(task, mount)
    GlobalStore.getInstance().tasksContainers.value.push(task)

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
    if (this.wikilink === other.wikilink) {
      this.id = other.id
      return true
    }
    return false
  }

  ignoreEvent() {
    return true
  }
}
