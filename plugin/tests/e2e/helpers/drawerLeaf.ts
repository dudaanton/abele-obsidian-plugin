import type { Workspace } from 'obsidian'

/** Singleton panels may detach a new duplicate during the opening layout change. */
export function drawerLeaf(workspace: Workspace, type: string) {
  return (
    workspace.getLeavesOfType(type).find((leaf) => {
      const root = leaf.getRoot()
      return root === workspace.rightSplit || root === workspace.leftSplit
    }) ?? workspace.getRightLeaf(true)
  )
}
