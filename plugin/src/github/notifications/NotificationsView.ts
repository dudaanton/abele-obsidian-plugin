/**
 * The GitHub notifications panel: a view of its own, opened in the right sidebar by the command
 * and able to live anywhere a view can. The workspace keeps its filters; the Vue side does the
 * rest, the way a GitHub tab does.
 */
import { openExternal } from '@/helpers/openExternal'
import { ItemView, type PaneType, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import { createApp, reactive, h, type App as VueApp } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets } from '@/secrets/SecretStore'
import GithubNotifications from '@/components/github/GithubNotifications.vue'
import type { NotificationsState } from './inbox'
import { githubSettings, notificationsClient, openGithubUrl } from '../GithubService'

export const GITHUB_NOTIFICATIONS_VIEW_TYPE = 'abele-github-notifications'

export class NotificationsView extends ItemView {
  readonly state: NotificationsState = reactive({ which: 'all', repo: '' })
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
    return { which: this.state.which, repo: this.state.repo, inboxVersion: 1 }
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state ?? {}) as { which?: unknown; repo?: unknown; inboxVersion?: unknown }
    // Old layouts inherited an unread-only default unlike GitHub's inbox. Migrate once; a
    // deliberate Unread choice saved by this version still travels through the layout.
    this.state.which = s.inboxVersion === 1 && s.which === 'unread' ? 'unread' : 'all'
    if (typeof s.repo === 'string') this.state.repo = s.repo
    await super.setState(state, result)
  }

  async onOpen() {
    this.contentEl.empty()
    this.contentEl.addClass('abele-github-notifications-view')
    const mountPoint = this.contentEl.createDiv()
    this.vue = createApp({
      render: () => {
        void AbeleConfig.getInstance().version.value
        return h(GithubNotifications, {
          enabled: githubSettings().enabled,
          // The token's own server: notifications belong to the account, not to a repository. Read
          // with the notifications token when one is set, the main token otherwise.
          clientFor: () => {
            void AbeleConfig.getInstance().version.value
            void secrets().version.value
            return notificationsClient()
          },
          state: this.state,
          onOpen: (url: string, pane: PaneType | false): void =>
            void openGithubUrl(this.app, url, pane),
          onExternal: (url: string): void => void openExternal(url),
          onState: () => this.app.workspace.requestSaveLayout(),
        })
      },
    })
    this.vue.mount(mountPoint)
  }

  async onClose() {
    this.vue?.unmount()
    this.vue = null
  }
}
