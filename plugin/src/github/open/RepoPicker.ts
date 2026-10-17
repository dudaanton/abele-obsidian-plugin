/**
 * "Open GitHub repository…": Obsidian's own picker over the repositories there are to open —
 * pinned, recent on this device, the person's own and starred — narrowed as it is typed into, with
 * GitHub's repository search for anything typed that none of them holds. A choice opens the
 * repository's front page.
 */
import { Keymap, Notice, SuggestModal, type App } from 'obsidian'
import { SuggestionRows } from '@/components/obsidian/suggestionRows'
import { githubClient, githubSettings, openGithubUrl, connectionClient } from '../GithubService'
import { preferredConnection } from '../connections'
import { sameConnectionServer } from '../connectionRouting'
import { watch, type WatchStopHandle } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets } from '@/secrets/SecretStore'
import { repoKey, type RepoRef } from './query'
import {
  accountRepos,
  groupName,
  isPinned,
  pinnedRepos,
  recentRepos,
  repoRows,
  repoUrlOf,
  searchRepos,
  setPinned,
  type AccountRepos,
  type RepoEntry,
  type RepoGroup,
  type RepoRow,
} from './repoList'
import type { GithubClient } from '../client'
import { isNativeForge, nativeLabel } from '@/forge/native'
import { forgejoConnectionClient } from '@/forge/forgejoConnections'
import type { ForgejoClient } from '@/forge/forgejoClient'
import { nativeAccountRepos, nativeSearchRepos } from '@/forge/forgejoDirectory'

/** How long the typing has to pause before GitHub's search is asked. */
export const REPO_DEBOUNCE_MS = 350
const MIN_SEARCH = 2

const ICONS: Record<RepoRow['group'], string> = {
  pinned: 'pin',
  recent: 'history',
  own: 'book-marked',
  starred: 'star',
  found: 'search',
  note: 'info',
}

/** The first line of a refusal: the cause, without the fix, for a line of the picker. */
const problemOf = (e: unknown): string =>
  e instanceof Error ? e.message.split('\n')[0] : 'GitHub could not be asked.'

const OWNER_REPO = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/

export class RepoPicker extends SuggestModal<RepoRow> {
  private readonly rows = new SuggestionRows()
  private readonly client: GithubClient
  private readonly nativeClient?: ForgejoClient
  private get hasToken(): boolean {
    return this.nativeClient?.hasToken ?? this.client?.hasToken ?? false
  }
  private readonly connectionId?: string
  private stopWatching?: WatchStopHandle
  private invalidated = false
  private readonly host: string
  private account: AccountRepos | null = null
  private accountProblem = ''
  private readonly found = new Map<string, RepoEntry[] | string>()
  private timer: number | null = null

