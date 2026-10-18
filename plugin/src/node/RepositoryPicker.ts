import { nodeErrorWords } from './errorWords'
import { streamBLabel } from '@/i18n/streamBLabels'
import { t } from '@/i18n'
import { SuggestModal, type App } from 'obsidian'
import { SuggestionRows } from '@/components/obsidian/suggestionRows'
import type { RepositorySource, RepositoryWorkspace } from '@/repository/source'
import { nodeRevisionLabel } from '@/repository/node'
interface Choice {
  kind: 'workspace' | 'version' | 'note'
  id: string
  label: string
  meta?: string
  diagnostic?: string
}
/** One native picker for a repository's workspace and version. */
export class RepositoryPicker extends SuggestModal<Choice> {
  private readonly rows = new SuggestionRows()
  private versions?: Promise<Choice[]>
  constructor(
    app: App,
    private source: RepositorySource,
    private workspaces: RepositoryWorkspace[],
    private choose: (url: string) => void,
    private path?: string
  ) {
    super(app)
    this.setPlaceholder(t('streamB.workspaceBranchOrVersion.dbefef'))
  }
  async getSuggestions(query: string): Promise<Choice[]> {
    try {
      this.source.assertCurrent()
      this.versions ??= this.source.refs().then((refs) =>
        [...refs.branches, ...refs.tags].map((ref) => ({
          kind: 'version' as const,
          id: ref,
          label: streamBLabel(nodeRevisionLabel(ref)),
        }))
      )
      const rows: Choice[] = [
        ...this.workspaces.map((w) => ({
          kind: w.availability === 'available' ? ('workspace' as const) : ('note' as const),
          id: w.id,
          label: w.label,
          meta: [
            w.branch?.replace(/^refs\/heads\//, ''),
            w.kind === 'external'
              ? t('streamB.externalReadOnly.19fbc5')
              : t('streamB.workspace.87bb59'),
            w.dirty ? t('streamB.changes.bbd4b6') : '',
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
      const diagnostic = error instanceof Error ? error.message : String(error)
      return [{ kind: 'note', id: '', label: nodeErrorWords(diagnostic), diagnostic }]
    }
  }
  renderSuggestion(row: Choice, el: HTMLElement) {
    if (row.diagnostic) el.title = row.diagnostic
    this.rows.draw(el, {
      icon: row.kind === 'workspace' ? 'folder-git-2' : 'git-branch',
      title: row.label,
      note: row.meta || (row.kind === 'version' ? t('streamB.version.dd1679') : ''),
      keepNote: true,
    })
  }
  selectSuggestion(row: Choice, event: MouseEvent | KeyboardEvent) {
    if (row.kind !== 'note') super.selectSuggestion(row, event)
  }
  onClose(): void {
    this.rows.clear()
    super.onClose()
  }

  onChooseSuggestion(row: Choice) {
    this.source.assertCurrent()
    if (row.kind === 'workspace') this.choose(this.source.navigation.workspace(row.id))
    else if (row.kind === 'version')
      this.choose(
        this.path
          ? this.source.navigation.file(row.id, this.path)
          : this.source.navigation.home(row.id)
      )
  }
}
