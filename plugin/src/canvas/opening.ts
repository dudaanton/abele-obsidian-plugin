import { type App, type TFile, type WorkspaceLeaf } from 'obsidian'
import { nativeCanvasFingerprint, parseCanvas } from './core/model'
export const CANVAS_VIEW_TYPE = 'abele-canvas'
/** Opt-out belongs to this file in this leaf, not to every later file opened there. */
export const nativeCanvasLeaves = new WeakMap<WorkspaceLeaf, string>()
export async function nativeCanvas(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
  nativeCanvasLeaves.set(leaf, file.path)
  await leaf.setViewState({ type: 'canvas', state: { file: file.path }, active: true })
}
export async function openCanvas(
  app: App,
  file: TFile,
  state: Record<string, unknown> = {}
): Promise<void> {
  const leaf =
    app.workspace
      .getLeavesOfType(CANVAS_VIEW_TYPE)
      .find((l) => (l.view as { file?: TFile }).file?.path === file.path) ??
    app.workspace.getLeaf('tab')
  nativeCanvasLeaves.delete(leaf)
  await leaf.setViewState({
    type: CANVAS_VIEW_TYPE,
    state: { file: file.path, ...state },
    active: true,
  })
  await app.workspace.revealLeaf(leaf)
}
export async function adoptCanvasLeaves(app: App): Promise<void> {
  for (const leaf of app.workspace.getLeavesOfType('canvas')) {
    const file = (leaf.view as { file?: TFile }).file
    if (
      !file ||
      file.extension !== 'canvas' ||
      nativeCanvasLeaves.get(leaf) === file.path ||
      app.vault.getAbstractFileByPath(file.path) !== file
    )
      continue
    nativeCanvasLeaves.delete(leaf)
    // Native TextFileView saves on unload even when its serializer only reordered keys.
    // Suppress that formatting-only write. Never save native data during a view switch:
    // a mismatch may be an unsaved native edit OR a native view lagging an external write.
    // This private seam is pinned by host tests, like native undo in the storage adapter.
    const view = leaf.view as unknown as {
      canvas: { getData(): unknown }
      getViewData(): string
      lastSavedData: string | null
      requestSave: { cancel?: () => void }
    }
    const bytes = await app.vault.read(file)
    if (leaf.view !== (view as unknown) || (leaf.view as { file?: TFile }).file?.path !== file.path)
      continue
    const stored = parseCanvas(bytes)
    // Missing native edge sides default to right/left, independently of extension routing.
    const defaults = {
      ...stored,
      edges: stored.edges.map((edge) => ({
        ...edge,
        fromSide: edge.fromSide ?? ('right' as const),
        toSide: edge.toSide ?? ('left' as const),
      })),
    }
    if (
      nativeCanvasFingerprint(defaults) !==
      nativeCanvasFingerprint(parseCanvas(view.canvas.getData()))
    )
      throw new Error(
        'Native Canvas is still saving or reloading a different version. Wait for it to finish before opening the viewer; the view switch did not save or discard any changes.'
      )
    // No await between this snapshot and switching: unload sees the same serialized data.
    // If storage changes after our read, the viewer reads that new version without writing.
    view.requestSave.cancel?.()
    view.lastSavedData = view.getViewData()
    if (
      leaf.view.getViewType() !== 'canvas' ||
      (leaf.view as { file?: TFile }).file?.path !== file.path
    )
      continue
    await leaf.setViewState({ ...leaf.getViewState(), type: CANVAS_VIEW_TYPE })
  }
}
