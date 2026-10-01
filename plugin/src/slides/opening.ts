import { WorkspaceLeaf, type OpenViewState, type TFile } from 'obsidian'

export const DECK_VIEW_TYPE = 'abele-deck'
export const sourceLeaves = new WeakSet<WorkspaceLeaf>()
type OpenFile = (this: WorkspaceLeaf, file: TFile, state?: OpenViewState) => Promise<void>

/** Route notes at the same boundary as Obsidian's explorer, links and quick switcher. */
export function presentationFileOpening(
  isPresentation: (file: TFile) => Promise<boolean>,
  proto: { openFile: OpenFile } = WorkspaceLeaf.prototype
): () => void {
  const original = proto.openFile
  let live = true
  const patched: OpenFile = async function (file, state) {
    if (!live) return original.call(this, file, state)
    if (state?.state?.abeleDeckSource) {
      sourceLeaves.add(this)
      return original.call(this, file, state)
    }
    sourceLeaves.delete(this)
    if (!(await isPresentation(file))) return original.call(this, file, state)
    await this.setViewState({
      type: DECK_VIEW_TYPE,
      state: { file: file.path },
      active: state?.active !== false,
    })
  }
  proto.openFile = patched
  return () => {
    live = false
    if (proto.openFile === patched) proto.openFile = original
  }
}
