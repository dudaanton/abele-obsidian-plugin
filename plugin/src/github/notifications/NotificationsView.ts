/**
 * The GitHub notifications panel: a view of its own, opened in the right sidebar by the command
 * and able to live anywhere a view can. The workspace keeps its filters; the Vue side does the
 * rest, the way a GitHub tab does.
 */
import { ItemView, type PaneType, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import { createApp, reactive, type App as VueApp } from 'vue'
import GithubNotifications from '@/components/github/GithubNotifications.vue'
import type { NotificationsState } from './inbox'
import { githubClient, githubSettings, openGithubUrl } from '../GithubService'

export const GITHUB_NOTIFICATIONS_VIEW_TYPE = 'abele-github-notifications'

export class NotificationsView extends ItemView {
  readonly state: NotificationsState = reactive({ which: 'unread', repo: '' })
  private vue: VueApp | null = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }

  getViewType() {
    return GITHUB_NOTIFICATIONS_VIEW_TYPE
  }

  getDisplayText() {
    return 'GitHub notifications'
  }

  getIcon() {
    return 'bell'
  }

  getState(): Record<string, unknown> {
    return { which: this.state.which, repo: this.state.repo }
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state ?? {}) as { which?: unknown; repo?: unknown }
    if (s.which === 'unread' || s.which === 'all') this.state.which = s.which
    if (typeof s.repo === 'string') this.state.repo = s.repo
    await super.setState(state, result)
  }

  async onOpen() {
    this.contentEl.empty()
    this.contentEl.addClass('abele-github-notifications-view')
    const mountPoint = this.contentEl.createDiv()
    this.vue = createApp(GithubNotifications, {
      enabled: githubSettings().enabled,
      // The token's own server: notifications belong to the account, not to a repository.
      clientFor: () => githubClient(),
      state: this.state,
      onOpen: (url: string, pane: PaneType | false): void =>
        void openGithubUrl(this.app, url, pane),
      onExternal: (url: string): void => void window.open(url),
      onState: () => this.app.workspace.requestSaveLayout(),
    })
    this.vue.mount(mountPoint)
  }

  async onClose() {
    this.vue?.unmount()
    this.vue = null
  }
}
