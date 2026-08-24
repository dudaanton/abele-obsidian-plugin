import { TFile } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import { GlobalStore } from '@/stores/GlobalStore'
import { AI_SIDEBAR_VIEW_TYPE } from '@/constants/views'

/**
 * Add files to AI agent scope and open the AI sidebar.
 * Adds to the current active session's scope without replacing existing entries.
 */
export async function useFilesInAgent(files: TFile[]): Promise<void> {
  const chatService = ChatService.getInstance()

  const session = chatService.activeSession.value
  if (!session) return

  const scope = session.scopeResolver
  for (const f of files) {
    if (!scope.entries.value.some((e) => e.path === f.path)) {
      scope.entries.value = [...scope.entries.value, { type: 'file' as const, path: f.path }]
    }
  }
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
