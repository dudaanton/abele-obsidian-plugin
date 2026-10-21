import { watch } from 'vue'
import type { Plugin } from 'obsidian'
import { DebuggerService } from './DebuggerService'

const SELECTION_KEY = 'abele-debug-selection'

/** Mobile layouts can omit a desktop drawer leaf. Keep observation identity outside that
 * layout too; restoring a leaf only observes the retained session, never starts a program. */
export function registerDebuggerSelection(plugin: Plugin, viewType: string) {
  const service = DebuggerService.instance
  let previous: string | undefined
  let established = false
  plugin.register(
    watch(
      () => [
        service.active.value,
        service.sourceRevision.value,
        service.active.value?.revision.value,
      ],
      () => {
        const selection = service.selectionState()
        if (selection === undefined) return
        if ('sessionId' in selection) established = true
        else if (!established) return
        const serialized = JSON.stringify(selection)
        if (serialized === previous) return
        previous = serialized
        plugin.app.saveLocalStorage(SELECTION_KEY, 'sessionId' in selection ? selection : null)
        plugin.app.workspace.requestSaveLayout?.()
      }
    )
  )
  plugin.app.workspace.onLayoutReady(async () => {
    const leaves = plugin.app.workspace.getLeavesOfType(viewType)
    for (const duplicate of leaves.slice(1)) duplicate.detach()
    const saved: unknown = plugin.app.loadLocalStorage(SELECTION_KEY)
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return
    const workspace = plugin.app.workspace
    const existing = workspace.getLeavesOfType(viewType)[0]
    try {
      await existing?.loadIfDeferred?.()
      if (existing && service.active.value) return
      const leaf = existing ?? workspace.getRightLeaf(false)
      if (!leaf) return
      await leaf.setViewState({ type: viewType, active: false, state: { ...saved } })
      await leaf.loadIfDeferred?.()
    } catch (error) {
      console.debug('[debugger] Retained selection could not be opened', error)
    }
  })
}
