import { ItemView, type App, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import { createApp, reactive, type App as VueApp } from 'vue'
import UserDocs from '@/components/docs/UserDocs.vue'
import { findPage, type DocTarget } from '@/userdocs'

export const USER_DOCS_VIEW_TYPE = 'abele-user-docs'

/**
 * The documentation for people, in a tab of its own.
 *
 * A Vue app of its own rather than a teleport from the plugin's root one, the way the book
 * reader does it: nothing else on screen shares its state, and it has none worth keeping once
 * the tab closes beyond which page was open — which is saved with the workspace below.
 */
export class UserDocsView extends ItemView {
  readonly model: DocTarget = reactive({ page: 'getting-started', heading: '' })
  private vue: VueApp | null = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }

  getViewType(): string {
    return USER_DOCS_VIEW_TYPE
  }

  getDisplayText(): string {
    return 'Abele documentation'
  }

  static getIcon(): string {
    return 'life-buoy'
  }

  getIcon(): string {
    return UserDocsView.getIcon()
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty()
    this.contentEl.addClass('abele-user-docs-view')
    const mount = this.contentEl.createDiv({ cls: 'abele-user-docs-view__mount' })
    this.vue = createApp(UserDocs, { model: this.model })
    this.vue.mount(mount)
  }

  async onClose(): Promise<void> {
    this.vue?.unmount()
    this.vue = null
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const next = state as Partial<DocTarget> | null
    if (next?.page && findPage(next.page)) {
      this.model.page = next.page
      this.model.heading = typeof next.heading === 'string' ? next.heading : ''
    }
    await super.setState(state, result)
  }

  getState(): Record<string, unknown> {
    return { page: this.model.page, heading: this.model.heading }
  }
}

/**
 * Opens the documentation at a page, in the tab already showing it or a new one.
 *
 * The entry points — the command, the settings, the first start — all come here.
 */
export async function openUserDocs(
  app: App,
  page = 'getting-started',
  heading = ''
): Promise<void> {
  const { workspace } = app
  const leaf = workspace.getLeavesOfType(USER_DOCS_VIEW_TYPE)[0] ?? workspace.getLeaf('tab')
  await leaf.setViewState({ type: USER_DOCS_VIEW_TYPE, active: true, state: { page, heading } })
  await workspace.revealLeaf(leaf)
}
