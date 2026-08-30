import { GlobalStore } from '@/stores/GlobalStore'
import { nanoid } from 'nanoid'
import { ItemView, WorkspaceLeaf, App } from 'obsidian'

export const TIME_TRACKING_SIDEBAR_VIEW_TYPE = 'abele-time-tracking-sidebar-view'
export const TIME_TRACKING_SIDEBAR_ID_ATTR = 'abele-time-tracking-sidebar-id'

export class TimeTrackingSidebarView extends ItemView {
  private id: string

  constructor(leaf: WorkspaceLeaf, app: App) {
    super(leaf)
    this.app = app
    this.id = nanoid()
  }

  getViewType() {
    return TIME_TRACKING_SIDEBAR_VIEW_TYPE
  }

  getDisplayText() {
    return 'Abele time tracking'
  }

  static getIcon() {
    return 'timer'
  }

  getIcon() {
    return TimeTrackingSidebarView.getIcon()
  }

  async onOpen() {
    const container = this.containerEl.children[1]

    const widgetContainer = createDiv({ attr: { [TIME_TRACKING_SIDEBAR_ID_ATTR]: this.id } })
    container.appendChild(widgetContainer)

    const open = GlobalStore.getInstance().timeTrackingSidebarIds
    open.value = [...open.value, this.id]
  }

  async onClose() {
    // Only this pane's own id: a second panel of the same kind may have opened since, and
    // clearing the whole slot is what left the one still on screen blank.
    const open = GlobalStore.getInstance().timeTrackingSidebarIds
    open.value = open.value.filter((id) => id !== this.id)
  }
}
