import { SuggestModal, setIcon, type App } from 'obsidian'
import type { RepositorySource, RepositoryWorkspace } from '@/repository/source'
import { nodeRevisionLabel } from '@/repository/node'
interface Choice {
  kind: 'workspace' | 'version' | 'note'
  id: string
  label: string
  meta?: string
}
/** One native picker for a repository's workspace and version. */
export class RepositoryPicker extends SuggestModal<Choice> {
  private versions?: Promise<Choice[]>
  constructor(
    app: App,
    private source: RepositorySource,
    private workspaces: RepositoryWorkspace[],
    private choose: (url: string) => void,
    private path?: string
  ) {
    super(app)
    this.setPlaceholder('Workspace, branch or version')
  }
  async getSuggestions(query: string): Promise<Choice[]> {
    try {
      this.source.assertCurrent()
      this.versions ??= this.source
        .refs()
        .then((refs) =>
          [...refs.branches, ...refs.tags].map((ref) => ({
            kind: 'version' as const,
            id: ref,
            label: nodeRevisionLabel(ref),
          }))
        )
      const rows: Choice[] = [
        ...this.workspaces.map((w) => ({
          kind: w.availability === 'available' ? ('workspace' as const) : ('note' as const),
          id: w.id,
          label: w.label,
          meta: [
            w.branch?.replace(/^refs\/heads\//, ''),
            w.kind === 'external' ? 'External · read only' : 'Workspace',
            w.dirty ? 'Changes' : '',
            w.availability !== 'available' ? w.availability : '',
          ]
            .filter(Boolean)
            .join(' · '),
        })),
        ...(await this.versions),
      ]
      return rows.filter((row) =>
        `${row.label} ${row.meta ?? ''}`.toLowerCase().includes(query.toLowerCase())
      )
    } catch (error) {
      return [
        { kind: 'note', id: '', label: error instanceof Error ? error.message : String(error) },
      ]
    }
  }
  renderSuggestion(row: Choice, el: HTMLElement) {
    el.addClass('mod-complex')
    setIcon(
      el.createDiv({ cls: 'suggestion-icon' }),
      row.kind === 'workspace' ? 'folder-git-2' : 'git-branch'
    )
    const content = el.createDiv({ cls: 'suggestion-content' })
    content.createDiv({ cls: 'suggestion-title', text: row.label })
    content.createDiv({
      cls: 'suggestion-note',
      text: row.meta || (row.kind === 'version' ? 'Version' : ''),
    })
  }
  selectSuggestion(row: Choice, event: MouseEvent | KeyboardEvent) {
    if (row.kind !== 'note') super.selectSuggestion(row, event)
  }
  onChooseSuggestion(row: Choice) {
    this.source.assertCurrent()
    if (row.kind === 'workspace') this.choose(this.source.navigation.workspace!(row.id))
    else if (row.kind === 'version')
      this.choose(
        this.path
          ? this.source.navigation.file(row.id, this.path)
          : this.source.navigation.home(row.id)
      )
  }
}