  constructor(app: App, client?: GithubClient) {
    super(app)
    const connections = githubSettings().connections ?? []
    const activeId = (
      app.workspace.getMostRecentLeaf?.()?.view as unknown as { model?: { connectionId?: string } }
    )?.model?.connectionId
    const active = connections.find((c) => c.id === activeId && isNativeForge(c.provider))
    const selected =
      active ??
      preferredConnection(connections) ??
      connections.find((c) => isNativeForge(c.provider) && c.isDefault)
    this.connectionId = client ? undefined : selected?.id
    if (!client && isNativeForge(selected?.provider))
      this.nativeClient = forgejoConnectionClient(selected.id)
    this.client = this.nativeClient
      ? undefined
      : (client ?? (this.connectionId ? connectionClient(this.connectionId) : githubClient()))
    this.host = this.nativeClient
      ? new URL(this.nativeClient.deployment.webBase).hostname
      : this.client.endpoints.webHost
    this.limit = 50
    this.setPlaceholder('Repository name, owner/repo')
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to open' },
      { command: 'mod ↵', purpose: 'to open in a new tab' },
      { command: 'alt ↵', purpose: 'to pin or unpin' },
      { command: 'esc', purpose: 'to dismiss' },
    ])
    this.modalEl.addClass('abele-github-repos')
    this.scope.register(['Alt'], 'Enter', () => {
      const row = this.selected()
      if (row?.repo) void this.togglePin(row.repo)
      return false
    })
  }

  onOpen(): void {
    void super.onOpen?.()
    this.stopWatching = watch(
      () => {
        void AbeleConfig.getInstance().version.value
        void secrets().version.value
        if (this.nativeClient) {
          try {
            return forgejoConnectionClient(this.connectionId).session.generation
          } catch {
            return 'unavailable'
          }
        }
        const id = preferredConnection(githubSettings().connections ?? [])?.id
        return id ? connectionClient(id).cacheNamespace : githubClient().cacheNamespace
      },
      () => {
        this.invalidated = true
        this.refresh()
      },
      { flush: 'sync' }
    )
    if (!this.hasToken) {
      this.accountProblem = 'Your own and starred repositories are listed with a token.'
      return
    }
    void (
      this.nativeClient ? nativeAccountRepos(this.nativeClient) : accountRepos(this.client)
    ).then(
      (lists) => {
        this.account = lists
        if (lists.problem) this.accountProblem = lists.problem
        this.refresh()
      },
      (e: unknown) => {
        this.accountProblem = problemOf(e)
        this.refresh()
      }
    )
  }

  onClose(): void {
    this.rows.clear()
    this.stopWatching?.()
    this.stopWatching = undefined
    super.onClose?.()
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }

  /** The row under the cursor: Obsidian keeps it on the picker's list, outside its typings. */
  private selected(): RepoRow | undefined {
    const chooser = (this as unknown as { chooser?: { values?: RepoRow[]; selectedItem?: number } })
      .chooser
    return chooser?.values?.[chooser.selectedItem ?? -1]
  }

  /** Shows the list again for what is in the field, with whatever has arrived since. */
  private refresh(): void {
    this.inputEl.dispatchEvent(new Event('input'))
  }

  private async togglePin(repo: RepoRef): Promise<void> {
    const pin = !isPinned(repo)
    await setPinned(repo, pin)
    new Notice(`${repo.owner}/${repo.repo} ${pin ? 'pinned' : 'unpinned'}.`)
    this.refresh()
  }

  private sources(query: string): Partial<Record<RepoGroup, RepoEntry[]>> {
    const typed = query.trim()
    const found = this.found.get(typed.toLowerCase())
    const named = OWNER_REPO.exec(typed)
    return {
      pinned: pinnedRepos(),
      recent: recentRepos(this.app),
      own: this.account?.own ?? [],
      starred: this.account?.starred ?? [],
      found: [
        // `owner/repo` typed whole is offered as itself, whether or not any list has it.
        ...(named
          ? [
              {
                host: this.host,
                ...(this.nativeClient
                  ? {
                      provider:
                        this.nativeClient.deployment.kind === 'gitea'
                          ? ('gitea' as const)
                          : ('forgejo' as const),
                      origin: this.nativeClient.deployment.webBase,
                    }
                  : {}),
                owner: named[1],
                repo: named[2].replace(/\.git$/, ''),
              },
            ]
          : []),
        ...(Array.isArray(found) ? found : []),
      ],
    }
  }

  private search(query: string): void {
    const typed = query.trim()
    const key = typed.toLowerCase()
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
    if (typed.length < MIN_SEARCH || this.found.has(key)) return
    this.timer = window.setTimeout(() => {
      this.timer = null
      this.found.set(key, [])
      void (
        this.nativeClient
          ? nativeSearchRepos(this.nativeClient, typed)
          : searchRepos(this.client, typed)
      )
        .then(
          (repos) => this.found.set(key, repos),
          (e: unknown) => this.found.set(key, problemOf(e))
        )
        .then(() => {
          if (this.inputEl.value.trim().toLowerCase() === key) this.refresh()
        })
    }, REPO_DEBOUNCE_MS)
  }

  getSuggestions(query: string): RepoRow[] {
    if (this.invalidated) {
      this.emptyStateText = 'The GitHub connection changed. Reopen this picker.'
      return []
    }
    this.search(query)
    const rows = repoRows(this.sources(query), query, this.limit)
    const notes: RepoRow[] = []
    const found = this.found.get(query.trim().toLowerCase())
    if (typeof found === 'string') notes.push({ group: 'note', title: found })
    if (this.accountProblem && !query.trim())
      notes.push({ group: 'note', title: this.accountProblem })
    else if (!this.account && this.hasToken && !this.accountProblem && !query.trim()) {
      notes.push({
        group: 'note',
        title: `Asking ${this.nativeClient ? nativeLabel(this.nativeClient.deployment.kind) : 'GitHub'} for your repositories…`,
      })
    }
    this.emptyStateText =
      query.trim().length >= MIN_SEARCH
        ? 'Nothing like that yet — asking GitHub…'
        : 'Type a repository name.'
    return [...rows, ...notes]
  }

  renderSuggestion(row: RepoRow, el: HTMLElement): void {
    const pinned = row.repo && row.group !== 'pinned' && isPinned(row.repo)
    this.rows.draw(el, {
      icon: pinned ? 'pin' : ICONS[row.group],
      title: row.title,
      note: row.note,
      aux: row.group !== 'note' ? [{ kbd: groupName(row.group) }] : [],
    })
  }

  /** A line that only says something keeps the picker open. */
  selectSuggestion(row: RepoRow, evt: MouseEvent | KeyboardEvent): void {
    if (row.group === 'note') return
    super.selectSuggestion(row, evt)
  }

  onChooseSuggestion(row: RepoRow, evt: MouseEvent | KeyboardEvent): void {
    if (row.repo) void this.choose(row.repo, Keymap.isModEvent(evt) ? 'tab' : false)
  }

  async choose(repo: RepoRef, pane: 'tab' | false): Promise<boolean> {
    if (this.invalidated || this.client?.isCurrent === false) {
      new Notice('The GitHub connection changed. Reopen this picker.')
      return false
    }
    if (this.nativeClient) {
      this.nativeClient.session.assertCurrent()
      return openGithubUrl(this.app, repoUrlOf(repo), pane, { sourceId: this.connectionId })
    }
    const opened =
      this.connectionId && sameConnectionServer({ server: this.client.endpoints.origin }, repo)
        ? await openGithubUrl(
            this.app,
            repoUrlOf({ ...repo, origin: this.client.endpoints.origin }),
            pane,
            { connectionId: this.connectionId }
          )
        : await openGithubUrl(this.app, repoUrlOf(repo), pane)
    if (!opened) new Notice(`Abele cannot show ${repoKey(repo)} in a GitHub tab.`)
    return opened
  }
}
