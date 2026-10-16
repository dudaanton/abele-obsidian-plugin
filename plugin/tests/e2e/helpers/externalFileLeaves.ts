interface CardLeaf {
  view: { getViewType(): string }
  getViewState(): { state?: Record<string, unknown> }
  detach(): void
}

/** Serialized into the live page; keep this helper free of module bindings. */
export async function detachExternalFileLeaves(
  workspace: { iterateRootLeaves(visit: (leaf: CardLeaf) => void): void },
  root?: string
): Promise<void> {
  const leaves: CardLeaf[] = []
  workspace.iterateRootLeaves((leaf) => {
    if (leaf.view.getViewType() !== 'abele-external-file') return
    const path = leaf.getViewState().state?.path
    if (!root || (typeof path === 'string' && path.startsWith(root + '/'))) leaves.push(leaf)
  })
  for (const leaf of leaves) await leaf.detach()
  let remaining = 0
  workspace.iterateRootLeaves((leaf) => {
    if (leaf.view.getViewType() !== 'abele-external-file') return
    const path = leaf.getViewState().state?.path
    if (!root || (typeof path === 'string' && path.startsWith(root + '/'))) remaining++
  })
  if (remaining) {
    throw new Error('External file cards remain after teardown: ' + remaining)
  }
}
