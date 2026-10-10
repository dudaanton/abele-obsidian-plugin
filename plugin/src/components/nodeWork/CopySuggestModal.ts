// Choosing a working copy of a folder with Obsidian's own quick-switcher prompt: type to filter by
// branch or path; each row shows the copy's kind by its glyph, its branch, its path, and how many
// files are changed in it.
import { App, SuggestModal, setIcon, setTooltip } from 'obsidian'
import type { CopySummary } from './types'

const kindIcon = (copy: CopySummary) =>
  copy.missing
    ? 'folder-x'
    : copy.kind === 'project'
      ? 'house'
      : copy.kind === 'detached'
        ? 'git-commit-horizontal'
        : 'git-branch'
const kindName = (copy: CopySummary) =>
  copy.missing
    ? 'Not found on the node'
    : copy.kind === 'project'
      ? 'Project folder'
      : copy.kind === 'detached'
        ? 'Detached commit'
        : 'Worktree'

export class CopySuggestModal extends SuggestModal<CopySummary> {
  constructor(
    app: App,
    private copies: CopySummary[],
    private current: string | undefined,
    private onChoose: (copy: CopySummary) => void
  ) {
    super(app)
    this.setPlaceholder('Find a copy by branch or folder')
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to open' },
      { command: 'esc', purpose: 'to dismiss' },
    ])
    this.emptyStateText = 'No copy matches'
  }

  getSuggestions(query: string): CopySummary[] {
    const q = query.trim().toLowerCase()
    return this.copies.filter(
      (c) =>
        !c.missing && (!q || c.branch.toLowerCase().includes(q) || c.path.toLowerCase().includes(q))
    )
  }

  renderSuggestion(copy: CopySummary, el: HTMLElement): void {
    el.addClass('mod-complex', 'abele-copy-suggestion')
    if (copy.id === this.current) el.addClass('abele-copy-suggestion_current')
    const icon = el.createDiv({ cls: 'suggestion-icon abele-copy-suggestion__kind' })
    setIcon(icon, kindIcon(copy))
    setTooltip(icon, kindName(copy))
    const content = el.createDiv({ cls: 'suggestion-content' })
    content.createDiv({ cls: 'suggestion-title', text: copy.branch })
    content.createDiv({ cls: 'suggestion-note', text: copy.path })
    if (copy.changed) {
      const aux = el.createDiv({ cls: 'suggestion-aux' })
      const flair = aux.createSpan({
        cls: 'suggestion-flair abele-copy-suggestion__changed',
        text: String(copy.changed),
      })
      setTooltip(flair, `${copy.changed} changed ${copy.changed === 1 ? 'file' : 'files'}`)
    }
  }

  onChooseSuggestion(copy: CopySummary): void {
    this.onChoose(copy)
  }
}
