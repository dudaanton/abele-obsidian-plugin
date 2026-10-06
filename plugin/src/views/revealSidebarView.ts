import { Platform, type App, type WorkspaceLeaf, type WorkspaceSidedock } from 'obsidian'

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
