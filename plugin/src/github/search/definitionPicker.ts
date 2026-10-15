/**
 * The choice between several places a name looks declared: Obsidian's own picker, each row the
 * file and line with the line's text under it, the nearest first. Typing narrows by path.
 * Mod+Enter or Mod-click opens the choice in a new tab.
 */
import { Keymap, SuggestModal, type App } from 'obsidian'
import type { DefinitionHit } from './definitions'
import { SuggestionRows } from '@/components/obsidian/suggestionRows'

export class DefinitionPicker extends SuggestModal<DefinitionHit> {
  private readonly rows = new SuggestionRows()
  constructor(
    app: App,
    private readonly hits: DefinitionHit[],
    name: string,
    private readonly choose: (hit: DefinitionHit, newTab: boolean) => void
  ) {
    super(app)
    this.setPlaceholder(`${hits.length} places look like they declare ${name} — pick one`)
    this.emptyStateText = 'No definition in a path like that.'
    this.limit = 100
  }

  getSuggestions(query: string): DefinitionHit[] {
    const q = query.trim().toLowerCase()
    return q ? this.hits.filter((h) => h.path.toLowerCase().includes(q)) : this.hits
  }

  renderSuggestion(hit: DefinitionHit, el: HTMLElement): void {
    el.addClass('abele-github-definition')
    this.rows.draw(el, {
      title: `${hit.path}:${hit.line}`,
      note: hit.text.trim(),
      titleClass: 'abele-github-definition__place',
      noteClass: 'abele-github-definition__line',
    })
  }

  onClose(): void {
    this.rows.clear()
    super.onClose()
  }

  onChooseSuggestion(hit: DefinitionHit, evt: MouseEvent | KeyboardEvent): void {
    this.choose(hit, !!Keymap.isModEvent(evt))
  }
}
