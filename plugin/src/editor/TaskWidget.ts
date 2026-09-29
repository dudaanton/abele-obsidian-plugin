import { WidgetType } from '@codemirror/view'
import { Task } from '@/entities/Task'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { dropWidgetEntry, setWidgetMount } from '@/helpers/widgetMounts'

export class TaskWidget extends WidgetType {
  private readonly filePath: string // path of the file, where the task link is located
  private readonly wikilink: string // wikilink to the task note

  constructor(filePath: string, wikilink: string) {
    super()
    this.filePath = filePath
    this.wikilink = wikilink
  }

  toDOM() {
    // A fresh id each time: the same widget can be drawn again after its element is gone.
    const id = genid()
    const container = createDiv()
    container.id = id
    container.classList.add('abele-task-widget-container')
    // A press on the chevron or the card takes no focus itself, so it went to the editor around
    // it: the cursor landed on this line, which put the raw link back in place of the task and
    // scrolled to it. Focusable, but out of the tab order, the block keeps that focus.
    // The same as the list under the note, `FooterWidget`.
    container.tabIndex = -1

    const mount = container.createDiv({ attr: { 'data-task-id': id }, cls: 'abele-vue-mount' })

    const task = new Task({
      id,
      filePath: this.filePath,
      wikilink: this.wikilink,
    })
    // Before the store hears of it: the component is drawn into this element, not looked for.
    setWidgetMount(task, mount)
    GlobalStore.getInstance().tasksContainers.value.push(task)

    return container
  }

  destroy(dom: HTMLElement) {
    dropWidgetEntry(GlobalStore.getInstance().tasksContainers.value, dom)
  }

  eq(other: TaskWidget) {
    if (this.wikilink === other.wikilink) {
      return true
    }
    return false
  }

  ignoreEvent() {
    return true
  }
}
