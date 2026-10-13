// Choosing one thing on the node — a folder, a worktree, a branch — with Obsidian's own
// quick-switcher prompt: type to filter, arrows to move, Enter to choose. Each row is the thing's
// glyph (its kind in the tooltip), its name, a faint line under it, and a code at the end.
import { App, SuggestModal, setIcon, setTooltip } from 'obsidian'
import './nodeSuggest.css'

export interface NodeSuggestion {
  id: string
  icon: string
  /** What the glyph means, for its tooltip. */
  kind: string
  title: string
  note?: string
  /** A number at the row's end, and what it counts. */
  count?: { value: number; label: string }
  /** The one in use now, marked in the accent colour. */
  current?: boolean
}

/**
 * Something the list cannot show until the owner allows it — worktrees outside the node's own
 * folders — said once above the list, with the way to allow it in place.
 */
export interface NodeSuggestHint {
  text: string
  /** The button's words. */
  action: string
  /** What the button does in its tooltip. */
  tooltip?: string
  /** Asks for it; the list is filled again with `setItems` once it is allowed. */
  onAction: () => void
}

export class NodeSuggestModal extends SuggestModal<NodeSuggestion> {
  private hintEl?: HTMLElement

  constructor(
    app: App,
    private items: NodeSuggestion[],
    placeholder: string,
    private onChoose: (item: NodeSuggestion) => void,
    empty = 'Nothing matches',
    hint?: NodeSuggestHint
  ) {
    super(app)
    this.setPlaceholder(placeholder)
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to choose' },
      { command: 'esc', purpose: 'to dismiss' },
    ])
    this.emptyStateText = empty
    if (hint) this.showHint(hint)
  }

  /** The hint sits between the field and the list, a quiet line with its one button. */
  private showHint(hint: NodeSuggestHint): void {
    const el = createDiv({ cls: 'abele-node-suggest-hint' })
    const glyph = el.createSpan({ cls: 'abele-node-suggest-hint__glyph' })
    setIcon(glyph, 'eye-off')
    el.createSpan({ cls: 'abele-node-suggest-hint__text', text: hint.text })
    const button = el.createEl('button', { text: hint.action })
    if (hint.tooltip) setTooltip(button, hint.tooltip)
    button.addEventListener('click', () => {
      button.disabled = true
      button.setText('Waiting for the node…')
      hint.onAction()
    })
    this.resultContainerEl.before(el)
    this.hintEl = el
  }

  /** The list again, once what the hint asked for is allowed; the hint goes. */
  setItems(items: NodeSuggestion[], empty?: string): void {
    this.items = items
    if (empty) this.emptyStateText = empty
    this.hintEl?.remove()
    this.hintEl = undefined
    this.inputEl.dispatchEvent(new Event('input'))
  }

  getSuggestions(query: string): NodeSuggestion[] {
    const q = query.trim().toLowerCase()
    return this.items.filter(
      (i) => !q || i.title.toLowerCase().includes(q) || i.note?.toLowerCase().includes(q)
    )
  }

  renderSuggestion(item: NodeSuggestion, el: HTMLElement): void {
    el.addClass('mod-complex', 'abele-node-suggestion')
    if (item.current) el.addClass('abele-node-suggestion_current')
    const icon = el.createDiv({ cls: 'suggestion-icon abele-node-suggestion__kind' })
    setIcon(icon, item.icon)
    setTooltip(icon, item.kind)
    const content = el.createDiv({ cls: 'suggestion-content' })
    content.createDiv({ cls: 'suggestion-title', text: item.title })
    if (item.note) content.createDiv({ cls: 'suggestion-note', text: item.note })
    if (item.count?.value) {
      const aux = el.createDiv({ cls: 'suggestion-aux' })
      const flair = aux.createSpan({ cls: 'suggestion-flair', text: String(item.count.value) })
      setTooltip(flair, item.count.label)
    }
  }

  onChooseSuggestion(item: NodeSuggestion): void {
    this.onChoose(item)
  }
}
