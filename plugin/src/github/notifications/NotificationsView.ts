/**
 * The GitHub notifications panel: a view of its own, opened in the right sidebar by the command
 * and able to live anywhere a view can. The workspace keeps its filters; the Vue side does the
 * rest, the way a GitHub tab does.
 */
import { openExternal } from '@/helpers/openExternal'
import { ItemView, type PaneType, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import { reactive, h } from 'vue'
import { mountKit, type KitMount } from '@/components/obsidian/mount'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets } from '@/secrets/SecretStore'
import GithubNotifications from '@/components/github/GithubNotifications.vue'
import NativeNotifications from '@/components/github/NativeNotifications.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { nativeInboxFor } from '@/forge/forgejoInbox'
import { isNativeForge, nativeLabel } from '@/forge/native'
import { isBrowsableConnection } from '../connections'
import { connectionClient, connectionGeneration } from '../GithubService'
import type { NotificationsState } from './inbox'
import { githubSettings, notificationsClient, openGithubUrl } from '../GithubService'

export const GITHUB_NOTIFICATIONS_VIEW_TYPE = 'abele-github-notifications'

export class NotificationsView extends ItemView {
  readonly state: NotificationsState = reactive({ which: 'all', repo: '' })
  private vue: KitMount | null = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }

  getViewType() {
    return GITHUB_NOTIFICATIONS_VIEW_TYPE
  }

  getDisplayText() {
    return 'Git notifications'
  }

  getIcon() {
    return 'bell'
  }

  getState(): Record<string, unknown> {
    return {
      which: this.state.which,
      repo: this.state.repo,
      inboxVersion: 1,
      ...(this.state.connection ? { connection: this.state.connection } : {}),
    }
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state ?? {}) as {
      which?: unknown
      repo?: unknown
      inboxVersion?: unknown
      connection?: unknown
    }
    // Old layouts inherited an unread-only default unlike GitHub's inbox. Migrate once; a
    // deliberate Unread choice saved by this version still travels through the layout.
    this.state.which = s.inboxVersion === 1 && s.which === 'unread' ? 'unread' : 'all'
    if (typeof s.repo === 'string') this.state.repo = s.repo
    if (typeof s.connection === 'string' && s.connection) this.state.connection = s.connection
    else delete this.state.connection
    await super.setState(state, result)
  }

  async onOpen() {
    this.contentEl.empty()
    this.contentEl.addClass('abele-github-notifications-view')
    const mountPoint = this.contentEl.createDiv()
    this.vue = mountKit(
      mountPoint,
      {
        render: () => {
          void AbeleConfig.getInstance().version.value
          void secrets().version.value
          const connections = (githubSettings().connections ?? []).filter(isBrowsableConnection)
          const id = this.state.connection || ''
          const selected = connections.find((c) => c.id === id)
          const selector = h(Dropdown, {
            'aria-label': 'Inbox account',
            modelValue: id,
            options: [
              { value: '', display: 'GitHub notifications account' },
              ...(id && !selected
                ? [{ value: id, display: 'Unavailable connection', disabled: true }]
                : []),
              ...connections.map((c) => ({
                value: c.id,
                display: `${c.name} · ${c.account?.login || 'account not checked'} · ${isNativeForge(c.provider) ? nativeLabel(c.provider) : 'GitHub'} · ${c.server || 'https://github.com'}`,
              })),
            ],
            'onUpdate:modelValue': (value: string) => {
              this.state.connection = value
              this.state.repo = ''
              this.app.workspace.requestSaveLayout()
            },
          })
          const save = () => this.app.workspace.requestSaveLayout()
          if (id && !selected)
            return h('div', [
              selector,
              h(EmptyState, {
                text: 'This inbox connection is unavailable. Choose another account.',
              }),
            ])
          if (selected && isNativeForge(selected.provider)) {
            try {
              const inbox = nativeInboxFor(id)
              return h('div', [
                selector,
                githubSettings().enabled
                  ? h(NativeNotifications, {
                      key: `${id}:${inbox.client.session.generation}`,
                      inbox,
                      state: this.state,
                      onOpen: (url: string, tab: boolean, pane: 'tab' | false): void =>
                        tab
                          ? void openGithubUrl(this.app, url, pane, {
                              connectionId: id,
                              manual: true,
                            })
                          : void openExternal(url),
                      onState: save,
                    })
                  : h(EmptyState, {
                      text: 'Git services are off. Turn them on in settings to read notifications.',
                    }),
              ])
            } catch (error) {
              return h('div', [selector, h(EmptyState, { text: String(error) })])
            }
          }
          return h('div', [
            selector,
            h(GithubNotifications, {
              key: `${id}:${id ? connectionGeneration(id) : 'legacy'}`,
              enabled: githubSettings().enabled,
              // The token's own server: notifications belong to the account, not to a repository. Read
              // with the notifications token when one is set, the main token otherwise.
              clientFor: () => {
                void AbeleConfig.getInstance().version.value
                void secrets().version.value
                return id
                  ? { client: connectionClient(id), separate: false }
                  : notificationsClient()
              },
              state: this.state,
              onOpen: (url: string, pane: PaneType | false): void =>
                void openGithubUrl(
                  this.app,
                  url,
                  pane,
                  id ? { connectionId: id, manual: true } : {}
                ),
              onExternal: (url: string): void => void openExternal(url),
              onState: () => this.app.workspace.requestSaveLayout(),
            }),
          ])
        },
      },
      null,
      { owner: this }
    )
  }

  async onClose() {
    this.vue?.unmount()
    this.vue = null
  }
}
