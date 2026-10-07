import { normalizePath, TFile, type TAbstractFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { isScriptPath } from '@/scripting/scriptPath'
import { chatArtifacts } from './chatArtifacts'
import type { ChatSession } from './ChatSession'

/** Reject absolute/schemed paths and parent traversal before Obsidian strips or rewrites them. */
function validArtifactPath(path: string): boolean {
  const slashPath = path.replace(/\\/g, '/')
  return (
    !!path &&
    !slashPath.startsWith('/') &&
    !/^[a-z][a-z\d+.-]*:/i.test(slashPath) &&
    !slashPath.split('/').includes('..') &&
    ![...path].some((char) => char.charCodeAt(0) < 32)
  )
}
const resolveArtifactPath = (path: string) => (validArtifactPath(path) ? normalizePath(path) : path)

/** Only exact stored resource paths: an invalid or missing path never aliases a vault file. */
export function artifactsOf(session: ChatSession) {
  return chatArtifacts({
    touched: session.touched.value,
    messages: session.allMessages.value,
    resolvePath: resolveArtifactPath,
    isScript: isScriptPath,
  })
}
export function artifactFile(path: string): TFile | undefined {
  if (!validArtifactPath(path)) return
  const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(normalizePath(path))
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
