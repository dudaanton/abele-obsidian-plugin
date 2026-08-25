import { GlobalStore } from '@/stores/GlobalStore'
import { nanoid } from 'nanoid'
import { ItemView, WorkspaceLeaf, App } from 'obsidian'
import { AI_SIDEBAR_VIEW_TYPE, AI_SIDEBAR_ID_ATTR } from '@/constants/views'

export { AI_SIDEBAR_VIEW_TYPE, AI_SIDEBAR_ID_ATTR }

export class AiSidebarView extends ItemView {
  private id: string

  constructor(leaf: WorkspaceLeaf, app: App) {
    super(leaf)
    this.app = app
    this.id = nanoid()
  }

  getViewType() {
    return AI_SIDEBAR_VIEW_TYPE
  }

  getDisplayText() {
    return 'Abele AI chat'
  }

  static getIcon() {
    return 'bot'
  }

  getIcon() {
    return AiSidebarView.getIcon()
  }

  async onOpen() {
    const container = this.containerEl.children[1]

    const widgetContainer = createDiv({ attr: { [AI_SIDEBAR_ID_ATTR]: this.id } })
    container.appendChild(widgetContainer)

    GlobalStore.getInstance().aiSidebarId.value = this.id
  }

  async onClose() {
    const store = GlobalStore.getInstance()
    store.aiSidebarId.value = null
  }
}
