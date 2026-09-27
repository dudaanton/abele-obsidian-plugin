import { ItemView, type App, type WorkspaceLeaf } from 'obsidian'
import { createApp, type App as VueApp } from 'vue'
import LinterPanel from '@/components/linter/LinterPanel.vue'
import { LinterService } from './LinterService'
import type { LintTarget } from './types'
import { LINTER_VIEW_TYPE } from './viewType'

export { LINTER_VIEW_TYPE }

/**
 * The linter's report, in a tab of its own: what the last run found, by note or by rule, with the
 * way to each line and to the fixes.
 *
 * A Vue app of its own, as the documentation tab is: nothing else on screen shares its state, and
 * the report lives in `LinterService`, so closing the tab loses nothing.
 */
export class LinterView extends ItemView {
  private vue: VueApp | null = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }

  getViewType(): string {
    return LINTER_VIEW_TYPE
  }

  getDisplayText(): string {
    return 'Linter'
  }

  static getIcon(): string {
    return 'list-checks'
  }

  getIcon(): string {
    return LinterView.getIcon()
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty()
    this.contentEl.addClass('abele-linter-view')
    const mount = this.contentEl.createDiv({ cls: 'abele-linter-view__mount' })
    this.vue = createApp(LinterPanel)
    this.vue.mount(mount)
  }

  async onClose(): Promise<void> {
    this.vue?.unmount()
    this.vue = null
  }
}

/** Shows the linter's tab — the one already open, or a new one — and brings it forward. */
export async function openLinter(app: App): Promise<void> {
  const { workspace } = app
  const leaf = workspace.getLeavesOfType(LINTER_VIEW_TYPE)[0] ?? workspace.getLeaf('tab')
  if (leaf.view.getViewType() !== LINTER_VIEW_TYPE) {
    await leaf.setViewState({ type: LINTER_VIEW_TYPE, active: true })
  }
  await workspace.revealLeaf(leaf)
}

/** Opens the linter's tab and lints the target in it. */
export async function lintInView(app: App, target: LintTarget): Promise<void> {
  await openLinter(app)
  await LinterService.getInstance().run(target)
}
