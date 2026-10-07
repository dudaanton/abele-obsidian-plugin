import { SuggestModal, type App } from 'obsidian'
import type { GithubClient } from '../client'
import { loadRefs } from '../repoPage/repoHome'
import { basePins, type BasePin, type Repository } from './pins'

interface Row {
  name: string
  pin?: BasePin
  note?: string
}

/** Choosing a name resolves it; only a second, SHA-labelled choice saves the frozen base. */
export class BasePicker extends SuggestModal<Row> {
  private refs: Promise<string[]> | undefined
  private readonly resolved = new Map<string, Promise<BasePin>>()
  private queryGeneration = 0
  private closed = false
  constructor(
    app: App,
    private readonly client: GithubClient,
    private readonly repo: Repository
  ) {
    super(app)
    this.modalEl.addClass('abele-github-base-picker')
    this.setPlaceholder('Compare against a commit SHA, branch or tag')
    this.setInstructions([
      { command: '↵', purpose: 'resolve a ref, then confirm its SHA' },
      { command: 'esc', purpose: 'cancel' },
    ])
  }
  async getSuggestions(query: string): Promise<Row[]> {
    const name = query.trim(),
      generation = ++this.queryGeneration
    if (name) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (this.closed || generation !== this.queryGeneration) return []
      try {
        const pending =
          this.resolved.get(name) ?? basePins(this.app).resolve(this.client, this.repo, name)
        this.resolved.set(name, pending)
        const pin = await pending
        return this.closed || generation !== this.queryGeneration ? [] : [{ name, pin }]
      } catch (error) {
        this.resolved.delete(name)
        return [{ name, note: error instanceof Error ? error.message : String(error) }]
      }
    }
    try {
      this.refs ??= loadRefs(this.client, this.repo).then((refs) => [
        ...new Set([...refs.branches, ...refs.tags]),
      ])
      return (await this.refs).map((name) => ({ name }))
    } catch {
      this.refs = undefined
      return [{ name: 'Paste a commit SHA, branch or tag above.' }]
    }
  }
  renderSuggestion(row: Row, el: HTMLElement): void {
    el.addClass('mod-complex')
    const content = el.createDiv({ cls: 'suggestion-content' })
    content.createDiv({ cls: 'suggestion-title', text: row.name })
    content.createDiv({
      cls: 'suggestion-note',
      text: row.pin
        ? `Pin frozen commit ${row.pin.baseSha}`
        : (row.note ?? 'Resolve this ref before pinning'),
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
    if (row.pin) basePins(this.app).save(row.pin)
  }
  onClose(): void {
    this.closed = true
    this.queryGeneration++
    super.onClose()
  }
}
