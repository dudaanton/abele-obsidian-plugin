/** Source arrival alone does not mean the rendered range can hold the reading position. */
export function readingPositionReachable(
  box: { scrollTop: number; scrollHeight: number; clientHeight: number },
  offset: number,
  readAt: number
) {
  const target = box.scrollTop + offset - readAt
  return target >= 0 && target <= box.scrollHeight - box.clientHeight
}

/** A collapsed drawer keeps its backdrop until its closing motion has finished. */
export function drawersClosed(
  drawers: { collapsed: boolean; backdropEl: { isConnected: boolean } }[],
  sharedBackdrops = 0
) {
  return (
    sharedBackdrops === 0 &&
    drawers.every((drawer) => drawer.collapsed && !drawer.backdropEl.isConnected)
  )
}
