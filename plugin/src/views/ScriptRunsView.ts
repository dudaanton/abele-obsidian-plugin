import { GlobalStore } from '@/stores/GlobalStore'
import { nanoid } from 'nanoid'
import { ItemView, WorkspaceLeaf, App } from 'obsidian'
import { forgetPanel, registerPanelElement, trackPanelVisibility } from './panelVisibility'

export const SCRIPT_RUNS_VIEW_TYPE = 'abele-script-runs-view'
export const SCRIPT_RUNS_ID_ATTR = 'abele-script-runs-id'

export class ScriptRunsView extends ItemView {
  private id: string
  private updateVisibility: (() => void) | null = null

  constructor(leaf: WorkspaceLeaf, app: App) {
    super(leaf)
    this.app = app
    this.id = nanoid()
  }

  getViewType() {
    return SCRIPT_RUNS_VIEW_TYPE
  }

  getDisplayText() {
    return 'Abele script runs'
  }

  static getIcon() {
    return 'terminal'
  }

  getIcon() {
    return ScriptRunsView.getIcon()
  }

  async onOpen() {
    const container = this.containerEl.children[1]

    const widgetContainer = createDiv({ attr: { [SCRIPT_RUNS_ID_ATTR]: this.id } })
    container.appendChild(widgetContainer)

    registerPanelElement(this.id, widgetContainer)
    this.updateVisibility = trackPanelVisibility(this, this.id)
    this.updateVisibility()
    const open = GlobalStore.getInstance().scriptRunsIds
    open.value = [...open.value, this.id]
  }

  onResize() {
    this.updateVisibility?.()
  }

  async onClose() {
    // Only this pane's own id: a second panel of the same kind may have opened since, and
    // clearing the whole slot is what left the one still on screen blank.
    const open = GlobalStore.getInstance().scriptRunsIds
    open.value = open.value.filter((id) => id !== this.id)
    forgetPanel(this.id)
  }
}
