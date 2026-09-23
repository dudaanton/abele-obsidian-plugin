/**
 * A panel that is open but cannot be seen is listed in the store, so what it renders can stop
 * recalculating. Only the parts that do not need layout are checked here: happy-dom computes
 * none, so whether a background tab reads as hidden is left to the live app.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { GlobalStore } from '@/stores/GlobalStore'
import { FinanceSidebarView } from '@/views/FinanceSidebarView'
import { isPanelShown, trackPanelVisibility } from '@/views/panelVisibility'
import { useVault } from '../helpers/testEnv'

function fakeWorkspace() {
  const handlers = new Map<string, Array<() => void>>()
  const rightSplit = { collapsed: false }
  return {
    rightSplit,
    leftSplit: { collapsed: false },
    on(name: string, cb: () => void) {
      handlers.set(name, [...(handlers.get(name) ?? []), cb])
      return { name }
    },
    fire(name: string) {
      for (const cb of handlers.get(name) ?? []) cb()
    },
  }
}

function makeView(workspace: ReturnType<typeof fakeWorkspace>) {
  const view = new FinanceSidebarView(
    { getRoot: () => workspace.rightSplit } as never,
    { workspace } as never
  )
  document.body.appendChild(view.containerEl)
  return view
}

describe('panel visibility', () => {
  beforeEach(() => {
    useVault([])
    GlobalStore.getInstance().hiddenPanelIds.value = []
    GlobalStore.getInstance().financeSidebarIds.value = []
  })

  it('counts a panel in a folded sidebar as hidden, and shown again when unfolded', () => {
    const workspace = fakeWorkspace()
    const view = makeView(workspace)
    const hidden = GlobalStore.getInstance().hiddenPanelIds

    workspace.rightSplit.collapsed = true
    expect(isPanelShown(view)).toBe(false)

    trackPanelVisibility(view, 'panel-1')()
    expect(hidden.value).toEqual(['panel-1'])

    workspace.rightSplit.collapsed = false
    Object.defineProperty(view.containerEl, 'offsetParent', { value: document.body })
    workspace.fire('layout-change')
    expect(hidden.value).toEqual([])
  })

  it('keeps the element the panel renders into, even when the pane is not in the page yet', async () => {
    const view = new FinanceSidebarView({} as never, {} as never)
    await view.onOpen()
    const [id] = GlobalStore.getInstance().financeSidebarIds.value
    const el = GlobalStore.getInstance().panelElements.value.get(id)
    expect(el?.getAttribute('abele-finance-sidebar-id')).toBe(id)
    expect(el?.isConnected).toBe(false)

    await view.onClose()
    expect(GlobalStore.getInstance().panelElements.value.has(id)).toBe(false)
  })

  it('forgets a closed panel', async () => {
    const workspace = fakeWorkspace()
    workspace.rightSplit.collapsed = true
    const view = makeView(workspace)
    await view.onOpen()
    expect(GlobalStore.getInstance().hiddenPanelIds.value).toHaveLength(1)

    await view.onClose()
    expect(GlobalStore.getInstance().hiddenPanelIds.value).toEqual([])
  })
})
