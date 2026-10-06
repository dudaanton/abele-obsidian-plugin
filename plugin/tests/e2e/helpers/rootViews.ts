/** Per-file ownership boundary: report leaked plugin views, never close pre-existing leaves. */
import { evalJsonIdempotent, evalRawIdempotent } from './obsidianCli'

export interface RootView {
  id: string
  type: string
}

export function snapshotRootViews(): RootView[] {
  return evalJsonIdempotent<RootView[]>(`(() => {
    const leaves = []
    app.workspace.iterateRootLeaves(leaf => { leaves.push({ id: leaf.id, type: leaf.view.getViewType() }) })
    return leaves
  })()`)
}

export function assertNoLeakedRootViews(before: RootView[]): void {
  const leaked = evalJsonIdempotent<RootView[]>(`(() => {
    const before = ${JSON.stringify(before)}
    const leaked = []
    const leaves = []
    app.workspace.iterateRootLeaves(leaf => { leaves.push(leaf) })
    for (const leaf of leaves) {
      const type = leaf.view.getViewType()
      if (!type.startsWith('abele-') || before.some(old => old.id === leaf.id && old.type === type)) continue
      leaked.push({ id: leaf.id, type })
      // A converted old tab is not ours to detach. Only a new leaf is proven to belong to this file.
      if (!before.some(old => old.id === leaf.id)) leaf.detach()
    }
    return leaked
  })()`)
  // The next file may reload before Obsidian's debounced save runs.
  evalRawIdempotent(
    `(async () => { await app.workspace.requestSaveLayout.run(); return 'saved' })()`
  )
  if (leaked.length)
    throw new Error(`Leaked plugin views in the main area: ${JSON.stringify(leaked)}`)
}
