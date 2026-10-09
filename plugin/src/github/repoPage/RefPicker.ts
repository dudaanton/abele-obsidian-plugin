/**
 * "Switch branch or tag" on a repository's front page: Obsidian's own picker over the repository's
 * branches and tags, filtered as it is typed into. The first hundred of each are asked for once;
 * past that, what is typed is looked up by its start as well.
 */
import { SuggestModal, setIcon, type App } from 'obsidian'
import type { GithubClient } from '../client'
import type { RepositorySource } from '@/repository/source'
import { githubRepositorySource } from '@/repository/github'
import { type RefList, type RepoLike } from './repoHome'

export interface RefRow {
  kind: 'branch' | 'tag' | 'note'
  name: string
}

/** What to offer for `query` out of what is known, the refs starting with it first. */
export function refRows(lists: RefList[], query: string, limit = 50): RefRow[] {
  const needle = query.trim().toLowerCase()
  const seen = new Set<string>()
  const rows: RefRow[] = []
  for (const kind of ['branch', 'tag'] as const) {
    for (const list of lists) {
      for (const name of kind === 'branch' ? list.branches : list.tags) {
        const key = `${kind}:${name}`
        if (seen.has(key) || (needle && !name.toLowerCase().includes(needle))) continue
        seen.add(key)
        rows.push({ kind, name })
      }
    }
  }
  const starts = (r: RefRow) => Number(!r.name.toLowerCase().startsWith(needle))
  return rows.sort((a, b) => starts(a) - starts(b)).slice(0, limit)
}

export class RefPicker extends SuggestModal<RefRow> {
  private listed: Promise<RefList> | null = null
  private readonly byPrefix = new Map<string, Promise<RefList>>()
  private problem = ''

  constructor(
    app: App,
    private readonly client: GithubClient | RepositorySource,
    private readonly repo: RepoLike,
    /** The ref shown now, and the default branch, both marked in the list. */
    private readonly current: string,
    private readonly defaultBranch: string,
    private readonly choose: (ref: string) => void
  ) {
    super(app)
    this.limit = 50
    this.setPlaceholder('Branch or tag')
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to switch' },
      { command: 'esc', purpose: 'to dismiss' },
    ])
    this.modalEl.addClass('abele-github-refs')
  }

  private source(): RepositorySource {
    return 'identity' in this.client ? this.client : githubRepositorySource(this.client, this.repo)
  }

  private refs(): Promise<RefList> {
    this.listed ??= this.source().refs()
    return this.listed
  }

  async getSuggestions(query: string): Promise<RefRow[]> {
    let lists: RefList[]
    try {
      const all = await this.refs()
      lists = [all]
      const typed = query.trim()
      if (all.more && typed) {
        const found = this.byPrefix.get(typed) ?? this.source().refs(typed)
        this.byPrefix.set(typed, found)
        const none: RefList = { branches: [], tags: [], more: false }
        lists.push(await found.catch(() => none))
      }
      this.problem = ''
    } catch (e) {
      this.listed = null
      this.problem = e instanceof Error ? e.message : String(e)
      return [{ kind: 'note', name: this.problem }]
    }
    const rows = refRows(lists, query)
    this.emptyStateText = 'No branch or tag like that.'
    return rows
  }

  renderSuggestion(row: RefRow, el: HTMLElement): void {
    el.addClass('mod-complex')
    const icon = el.createDiv({ cls: 'suggestion-icon' })
    setIcon(
      icon.createSpan({ cls: 'suggestion-flair' }),
      row.kind === 'tag' ? 'tag' : row.kind === 'note' ? 'info' : 'git-branch'
    )
    const content = el.createDiv({ cls: 'suggestion-content' })
    content.createDiv({ cls: 'suggestion-title', text: row.name })
    const notes = [
      row.name === this.current && row.kind !== 'note' ? 'shown now' : '',
      row.kind === 'branch' && row.name === this.defaultBranch ? 'default' : '',
    ].filter(Boolean)
    if (notes.length) content.createDiv({ cls: 'suggestion-note', text: notes.join(' · ') })
  }

  /** A line that only says something — a refusal — keeps the picker open. */
  selectSuggestion(row: RefRow, evt: MouseEvent | KeyboardEvent): void {
    if (row.kind === 'note') return
    super.selectSuggestion(row, evt)
  }

  onChooseSuggestion(row: RefRow): void {
    if (row.kind !== 'note') this.choose(row.name)
  }
}
