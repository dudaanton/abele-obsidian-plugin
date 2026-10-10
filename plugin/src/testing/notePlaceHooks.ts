import { MarkdownView, WorkspaceLeaf } from 'obsidian'

/** The private host methods the note-place adapter wraps; inherited methods count too. */
export function inspectNotePlaceHooks(
  leaf: { setViewState?: unknown; detach?: unknown },
  view: { setEphemeralState?: unknown; onUnloadFile?: unknown }
) {
  return {
    'WorkspaceLeaf.setViewState': typeof leaf.setViewState,
    'WorkspaceLeaf.detach': typeof leaf.detach,
    'MarkdownView.setEphemeralState': typeof view.setEphemeralState,
    'MarkdownView.onUnloadFile': typeof view.onUnloadFile,
  }
}

// This test module is imported while the bundle evaluates, before onload installs the patch.
// Looking at the prototypes after registration would see our wrappers, not the host's methods.
export const originalNotePlaceHookTypes = inspectNotePlaceHooks(
  WorkspaceLeaf.prototype,
  MarkdownView.prototype
)
