import { MarkdownView, TFile, type App } from 'obsidian'
import { revealLines } from '@/lineLinks/open'
import { LINTER_VIEW_TYPE } from './viewType'

/**
 * Opens a note at a line, beside the linter rather than in its place: in the tab a note was last
 * shown in, or a new one. Line 0 opens the note at its top.
 */
export async function openIssue(app: App, path: string, line: number): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return
  const recent = app.workspace.getMostRecentLeaf()
  const usable = recent && recent.view.getViewType() !== LINTER_VIEW_TYPE && recent.view.navigation
  const leaf = usable ? recent : app.workspace.getLeaf('tab')
  await leaf.openFile(file, { active: true })
  if (line > 0 && leaf.view instanceof MarkdownView) {
    await revealLines(leaf.view, { from: line, to: line })
  }
}
