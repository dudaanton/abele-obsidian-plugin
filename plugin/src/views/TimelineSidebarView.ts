import { GlobalStore } from '@/stores/GlobalStore'
import { nanoid } from 'nanoid'
import { ItemView, WorkspaceLeaf, App } from 'obsidian'

export const TIMELINE_SIDEBAR_VIEW_TYPE = 'abele-timeline-sidebar-view'
export const TIMELINE_SIDEBAR_ID_ATTR = 'abele-timeline-sidebar-id'

export class TimelineSidebarView extends ItemView {
  private id: string

  constructor(leaf: WorkspaceLeaf, app: App) {
    super(leaf)
    this.app = app
    this.id = nanoid()
  }

  getViewType() {
    return TIMELINE_SIDEBAR_VIEW_TYPE
  }

  getDisplayText() {
    return 'Abele Timeline'
  }

  static getIcon() {
    return 'chart-gantt'
  }

  getIcon() {
    return TimelineSidebarView.getIcon()
  }

  async onOpen() {
    const container = this.containerEl.children[1]

    const widgetContainer = createDiv({ attr: { [TIMELINE_SIDEBAR_ID_ATTR]: this.id } })
    container.appendChild(widgetContainer)

    GlobalStore.getInstance().timelineSidebarId.value = this.id
  }

  async onClose() {
    const store = GlobalStore.getInstance()
    store.timelineSidebarId.value = null
  }
}
