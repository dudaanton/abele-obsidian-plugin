/**
 * "Open on GitHub": Obsidian's own picker, into which a GitHub link is pasted or a number, a
 * title, a branch or a commit is typed, with what GitHub has for it offered while typing.
 *
 * Which repository a bare `#12` means: the one the active GitHub tab shows; else the one the
 * GitHub tab used last shows; else the repository something was last opened in from this picker,
 * this session; else the default repository in the settings. Anything typed as `owner/repo…`
 * names its own.
 */
import { Keymap, Notice, SuggestModal, setIcon, type App } from 'obsidian'
import { parseRepoInput } from '../accessCheck'
import {
  githubClient,
  githubHosts,
  githubSettings,
  lastUsedGithubLeaf,
  openGithubUrl,
  GITHUB_VIEW_TYPE,
} from '../GithubService'
import { endpoints } from '../urls'
import type { GithubViewModel } from '../model'
import { parseOpenQuery, type OpenQuery, type RepoRef } from './query'
import { OpenSearch, kindName, type OpenRow, type RowKind } from './search'

/** How long the typing has to pause before GitHub is asked. */
export const DEBOUNCE_MS = 350

const ICONS: Record<RowKind, string> = {
  pull: 'git-pull-request',
  issue: 'circle-dot',
  discussion: 'messages-square',
  commit: 'git-commit-horizontal',
  compare: 'git-compare',
  branch: 'git-branch',
  repo: 'book-marked',
  file: 'file-code',
  folder: 'folder',
  note: 'info',
}

/** The repository something was last opened in from the picker, this session. */
let lastPicked: RepoRef | null = null

export const forgetLastPicked = () => {
  lastPicked = null
}

const repoOfTarget = (model: GithubViewModel | undefined): RepoRef | null => {
  const t = model?.target
  return t ? { host: t.host, owner: t.owner, repo: t.repo } : null
}

/** The repository a bare number or a title is looked up in; see the top of the file. */
export function pickerRepo(app: App): RepoRef | null {
  const active = app.workspace.getMostRecentLeaf?.() ?? null
  const view = active?.view as unknown as { getViewType?(): string; model?: GithubViewModel }
  if (view?.getViewType?.() === GITHUB_VIEW_TYPE) {
    const repo = repoOfTarget(view.model)
    if (repo) return repo
  }
  // A GitHub tab closed since is remembered still; only one that is open counts.
  const lastLeaf = lastUsedGithubLeaf()
  const open = app.workspace.getLeavesOfType?.(GITHUB_VIEW_TYPE) ?? []
  const last =
    lastLeaf && open.includes(lastLeaf)
      ? repoOfTarget((lastLeaf.view as unknown as { model?: GithubViewModel }).model)
      : null
  if (last) return last
  if (lastPicked) return lastPicked
  const configured = githubSettings().defaultRepo?.trim()
  return configured ? parseRepoInput(configured, endpoints(githubSettings().server).webHost) : null
}

export class OpenPicker extends SuggestModal<OpenRow> {
  private readonly search: OpenSearch
  private readonly repo: RepoRef | null
  private readonly defaultHost: string
  private timer: number | null = null

  constructor(
    app: App,
    private readonly initial = '',
    search?: OpenSearch
  ) {
    super(app)
    this.search = search ?? new OpenSearch((host) => githubClient(host))
    this.repo = pickerRepo(app)
    this.defaultHost = endpoints(githubSettings().server).webHost
    this.limit = 50
    // Short enough for a phone's field; the empty list under it names the repository.
    this.setPlaceholder(
      this.repo ? 'Link, #123, title, branch or commit' : 'Link, owner/repo#123 or owner/repo'
    )
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to open' },
      { command: 'mod ↵', purpose: 'to open in a new tab' },
      { command: 'esc', purpose: 'to dismiss' },
    ])
    this.modalEl.addClass('abele-github-open')
  }

  onOpen(): void {
    void super.onOpen?.()
    if (this.initial) {
      this.inputEl.value = this.initial
      this.inputEl.dispatchEvent(new Event('input'))
    }
  }

  onClose(): void {
    super.onClose?.()
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }

  parse(query: string): OpenQuery {
    return parseOpenQuery(query, {
      hosts: githubHosts(),
      defaultHost: this.defaultHost,
      repo: this.repo,
    })
  }

  getSuggestions(query: string): OpenRow[] {
    const q = this.parse(query)
    // A new input: whatever was waiting to be asked for the one before is not asked now.
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
    if (this.search.unasked(q, this.defaultHost)) {
      this.timer = window.setTimeout(() => {
        this.timer = null
        void this.search.fetch(q, this.defaultHost).then(() => {
          // Shown only if the answer is still for what is in the field.
          if (this.inputEl.value === query) this.inputEl.dispatchEvent(new Event('input'))
        })
      }, DEBOUNCE_MS)
    }
    const view = this.search.view(q, this.defaultHost, this.repo)
    this.emptyStateText = view.message ?? ''
    return view.rows
  }

  renderSuggestion(row: OpenRow, el: HTMLElement): void {
    el.addClass('mod-complex', 'abele-github-open__row')
    if (row.kind === 'note') el.addClass('abele-github-open__note')
    const icon = el.createDiv({ cls: 'suggestion-icon' })
    setIcon(icon.createSpan({ cls: 'suggestion-flair' }), ICONS[row.kind])
    const content = el.createDiv({ cls: 'suggestion-content' })
    content.createDiv({ cls: 'suggestion-title', text: row.title })
    if (row.note) content.createDiv({ cls: 'suggestion-note', text: row.note })
    if (row.kind !== 'note') {
      el.createDiv({ cls: 'suggestion-aux' }).createEl('kbd', {
        cls: 'suggestion-hotkey',
        text: kindName(row.kind),
      })
    }
  }

  /** A line that only says something — searching, a refusal — keeps the picker open. */
  selectSuggestion(row: OpenRow, evt: MouseEvent | KeyboardEvent): void {
    if (row.kind === 'note') return
    super.selectSuggestion(row, evt)
  }

  onChooseSuggestion(row: OpenRow, evt: MouseEvent | KeyboardEvent): void {
    void this.choose(row, Keymap.isModEvent(evt) ? 'tab' : false)
  }

  async choose(row: OpenRow, pane: 'tab' | false): Promise<boolean> {
    if (row.kind === 'note') return false
    let url = row.url
    if (!url && row.resolve) {
      try {
        url = await row.resolve()
      } catch (e) {
        new Notice(e instanceof Error ? e.message : String(e))
        return false
      }
    }
    if (!url) return false
    if (row.repo) lastPicked = row.repo
    const opened = await openGithubUrl(this.app, url, pane)
    if (!opened) new Notice('Abele cannot show that in a GitHub tab.')
    return opened
  }
}
