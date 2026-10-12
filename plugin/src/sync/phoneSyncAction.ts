import type { ItemView, Plugin } from 'obsidian'
import type { SyncStatus } from './status'

/**
 * A phone has no status bar, so sync speaks from the header of the open note — and only when
 * something is wrong: no server, something to act on, a conflict copy. All is well, nothing.
 */
export function phoneSyncIcon(
  status: SyncStatus
): { icon: string; tooltip: string; warning: boolean } | null {
  if (status.state === 'offline')
    return { icon: 'cloud-off', tooltip: 'Sync: the server is unavailable', warning: false }
  if (status.state === 'error')
    return { icon: 'cloud-alert', tooltip: 'Sync needs attention', warning: true }
  if (status.heldDeletes > 0)
    return { icon: 'cloud-alert', tooltip: 'Sync: deletions are held back', warning: true }
  const conflicts = status.conflicts ?? 0
  if (conflicts > 0)
    return {
      icon: 'cloud-alert',
      tooltip: conflicts === 1 ? 'Sync: 1 conflict copy' : `Sync: ${conflicts} conflict copies`,
      warning: true,
    }
  if ((status.review ?? 0) > 0)
    return { icon: 'cloud', tooltip: `Sync: ${status.review} waiting for you`, warning: false }
  return null
}

/** Puts the glyph into every open note's header, and takes it out again; returns the painter. */
export function mountPhoneSyncAction(
  plugin: Plugin,
  open: () => void
): (status: SyncStatus) => void {
  const actions = new Map<ItemView, HTMLElement>()
  let current: SyncStatus | null = null
  const paint = () => {
    const want = current && phoneSyncIcon(current)
    for (const leaf of plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as ItemView
      actions.get(view)?.remove()
      actions.delete(view)
      if (!want) continue
      const el = view.addAction(want.icon, want.tooltip, open)
      el.addClass('abele-sync-header-action')
      el.toggleClass('mod-warning', want.warning)
      actions.set(view, el)
    }
  }
  plugin.registerEvent(plugin.app.workspace.on('layout-change', paint))
  plugin.register(() => {
    for (const el of actions.values()) el.remove()
    actions.clear()
  })
  return (status) => {
    current = status
    paint()
  }
}
