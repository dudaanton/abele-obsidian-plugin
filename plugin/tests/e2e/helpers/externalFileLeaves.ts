interface CardLeaf {
  getViewState(): { state?: Record<string, unknown> }
  detach(): void
}

/** Serialized into the live page; keep this helper free of module bindings. */
export async function detachExternalFileLeaves(
  workspace: { getLeavesOfType(type: string): CardLeaf[] },
  root: string
): Promise<void> {
  for (const leaf of workspace.getLeavesOfType('abele-external-file')) {
    // Deferred tabs keep their serialized state on the leaf, not on the placeholder view.
    const path = leaf.getViewState().state?.path
    if (typeof path === 'string' && path.startsWith(root + '/')) await leaf.detach()
  }
}
