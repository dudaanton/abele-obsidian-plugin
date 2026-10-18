import { presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
/**
 * "Switch branch or tag" on a repository's front page: Obsidian's own picker over the repository's
 * branches and tags, filtered as it is typed into. The first hundred of each are asked for once;
 * past that, what is typed is looked up by its start as well.
 */
import { SuggestModal, type App } from 'obsidian'
import { SuggestionRows } from '@/components/obsidian/suggestionRows'
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
  private readonly rows = new SuggestionRows()
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
    private readonly choose: (ref: string, kind?: 'branch' | 'tag') => void
  ) {
    super(app)
    this.limit = 50
    this.setPlaceholder(t('streamB.branchOrTag.fba325'))
    this.setInstructions([
      { command: '↑↓', purpose: t('streamBMeta.5a70bdb083') },
      { command: '↵', purpose: t('streamBMeta.a64052354e') },
      { command: 'esc', purpose: t('streamBMeta.29e1c55a84') },
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
      this.problem = e instanceof Error ? presentUiError(e) : String(e)
      return [{ kind: 'note', name: this.problem }]
    }
    const rows = refRows(lists, query)
    this.emptyStateText = t('streamBMeta.42a79f2537')
    return rows
  }

  renderSuggestion(row: RefRow, el: HTMLElement): void {
    const notes = [
      row.name === this.current && row.kind !== 'note' ? t('streamBMeta.f5b932bdd8') : '',
      row.kind === 'branch' && row.name === this.defaultBranch ? 'default' : '',
    ].filter(Boolean)
    this.rows.draw(el, {
      icon: row.kind === 'tag' ? 'tag' : row.kind === 'note' ? 'info' : 'git-branch',
      title: row.name,
      note: notes.join(' · '),
    })
  }

  /** A line that only says something — a refusal — keeps the picker open. */
  selectSuggestion(row: RefRow, evt: MouseEvent | KeyboardEvent): void {
    if (row.kind === 'note') return
    super.selectSuggestion(row, evt)
  }

  onClose(): void {
    this.rows.clear()
    super.onClose()
  }

  onChooseSuggestion(row: RefRow): void {
    if (row.kind === 'note') return
    if ('identity' in this.client && this.client.navigation.ref) this.choose(row.name, row.kind)
    else this.choose(row.name)
  }
}
