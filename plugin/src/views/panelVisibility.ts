import { GlobalStore } from '@/stores/GlobalStore'
import type { ItemView, WorkspaceItem } from 'obsidian'

/**
 * Whether a panel can be seen right now. A sidebar tab behind another tab, or a sidebar (a
 * drawer, on a phone) folded away, keeps its view — and the component inside it — alive.
 */
export function isPanelShown(view: ItemView): boolean {
  const el = view.containerEl
  if (!el.isConnected) return false

  const workspace = view.app?.workspace
  const root = view.leaf?.getRoot?.() as (WorkspaceItem & { collapsed?: boolean }) | undefined
  if (
    workspace &&
    (root === workspace.leftSplit || root === workspace.rightSplit) &&
    root?.collapsed
  ) {
    return false
  }

  // A tab that is not the selected one sits under a `display: none` container.
  return el.offsetParent !== null
}

/**
 * Keeps the panel's id in `hiddenPanelIds` while it cannot be seen, so the component inside
 * can stop recalculating. Call from `onOpen`; `forgetPanel` from `onClose`.
 */
export function trackPanelVisibility(view: ItemView, id: string): () => void {
  const update = (): void => {
    const hidden = GlobalStore.getInstance().hiddenPanelIds
    const shown = isPanelShown(view)
    const listed = hidden.value.includes(id)
    if (shown && listed) hidden.value = hidden.value.filter((x) => x !== id)
    else if (!shown && !listed) hidden.value = [...hidden.value, id]
  }

  const workspace = view.app?.workspace
  if (workspace) {
    // Picking another tab and folding a sidebar are both layout changes; resize covers a
    // drawer sliding in on a phone.
    view.registerEvent(workspace.on('layout-change', update))
    view.registerEvent(workspace.on('active-leaf-change', update))
    view.registerEvent(workspace.on('resize', update))
  }
  return update
}

/** Records the element a panel's component is teleported into — see `panelElements`. */
export function registerPanelElement(id: string, el: HTMLElement): void {
  const elements = GlobalStore.getInstance().panelElements
  elements.value = new Map(elements.value).set(id, el)
}

export function forgetPanel(id: string): void {
  const elements = GlobalStore.getInstance().panelElements
  if (elements.value.has(id)) {
    const next = new Map(elements.value)
    next.delete(id)
    elements.value = next
  }
  const hidden = GlobalStore.getInstance().hiddenPanelIds
  if (hidden.value.includes(id)) hidden.value = hidden.value.filter((x) => x !== id)
}
