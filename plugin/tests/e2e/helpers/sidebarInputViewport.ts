/** A previous wide-pane probe can leave a persisted sidebar wider than this window. */
export function fitSidebarInputWidths(
  sidebars: { size: number; setSize: (size: number) => void }[],
  viewportWidth: number
) {
  const sizes = sidebars.map((sidebar) => sidebar.size)
  const limit = Math.max(1, Math.floor(viewportWidth / 3))
  for (const sidebar of sidebars) {
    if (sidebar.size > limit) sidebar.setSize(limit)
  }
  return sizes
}
