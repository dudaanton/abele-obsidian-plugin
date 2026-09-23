import type { App, WorkspaceLeaf } from 'obsidian'

/** Shows the panel of this type, opening one in the right sidebar if none is open. */
export async function revealSidebarView(app: App, viewType: string): Promise<void> {
  const { workspace } = app
  let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(viewType)[0] ?? null

  if (!leaf) {
    leaf = workspace.getRightLeaf(false)
    if (!leaf) return
    await leaf.setViewState({ type: viewType, active: true })
  }

  void workspace.revealLeaf(leaf)
}
