/** Physical visibility is independent of mounted rows, client size and logical activation. */
export interface RootChatOwnerState {
  intendedOwner: string
  owner: string
  root: string
  activeLeaf: string
  activeTab: string
  session: string
  connectedPaneIds: string[]
  secondPane: string
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }
  viewport: { left: number; top: number; right: number; bottom: number }
  hitInside: boolean[]
}

export function rootChatOwnerVisible(state: RootChatOwnerState): boolean {
  const r = state.rect,
    v = state.viewport
  return (
    state.owner === state.intendedOwner &&
    state.root === 'root' &&
    state.activeLeaf === state.owner &&
    state.activeTab === state.session &&
    state.connectedPaneIds.includes(state.owner) &&
    state.secondPane !== state.owner &&
    state.connectedPaneIds.includes(state.secondPane) &&
    r.width > 0 &&
    r.height > 0 &&
    r.left >= v.left &&
    r.top >= v.top &&
    r.right <= v.right &&
    r.bottom <= v.bottom &&
    state.hitInside.length === 2 &&
    state.hitInside.every(Boolean)
  )
}
