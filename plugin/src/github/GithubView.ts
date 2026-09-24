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
  type Menu,
  type PaneType,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian'
import { createApp, reactive, type App as VueApp } from 'vue'
import GithubItem from '@/components/github/GithubItem.vue'
import { shortName, targetKey } from './urls'
import type { GithubViewModel } from './model'
import { chatSubject, emptyScreen } from './screen'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  GITHUB_VIEW_TYPE,
  githubClient,
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
    if (this.model.mode) state.mode = this.model.mode
    if (this.model.tree !== undefined) state.tree = this.model.tree
    return state
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const url = (state as { url?: unknown } | null)?.url
    if (typeof url === 'string' && url) {
      const target = parseForSettings(url)
      if (!target || targetKey(target) !== this.targetKey()) this.title = ''
      // A tab a link was followed in keeps where it was, for its back arrow.
      if (result && this.model.url && url !== this.model.url) result.history = true
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
    this.vue = createApp(GithubItem, {
      model: this.model,
      enabled: githubSettings().enabled,
      clientFor: (host: string) => githubClient(host),
      onTitle: (title: string) => {
        this.title = title
        this.refreshHeader()
      },
      onOpen: (url: string, pane?: PaneType | false): void =>
        void openGithubUrl(this.app, url, pane ?? false),
      keys: this.keys,
      onState: () => this.app.workspace.requestSaveLayout(),
    })
    this.vue.mount(mountPoint)
  }

  async onClose() {
    this.vue?.unmount()
    this.vue = null
  }
}
