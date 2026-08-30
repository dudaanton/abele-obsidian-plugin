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
    return 'Abele timeline'
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

    const open = GlobalStore.getInstance().timelineSidebarIds
    open.value = [...open.value, this.id]
  }

  async onClose() {
    // Only this pane's own id: a second panel of the same kind may have opened since, and
    // clearing the whole slot is what left the one still on screen blank.
    const open = GlobalStore.getInstance().timelineSidebarIds
    open.value = open.value.filter((id) => id !== this.id)
  }
}
