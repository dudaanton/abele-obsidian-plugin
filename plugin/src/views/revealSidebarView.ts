import {
  Platform,
  type App,
  type Workspace,
  type WorkspaceLeaf,
  type WorkspaceSidedock,
  type Plugin,
} from 'obsidian'

/** Registration rebuilds existing leaves asynchronously, after onLayoutReady on reload. */
export function restoreRegisteredViewHeaders(plugin: Plugin, types: readonly string[]): void {
  let running = false
  let pending = false
  let disposed = false
  plugin.register(() => {
    disposed = true
  })
  const restore = async () => {
    pending = true
    if (running || disposed) return
    running = true
    try {
      while (pending && !disposed) {
        pending = false
        await loadDeferredSidebarViews(plugin.app.workspace, types, true)
      }
    } finally {
      running = false
    }
  }
  plugin.registerEvent(
    plugin.app.workspace.on('layout-change', () => {
      void restore()
    })
  )
  plugin.app.workspace.onLayoutReady(() => {
    void restore()
  })
}

/** Deferred sidebar leaves need their view loaded to restore its title and retained state. */
export async function loadDeferredSidebarViews(
  workspace: Workspace,
  types: readonly string[],
  includeMainTabs = false
): Promise<void> {
  const leaves = new Set(types.flatMap((type) => workspace.getLeavesOfType(type)))
  await Promise.all(
    [...leaves].map(async (leaf) => {
      const root = leaf.getRoot()
      if (!includeMainTabs && root !== workspace.leftSplit && root !== workspace.rightSplit) return
      try {
        await leaf.loadIfDeferred?.()
        const restored = leaf as WorkspaceLeaf & {
          updateHeader?: () => void
          rebuildView?: () => Promise<void>
          working?: boolean
        }
        // The host's registration callback owns this leaf until setViewState completes.
        // Its resulting layout change will run restoration again.
        if (restored.working) return
        // An unloaded plugin leaves a placeholder with its view type as the title. It is not
        // a deferred view, so loading it alone cannot recreate the newly registered view.
        if (leaf.view && leaf.view.getDisplayText() === leaf.view.getViewType()) {
          await restored.rebuildView?.()
          await leaf.loadIfDeferred?.()
        }
        restored.updateHeader?.()
      } catch (error) {
        console.debug('[Abele] Deferred sidebar unavailable', error)
      }
    })
  )
}

/** How long a phone's drawer takes to finish closing, and so how long a reveal waits to settle. */
const DRAWER_SETTLE_MS = 500

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

const onScreen = (split: WorkspaceSidedock) =>
  ((split as unknown as { containerEl?: HTMLElement }).containerEl?.offsetWidth ?? 1) > 0

/**
 * Shows the panel of this type, opening one in the right sidebar if none is open, and resolves
 * once it is on screen.
 *
 * The reveal is waited for, and a sidebar it left shut is opened. On a phone that is not enough:
 * a drawer still closing when the reveal comes — its panel was closed a moment before — finishes
 * closing after it and hides itself while it still counts as open, the panel in it and nothing of
 * it on screen. So on a phone the drawer is looked at once it has settled, and one that hid itself
 * is closed properly and opened again.
 */
export async function revealSidebarView(app: App, viewType: string): Promise<void> {
  const { workspace } = app
  // A user can also keep this view in a main tab or a popout. A sidebar reveal must not
  // select that tab, nor move or close it; reuse only a copy in one of the sidedocks.
  let leaf: WorkspaceLeaf | null =
    workspace
      .getLeavesOfType(viewType)
      .find(
        (leaf) => leaf.getRoot() === workspace.rightSplit || leaf.getRoot() === workspace.leftSplit
      ) ?? null

  if (!leaf) {
    leaf = workspace.getRightLeaf(false)
    if (!leaf) return
    await leaf.setViewState({ type: viewType, active: true })
  }

  await workspace.revealLeaf(leaf)

  const root = leaf.getRoot()
  const split = [workspace.rightSplit, workspace.leftSplit].find((s) => s === root)
  if (!split) return
  if (split.collapsed) split.expand()
  if (!Platform.isMobile) return

  await pause(DRAWER_SETTLE_MS)
  if (onScreen(split)) return
  split.collapse()
  await pause(DRAWER_SETTLE_MS)
  split.expand()
}
