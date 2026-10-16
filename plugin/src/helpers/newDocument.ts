import type { App, TFolder } from 'obsidian'

/** Resolve before a name dialog changes focus; use the new-note policy for both document types. */
export function newDocumentParent(app: App, folder?: TFolder, source?: string): TFolder {
  return (
    folder ??
    app.fileManager.getNewFileParent(
      source ?? app.workspace.getActiveFile()?.path ?? '',
      'Untitled.md'
    )
  )
}
