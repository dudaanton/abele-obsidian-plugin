import { TFile } from 'obsidian'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'
import { AI_SIDEBAR_VIEW_TYPE } from '@/constants/views'

/**
 * Add files to AI agent scope and open the AI sidebar.
 */
export async function useFilesInAgent(files: TFile[]): Promise<void> {
  const scope = ScopeResolver.getInstance()

  // Clear existing scope and set only these files
  scope.entries.value = files.map((f) => ({ type: 'file' as const, path: f.path }))
  scope.invalidate()

  // Open AI sidebar
  const { app } = GlobalStore.getInstance()
  const { workspace } = app

  let leaf = workspace.getLeavesOfType(AI_SIDEBAR_VIEW_TYPE)[0] ?? null
  if (!leaf) {
    leaf = workspace.getRightLeaf(false)
    await leaf.setViewState({ type: AI_SIDEBAR_VIEW_TYPE, active: true })
  }
  workspace.revealLeaf(leaf)
}
