/**
 * A tab showing one GitHub item: an issue, a pull request, a discussion, a commit or a file.
 *
 * The workspace keeps only the URL, so a tab comes back after a restart and loads again. The Vue
 * side is an app of its own mounted into the tab, the way the voice recorder is: nothing else in
 * the plugin needs to know these tabs exist.
 */
import {
  ItemView,
  Scope,
  Menu,
  type PaneType,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian'
import { createApp, reactive, h, type App as VueApp } from 'vue'
import { secrets } from '@/secrets/SecretStore'
import { readConnectionItem } from './connectionRead'
import { GithubError } from './client'
import type { GithubTarget } from './urls'
import { sameConnectionServer } from './connectionRouting'
import GithubItem from '@/components/github/GithubItem.vue'
import { shortName, targetKey } from './urls'
import type { GithubViewModel } from './model'
import { chatSubject, emptyScreen } from './screen'
import { OpenPicker } from './open/OpenPicker'
import { RepoPicker } from './open/RepoPicker'
import { isPinned, setPinned } from './open/repoList'
import { AbeleConfig } from '@/services/AbeleConfig'
import { revealSidebarView } from '@/views/revealSidebarView'
import { GITHUB_NOTIFICATIONS_VIEW_TYPE } from './notifications/NotificationsView'
import {
  GITHUB_VIEW_TYPE,
  githubClient,
  connectionClient,
  resolveConnectionCandidates,
  githubSettings,
  openGithubUrl,
  parseForSettings,
} from './GithubService'

export class GithubView extends ItemView {
  readonly model: GithubViewModel = reactive({
    url: '',
    target: null,
    nonce: 0,
    screen: emptyScreen(),
  })
  private title = ''
  private vue: VueApp | null = null
  /** Keys the tab handles itself; the Vue side watches them move. */
  private readonly keys = reactive({ find: 0 })

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    // A tab that follows links keeps a history, so its back arrow returns to the item before.
    this.navigation = true
  }

  getViewType() {
    return GITHUB_VIEW_TYPE
  }

  getDisplayText() {
    if (this.title) return this.title
    return this.model.target ? shortName(this.model.target) : 'GitHub'
  }

  getIcon() {
    return 'github'
  }

  /** Which item this tab shows, whatever line or comment it was last pointed at. */
  targetKey(): string | null {
    return this.model.target ? targetKey(this.model.target) : null
  }

  getState(): Record<string, unknown> {
    const state: Record<string, unknown> = { url: this.model.url }
    if (this.model.connectionId) {
      state.connectionId = this.model.connectionId
      state.connectionIntent = this.model.connectionIntent ?? 'automatic'
    }
    if (this.model.mode) state.mode = this.model.mode
    if (this.model.tree !== undefined) state.tree = this.model.tree
    return state
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const url = (state as { url?: unknown } | null)?.url
    if (typeof url === 'string' && url) {
      const target = parseForSettings(url)
      const requested = state as {
        connectionId?: string
        connectionIntent?: string
        allowedConnections?: string[]
      }
      let connectionId = requested.connectionId
      const exists = (githubSettings().connections ?? []).some((c) => c.id === connectionId)
      this.model.connectionNotice = ''
      if (connectionId && !exists) {
        connectionId = undefined
        this.model.connectionNotice =
          'The saved connection was removed. Selected another connection using the link rules.'
      }
      if (target) {
        const chosen = resolveConnectionCandidates(target, {
          explicitId: connectionId,
          allowedIds: requested.allowedConnections,
        })[0]
        connectionId = chosen?.id || undefined
      }
      const accountChanged = connectionId !== this.model.connectionId
      if (!target || targetKey(target) !== this.targetKey() || accountChanged) this.title = ''
      // Account-only navigation is history too. Clear agent-readable private content immediately.
      if (result && this.model.url && (url !== this.model.url || accountChanged))
        result.history = true
      if (accountChanged || url !== this.model.url) Object.assign(this.model.screen, emptyScreen())
      this.model.connectionId = connectionId
      this.model.connectionIntent = requested.connectionIntent === 'manual' ? 'manual' : 'automatic'
      this.model.allowedConnections = requested.allowedConnections
      const mode = (state as { mode?: unknown }).mode
      this.model.url = url
      this.model.target = target
      // A link followed says nothing of it: the file opens the way the link asks.
      this.model.mode = mode === 'preview' || mode === 'code' ? mode : undefined
      // The panel is the tab's, not the link's: only a tab that has not decided takes it from the
      // state — a restart. Back and forward leave it as it is.
      const tree = (state as { tree?: unknown }).tree
      if (this.model.tree === undefined && typeof tree === 'boolean') this.model.tree = tree
      this.model.nonce++
      this.refreshHeader()
    }
    await super.setState(state, result)
  }

  /**
   * Redraws the tab and the title above the content: `ItemView.load()` writes the title bar once
   * and never again, so a tab that learns its name later writes it itself. Neither call is in the
   * typings; ScriptView does the same.
   */
  private refreshHeader() {
    ;(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.()
    ;(this as unknown as { titleEl?: HTMLElement }).titleEl?.setText(this.getDisplayText())
  }

  /** Whether "Chat about this" has something to open a chat about: the item has loaded. */
  canChatAbout(): boolean {
    return !!this.model.screen.link && !!AbeleConfig.getInstance().ai?.enabled
  }

  /** A new chat with a link to the item — or to the selected lines, quoted — in its input. */
  chatAbout(): void {
    const subject = chatSubject(this.model.screen)
    if (subject)
      void import('./chatAbout').then((m) => m.askAboutGithub(subject.link, subject.quote))
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source)
    this.fillQuickMenu(menu)
  }

  private accountMenu(menu: Menu): void {
    const target = this.model.target
    if (!target) return
    const rows = githubSettings().connections.filter((c) => sameConnectionServer(c, target))
    for (const connection of rows) {
      menu.addItem((item) =>
        item
          .setTitle(
            `Open as ${connection.name}${connection.account ? ` · ${connection.account.login}` : ''}`
          )
          .setIcon('user-round')
          .setChecked(connection.id === this.model.connectionId)
          .onClick(() => {
            void this.setState(
              { url: this.model.url, connectionId: connection.id, connectionIntent: 'manual' },
              { history: false }
            )
          })
      )
    }
    const current = rows.find((c) => c.id === this.model.connectionId)
    if (current)
      menu.addItem((item) =>
        item
          .setTitle(`Always use ${current.name} for ${target.owner}`)
          .setChecked(current.owners.some((o) => o.toLowerCase() === target.owner.toLowerCase()))
          .onClick(async () => {
            const settings = githubSettings(),
              owner = target.owner.toLowerCase()
            const checked = current.owners.some((o) => o.toLowerCase() === owner)
            settings.connections = settings.connections.map((c) =>
              sameConnectionServer(c, target)
                ? {
                    ...c,
                    owners: [
                      ...c.owners.filter((o) => ![owner, `${owner}/*`].includes(o.toLowerCase())),
                      ...(!checked && c.id === current.id ? [target.owner] : []),
                    ],
                  }
                : c
            )
            await AbeleConfig.getInstance().saveSettings()
          })
      )
  }

  /** The tab's own items: its ⋯ menu, and the quick button's menu over it. */
  fillQuickMenu(menu: Menu): void {
    this.accountMenu(menu)
    menu.addItem((item) =>
      item
        .setTitle('Open another GitHub item…')
        .setIcon('github')
        .setSection('open')
        .onClick(() => new OpenPicker(this.app).open())
    )
    menu.addItem((item) =>
      item
        .setTitle('Open GitHub repository…')
        .setIcon('book-marked')
        .setSection('open')
        .onClick(() => new RepoPicker(this.app).open())
    )
    menu.addItem((item) =>
      item
        .setTitle('GitHub notifications')
        .setIcon('bell')
        .setSection('open')
        .onClick(() => void revealSidebarView(this.app, GITHUB_NOTIFICATIONS_VIEW_TYPE))
    )
    const t = this.model.target
    if (t) {
      const repo = { host: t.host, owner: t.owner, repo: t.repo }
      const pinned = isPinned(repo)
      menu.addItem((item) =>
        item
          .setTitle(pinned ? 'Unpin repository' : 'Pin repository')
          .setIcon(pinned ? 'pin-off' : 'pin')
          .setSection('open')
          .onClick(() => void setPinned(repo, !pinned))
      )
    }
    if (!this.canChatAbout()) return
    menu.addItem((item) =>
      item
        .setTitle('Chat about this')
        .setIcon('message-square-plus')
        .setSection('action')
        .onClick(() => this.chatAbout())
    )
  }

  async onOpen() {
    // Obsidian's own find works only in a note; in this tab Mod+F finds in what it shows.
    this.scope = new Scope(this.app.scope)
    this.scope.register(['Mod'], 'f', () => {
      this.keys.find++
      return false
    })
    this.contentEl.empty()
    this.contentEl.addClass('abele-github-view')
    const mountPoint = this.contentEl.createDiv({ cls: 'abele-github-view__mount' })
    this.vue = createApp({
      render: () => {
        void AbeleConfig.getInstance().version.value
        void secrets().version.value
        const id = this.model.connectionId
        const row = githubSettings().connections?.find((c) => c.id === id)
        if (id && !row && this.model.target) {
          const chosen = resolveConnectionCandidates(this.model.target)[0]
          this.model.connectionId = chosen?.id || undefined
          this.model.connectionNotice =
            'The connection was removed; selected another using the link rules.'
          Object.assign(this.model.screen, emptyScreen())
        }
        const client = this.model.connectionId
          ? connectionClient(this.model.connectionId)
          : githubClient(this.model.target?.host)
        return h(GithubItem, {
          key: client.cacheNamespace,
          model: this.model,
          enabled: githubSettings().enabled,
          clientFor: () => client,
          peopleClient: () => {
            const target = this.model.target
            const row =
              target &&
              githubSettings().connections.find(
                (c) => c.isDefault && sameConnectionServer(c, target)
              )
            return row ? connectionClient(row.id) : githubClient(target?.host)
          },
          accountName: (githubSettings().connections ?? []).length
            ? row
              ? `${row.name}${row.account ? ` · ${row.account.login}` : ''}`
              : 'Anonymous'
            : undefined,
          onChooseAccount: (event: MouseEvent) => {
            const menu = new Menu()
            this.accountMenu(menu)
            menu.showAtMouseEvent(event)
          },
          primaryLoad: (githubSettings().connections ?? []).length
            ? async (target: GithubTarget, promote: (target: GithubTarget) => void, retry = false) => {
                const startedId = this.model.connectionId,
                  startedUrl = this.model.url
                const result = await readConnectionItem(this.model, target, retry)
                if (this.model.connectionId !== startedId || this.model.url !== startedUrl)
                  throw new GithubError('other', 'The tab changed while loading.')
                promote(result.shown)
                if (result.notice) this.model.connectionNotice = result.notice
                this.model.connectionId = result.connectionId || undefined
                this.app.workspace.requestSaveLayout()
                return result.data
              }
            : undefined,
          onTitle: (title: string) => {
            this.title = title
            this.refreshHeader()
          },
          onOpen: (url: string, pane?: PaneType | false): void =>
            void openGithubUrl(this.app, url, pane ?? false, { sourceId: this.model.connectionId }),
          keys: this.keys,
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
