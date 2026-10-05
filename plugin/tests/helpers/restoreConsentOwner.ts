interface Leaf {
  id: string
}
interface Workspace {
  activeLeaf: Leaf | null
  iterateAllLeaves(visit: (leaf: Leaf) => void): void
  setActiveLeaf(leaf: Leaf, options: { focus: boolean }): void
}

/** Browser-serialized cleanup: restore the captured owner, never a guessed recent pane. */
export function restoreConsentOwner(workspace: Workspace, id: string | undefined): void {
  if (id === undefined) return
  let original: Leaf | undefined
  workspace.iterateAllLeaves((leaf) => {
    if (leaf.id === id) original = leaf
  })
  if (!original) throw new Error('Original consent owner is missing')
  workspace.setActiveLeaf(original, { focus: false })
  if (workspace.activeLeaf?.id !== id) throw new Error('Consent owner was not restored')
}
