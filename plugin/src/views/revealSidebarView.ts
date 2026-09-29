import type { App, WorkspaceLeaf } from 'obsidian'

/**
 * Shows the panel of this type, opening one in the right sidebar if none is open, and resolves
 * once it is on screen. The reveal is waited for, and a sidebar it left shut is opened: on a phone
 * the drawer could stay shut after it, the panel open in it and nothing of it on screen.
 */
export async function revealSidebarView(app: App, viewType: string): Promise<void> {
  const { workspace } = app
  let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(viewType)[0] ?? null

  if (!leaf) {
    leaf = workspace.getRightLeaf(false)
    if (!leaf) return
    await leaf.setViewState({ type: viewType, active: true })
  }

  await workspace.revealLeaf(leaf)

  const root = leaf.getRoot()
  for (const split of [workspace.rightSplit, workspace.leftSplit]) {
    if (root === split && split.collapsed) split.expand()
  }
}
