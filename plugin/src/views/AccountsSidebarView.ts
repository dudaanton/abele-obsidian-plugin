import { GlobalStore } from '@/stores/GlobalStore'
import { nanoid } from 'nanoid'
import { ItemView, WorkspaceLeaf, App } from 'obsidian'
import { forgetPanel, trackPanelVisibility } from './panelVisibility'

export const ACCOUNTS_SIDEBAR_VIEW_TYPE = 'abele-accounts-sidebar-view'
export const ACCOUNTS_SIDEBAR_ID_ATTR = 'abele-accounts-sidebar-id'

/** Every finance account with its balance, in a sidebar. */
export class AccountsSidebarView extends ItemView {
  private id: string
  private updateVisibility: (() => void) | null = null

  constructor(leaf: WorkspaceLeaf, app: App) {
    super(leaf)
    this.app = app
    this.id = nanoid()
  }

  getViewType() {
    return ACCOUNTS_SIDEBAR_VIEW_TYPE
  }

  getDisplayText() {
    return 'Abele accounts'
  }

  static getIcon() {
    return 'landmark'
  }

  getIcon() {
    return AccountsSidebarView.getIcon()
  }

  async onOpen() {
    const container = this.containerEl.children[1]

    const widgetContainer = createDiv({ attr: { [ACCOUNTS_SIDEBAR_ID_ATTR]: this.id } })
    container.appendChild(widgetContainer)

    const open = GlobalStore.getInstance().accountsSidebarIds
    open.value = [...open.value, this.id]

    this.updateVisibility = trackPanelVisibility(this, this.id)
    this.updateVisibility()
  }

  onResize() {
    this.updateVisibility?.()
  }

  async onClose() {
    const open = GlobalStore.getInstance().accountsSidebarIds
    open.value = open.value.filter((id) => id !== this.id)
    forgetPanel(this.id)
  }
}
