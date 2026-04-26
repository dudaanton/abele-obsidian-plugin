import { TFile } from 'obsidian'
import { AgentService } from '@/ai/AgentService'
import { GlobalStore } from '@/stores/GlobalStore'
import { AI_SIDEBAR_VIEW_TYPE } from '@/constants/views'

/**
 * Add files to AI agent scope and open the AI sidebar.
 * Uses the active session's scope resolver, or creates a new tab.
 */
export async function useFilesInAgent(files: TFile[]): Promise<void> {
  const agentService = AgentService.getInstance()

  // If active session has no messages, set scope on it; otherwise create new tab
  let session = agentService.activeSession.value
  if (!session || session.messages.value.length > 0) {
    const tabId = agentService.createTab()
    session = agentService.getSession(tabId)!
  }

  const scope = session.scopeResolver
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
