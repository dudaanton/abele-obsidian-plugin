import { GlobalStore } from '@/stores/GlobalStore'
import { nanoid } from 'nanoid'
import { ItemView, WorkspaceLeaf, App } from 'obsidian'
import { forgetPanel, registerPanelElement, trackPanelVisibility } from './panelVisibility'

export const FINANCE_SIDEBAR_VIEW_TYPE = 'abele-finance-sidebar-view'
export const FINANCE_SIDEBAR_ID_ATTR = 'abele-finance-sidebar-id'

export class FinanceSidebarView extends ItemView {
  private id: string
  private updateVisibility: (() => void) | null = null

  constructor(leaf: WorkspaceLeaf, app: App) {
    super(leaf)
    this.app = app
    this.id = nanoid()
  }

  getViewType() {
    return FINANCE_SIDEBAR_VIEW_TYPE
  }

  getDisplayText() {
    return 'Abele finance'
  }

  static getIcon() {
    return 'wallet'
  }

  getIcon() {
    return FinanceSidebarView.getIcon()
  }

  async onOpen() {
    const container = this.containerEl.children[1]

    const widgetContainer = createDiv({ attr: { [FINANCE_SIDEBAR_ID_ATTR]: this.id } })
    container.appendChild(widgetContainer)

    registerPanelElement(this.id, widgetContainer)
    const open = GlobalStore.getInstance().financeSidebarIds
    open.value = [...open.value, this.id]

    this.updateVisibility = trackPanelVisibility(this, this.id)
    this.updateVisibility()
  }

  onResize() {
    this.updateVisibility?.()
  }

  async onClose() {
    // Only this pane's own id: a second panel of the same kind may have opened since, and
    // clearing the whole slot is what left the one still on screen blank.
    const open = GlobalStore.getInstance().financeSidebarIds
    open.value = open.value.filter((id) => id !== this.id)
    forgetPanel(this.id)
  }
}
