import { normalizePath, TFile, type TAbstractFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { isScriptPath } from '@/scripting/scriptPath'
import { chatArtifacts } from './chatArtifacts'
import type { ChatSession } from './ChatSession'

/** Only exact stored resource paths: a missing image must not resolve to a different basename. */
export function artifactsOf(session: ChatSession) {
  return chatArtifacts({
    touched: session.touched.value,
    messages: session.allMessages.value,
    resolvePath: normalizePath,
    isScript: isScriptPath,
  })
}
export function artifactFile(path: string): TFile | undefined {
  const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(path)
  return file instanceof TFile ? file : undefined
}
export async function revealArtifact(path: string): Promise<void> {
  const file = artifactFile(path)
  if (!file) return
  const { workspace } = GlobalStore.getInstance().app
  const leaf = workspace.getLeavesOfType('file-explorer')[0]
  if (!leaf) return
  await workspace.revealLeaf(leaf)
  // Obsidian's built-in explorer has this operation, but it is not in the public View type.
  const explorer = leaf.view as unknown as { revealInFolder?: (file: TAbstractFile) => void }
  explorer.revealInFolder?.(file)
}
