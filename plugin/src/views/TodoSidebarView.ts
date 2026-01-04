import { GlobalStore } from '@/stores/GlobalStore'
import { nanoid } from 'nanoid'
import { ItemView, WorkspaceLeaf, App } from 'obsidian'

export const TODO_SIDEBAR_VIEW_TYPE = 'abele-todo-sidebar-view'
export const TODO_SIDEBAR_ID_ATTR = 'abele-todo-sidebar-id'

export class TodoSidebarView extends ItemView {
  private id: string

  constructor(leaf: WorkspaceLeaf, app: App) {
    super(leaf)
    this.app = app
    this.id = nanoid()
  }

  getViewType() {
    return TODO_SIDEBAR_VIEW_TYPE
  }

  getDisplayText() {
    return 'Abele TODO'
  }

  static getIcon() {
    return 'list-todo'
  }

  getIcon() {
    return TodoSidebarView.getIcon()
  }

  async onOpen() {
    const container = this.containerEl.children[1]

    const widgetContainer = createDiv({ attr: { [TODO_SIDEBAR_ID_ATTR]: this.id } })
    container.appendChild(widgetContainer)

    GlobalStore.getInstance().todoSidebarId.value = this.id
  }

  async onClose() {
    const store = GlobalStore.getInstance()
    store.todoSidebarId.value = null
  }
}
