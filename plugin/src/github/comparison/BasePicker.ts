import { SuggestModal, type App } from 'obsidian'
import { SuggestionRows } from '@/components/obsidian/suggestionRows'
import type { GithubClient } from '../client'
import type { RepositorySource } from '@/repository/source'
import { githubRepositorySource } from '@/repository/github'
import { basePins, type BasePin, type Repository } from './pins'
import './basePicker.css'

interface Row {
  name: string
  /** A listed branch or tag; a typed name has none until it is looked up. */
  kind?: 'branch' | 'tag'
  pin?: BasePin
  note?: string
}

/** Choosing a name resolves it; only a second, SHA-labelled choice saves the frozen base. */
export class BasePicker extends SuggestModal<Row> {
  private readonly rows = new SuggestionRows()
  private refs: Promise<Row[]> | undefined
  private readonly resolved = new Map<string, Promise<BasePin>>()
  private queryGeneration = 0
  private closed = false
  constructor(
    app: App,
    private readonly client: GithubClient | RepositorySource,
    private readonly repo: Repository,
    /** Instead of pinning the base for the repository's views, go somewhere with it. */
    private readonly choose?: (pin: BasePin) => void
  ) {
    super(app)
    this.modalEl.addClass('abele-github-base-picker')
    this.setPlaceholder('Compare against a commit SHA, branch or tag')
    this.setInstructions([
      { command: '↵', purpose: 'look it up, then compare against it' },
      { command: 'esc', purpose: 'cancel' },
    ])
  }
  private source(): RepositorySource {
    return 'identity' in this.client ? this.client : githubRepositorySource(this.client, this.repo)
  }
  async getSuggestions(query: string): Promise<Row[]> {
    const name = query.trim(),
      generation = ++this.queryGeneration
    if (name) {
      await new Promise((resolve) => window.setTimeout(resolve, 250))
      if (this.closed || generation !== this.queryGeneration) return []
      try {
        const pending =
          this.resolved.get(name) ??
          basePins(this.app).resolveSource(this.source(), this.repo, name)
        this.resolved.set(name, pending)
        const pin = await pending
        return this.closed || generation !== this.queryGeneration ? [] : [{ name, pin }]
      } catch (error) {
        this.resolved.delete(name)
        return [{ name, note: error instanceof Error ? error.message : String(error) }]
      }
    }
    try {
      this.refs ??= this.source()
        .refs()
        .then((refs) => [
          ...refs.branches.map((name) => ({ name, kind: 'branch' as const })),
          ...refs.tags
            .filter((name) => !refs.branches.includes(name))
            .map((name) => ({ name, kind: 'tag' as const })),
        ])
      return await this.refs
    } catch {
      this.refs = undefined
      return [{ name: 'Paste a commit SHA, branch or tag above.' }]
    }
  }
  /**
   * As the quick switcher draws a row: a glyph for what it is (branch, tag, the commit a name
   * was found at, a refusal) and the name, with a muted line only when there is something to say.
   */
  renderSuggestion(row: Row, el: HTMLElement): void {
    el.addClass('mod-complex', 'abele-ref-suggestion')
    this.rows.draw(el, {
      icon: row.pin
        ? 'git-commit-horizontal'
        : row.note
          ? 'circle-alert'
          : row.kind === 'tag'
            ? 'tag'
            : 'git-branch',
      title: row.name,
      // Only what is worth reading: the commit a name was found at, or why it was not.
      note: row.pin ? `Compare against commit ${row.pin.baseSha.slice(0, 7)}` : row.note,
    })
  }
  selectSuggestion(row: Row, event: MouseEvent | KeyboardEvent): void {
    if (!row.pin) {
      if (!row.note) {
        this.inputEl.value = row.name
        this.inputEl.dispatchEvent(new Event('input'))
      }
      return
    }
    this.client.assertCurrent()
    super.selectSuggestion(row, event)
  }
  onChooseSuggestion(row: Row): void {
    if (row.pin && this.choose) this.choose(row.pin)
    else if (row.pin) basePins(this.app).save(row.pin)
  }
  onClose(): void {
    this.rows.clear()
    this.closed = true
    this.queryGeneration++
    super.onClose()
  }
}
