/**
 * The tab a file is already open in, so a link to it can go there instead of opening it again —
 * the way a GitHub tab already showing a file is pointed at a link to it.
 *
 * Every tab counts: in popout windows, in the sidebars, pinned, and those not loaded yet since the
 * app started, which name their file only in their state. Several showing the file: the one used
 * last, the tab a person has in mind.
 */
import type { App, PaneType, TFile, WorkspaceLeaf } from 'obsidian'

/** Not in the published API: when the leaf was last made active. */
interface LeafInternals {
  activeTime?: number
}

/** The leaves showing `path` as a `type` view, the one used last first. */
export function leavesShowing(app: App, path: string, type: string): WorkspaceLeaf[] {
  const found: WorkspaceLeaf[] = []
  app.workspace.iterateAllLeaves((leaf) => {
    const vs = leaf.getViewState()
    if (vs.type === type && vs.state?.file === path) found.push(leaf)
  })
  const time = (l: WorkspaceLeaf) => (l as unknown as LeafInternals).activeTime ?? 0
  return found.sort((a, b) => time(b) - time(a))
}

/**
 * The leaf brought in front: its window, its sidebar opened, its tab picked — on a phone, the one
 * leaf shown — and focused. Awaited, a tab not loaded yet has its view by the time this returns.
 */
export async function bringForward(app: App, leaf: WorkspaceLeaf): Promise<void> {
  await app.workspace.revealLeaf(leaf)
  app.workspace.setActiveLeaf(leaf, { focus: true })
}

/**
 * A note opened from somewhere that is not a note, a book say: with no `pane` asked for, the tab
 * already showing it comes forward; otherwise, or when it is open nowhere, a new tab — or the
 * split or window a Mod-click asked for.
 */
export async function openNoteInTab(
  app: App,
  file: TFile,
  pane: PaneType | false = false
): Promise<WorkspaceLeaf> {
  const open = pane ? null : leavesShowing(app, file.path, 'markdown')[0]
  if (open) {
    await bringForward(app, open)
    return open
  }
  const leaf = app.workspace.getLeaf(pane || 'tab')
  await leaf.openFile(file, { active: true })
  return leaf
}
