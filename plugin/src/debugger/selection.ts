import { watch } from 'vue'
import type { Plugin } from 'obsidian'
import { DebuggerService } from './DebuggerService'

const SELECTION_KEY = 'abele-debug-selection'

/** Mobile layouts can omit a desktop drawer leaf. Keep observation identity outside that
 * layout too; restoring a leaf only observes the retained session, never starts a program. */
export function registerDebuggerSelection(plugin: Plugin, viewType: string) {
  const service = DebuggerService.instance
  let previous: string | undefined
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
        const serialized = JSON.stringify(selection)
        if (serialized === previous) return
        previous = serialized
        plugin.app.saveLocalStorage(SELECTION_KEY, 'sessionId' in selection ? selection : null)
      }
    )
  )
  plugin.app.workspace.onLayoutReady(async () => {
    const saved: unknown = plugin.app.loadLocalStorage(SELECTION_KEY)
    if (!saved || typeof saved !== 'object') return
    const workspace = plugin.app.workspace
    const existing = workspace.getLeavesOfType(viewType)[0]
    if (existing && service.active.value) return
    const leaf = existing ?? workspace.getLeftLeaf(false)
    if (!leaf) return
    try {
      await leaf.setViewState({ type: viewType, active: false, state: saved })
    } catch (error) {
      console.debug('[debugger] Retained selection could not be opened', error)
    }
  })
}
