import { FuzzySuggestModal, type App, type FuzzyMatch } from 'obsidian'
import { SuggestionRows } from '@/components/obsidian/suggestionRows'

/** A script a request may name: one whose header carries `// @request`. */
export interface RequestScriptChoice {
  name: string
  description?: string
  request?: boolean
  interceptor?: number
}

type Row = { kind: 'script'; script: RequestScriptChoice } | { kind: 'new'; name: string }

const WHEN = { before: 'before it goes', after: 'after it comes back' } as const

/**
 * Obsidian's own suggester over the `@request` scripts, as the quick switcher lists notes: the one
 * named now is marked, and the last row makes a new script, named after what was typed, the way
 * the quick switcher makes a new note. With no such scripts yet that row is the whole list.
 */
export class RequestScriptPicker extends FuzzySuggestModal<Row> {
  private readonly rows = new SuggestionRows()

  constructor(
    app: App,
    private readonly scripts: RequestScriptChoice[],
    when: 'before' | 'after',
    private readonly current: string | undefined,
    /** What a new script is called when nothing is typed: the request's name and the moment. */
    private readonly newName: string,
    private readonly pick: (name: string) => void,
    private readonly create: (name: string) => void
  ) {
    super(app)
    this.modalEl.addClass('abele-request-script-picker')
    this.setPlaceholder(`A script to run ${WHEN[when]}…`)
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to use it' },
      { command: 'esc', purpose: 'to leave it as it is' },
    ])
    this.emptyStateText = 'No script by that name.'
  }

  getItems(): Row[] {
    const typed = this.inputEl.value.trim()
    const eligible = this.scripts.filter((s) => s.request && !s.interceptor)
    const sorted = [...eligible].sort((a, b) =>
      a.name === this.current ? -1 : b.name === this.current ? 1 : a.name.localeCompare(b.name)
    )
    const taken = this.scripts.some((s) => s.name.toLowerCase() === typed.toLowerCase())
    return [
      ...sorted.map((script) => ({ kind: 'script' as const, script })),
      ...(taken ? [] : [{ kind: 'new' as const, name: typed || this.newName }]),
    ]
  }

  getItemText(row: Row): string {
    // The new row always matches: it is named after what is typed.
    return row.kind === 'script' ? row.script.name : this.inputEl.value
  }

  renderSuggestion(match: FuzzyMatch<Row>, el: HTMLElement): void {
    const row = match.item
    if (row.kind === 'new')
      this.rows.draw(el, {
        title: `New script «${row.name}»`,
        note: this.scripts.length
          ? 'Starts with // @request and opens'
          : 'No script runs around requests yet; this one starts with // @request and opens',
        keepNote: true,
      })
    else
      this.rows.draw(el, {
        title: row.script.name,
        note: row.script.description,
        aux: row.script.name === this.current ? [{ flair: 'Now' }] : undefined,
      })
  }

  onChooseItem(row: Row): void {
    if (row.kind === 'new') this.create(row.name)
    else this.pick(row.script.name)
  }

  onClose(): void {
    super.onClose()
    this.rows.clear()
  }
}
