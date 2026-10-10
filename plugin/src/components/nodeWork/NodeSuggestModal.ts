// Choosing one thing on the node — a folder, a worktree, a branch — with Obsidian's own
// quick-switcher prompt: type to filter, arrows to move, Enter to choose. Each row is the thing's
// glyph (its kind in the tooltip), its name, a faint line under it, and a code at the end.
import { App, SuggestModal, setIcon, setTooltip } from 'obsidian'

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

export class NodeSuggestModal extends SuggestModal<NodeSuggestion> {
  constructor(
    app: App,
    private items: NodeSuggestion[],
    placeholder: string,
    private onChoose: (item: NodeSuggestion) => void,
    empty = 'Nothing matches'
  ) {
    super(app)
    this.setPlaceholder(placeholder)
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to choose' },
      { command: 'esc', purpose: 'to dismiss' },
    ])
    this.emptyStateText = empty
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
