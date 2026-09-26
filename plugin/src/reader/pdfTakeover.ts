/**
 * "Open PDF files in the Abele reader": which view Obsidian opens a `.pdf` in.
 *
 * Obsidian keeps one view per extension and refuses a second claim through the plugin API, so the
 * switch goes through its view registry: our claim replaces theirs while the setting is on, and
 * theirs is put back when it is turned off or the plugin unloads. Where the registry is not what
 * this expects — a future Obsidian — nothing is changed, and "Open in Abele reader" in the file
 * menu still works.
 *
 * The claim decides where a PDF opens from then on — the file explorer, a link, the quick
 * switcher — but not the tabs already showing one: those Obsidian brought back from the last
 * session were made before the plugin's claim, in its own viewer. `adoptPdfLeaves` moves them.
 */
interface ViewRegistry {
  typeByExtension: Record<string, string>
  registerExtensions(extensions: string[], type: string): void
  unregisterExtensions(extensions: string[]): void
}

const registryOf = (app: unknown): ViewRegistry | null => {
  const reg = (app as { viewRegistry?: Partial<ViewRegistry> }).viewRegistry
  return reg?.typeByExtension &&
    typeof reg.registerExtensions === 'function' &&
    typeof reg.unregisterExtensions === 'function'
    ? (reg as ViewRegistry)
    : null
}

let theirs: string | null = null

/** Makes `.pdf` open in `ours` (on) or in whatever had it before (off). Says whether it could. */
export function setPdfTakeover(app: unknown, on: boolean, ours: string): boolean {
  const reg = registryOf(app)
  if (!reg) return false
  const current = reg.typeByExtension.pdf
  if (on && current !== ours) {
    theirs = current ?? 'pdf'
    if (current) reg.unregisterExtensions(['pdf'])
    reg.registerExtensions(['pdf'], ours)
  } else if (!on && current === ours) {
    reg.unregisterExtensions(['pdf'])
    reg.registerExtensions(['pdf'], theirs ?? 'pdf')
    theirs = null
  }
  return true
}

interface LeafLike {
  getViewState(): { type: string; state?: Record<string, unknown> }
  setViewState(state: { type: string; state?: Record<string, unknown> }): Promise<void>
}

/**
 * Moves every tab showing a PDF in Obsidian's viewer into `ours`, keeping the tab — pinned, in its
 * group, in its window — and not taking the focus. Says how many it moved.
 */
export async function adoptPdfLeaves(
  app: unknown,
  ours: string,
  theirType = 'pdf'
): Promise<number> {
  const workspace = (
    app as { workspace?: { iterateAllLeaves?: (fn: (l: LeafLike) => void) => void } }
  ).workspace
  if (typeof workspace?.iterateAllLeaves !== 'function') return 0
  const leaves: LeafLike[] = []
  workspace.iterateAllLeaves((leaf) => {
    const vs = leaf.getViewState()
    if (vs.type === theirType && typeof vs.state?.file === 'string') leaves.push(leaf)
  })
  for (const leaf of leaves) {
    const vs = leaf.getViewState()
    try {
      await leaf.setViewState({ ...vs, type: ours, state: { file: vs.state?.file } })
    } catch (e) {
      console.warn('[Abele] could not move a PDF tab into the reader', e)
    }
  }
  return leaves.length
}
