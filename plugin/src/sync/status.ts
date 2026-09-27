import { setIcon } from 'obsidian'
import type { EngineStatus } from '@abele/sync-core'
import { formatWhen } from './format'

/**
 * What the plugin says sync is doing, in one word and one line.
 *
 * The engine has five states and knows nothing about a device that was never set up, which is
 * the state a vault spends most of its life in: `disconnected` is the plugin's own. So is
 * `joining`: a device that took a connection from a transfer, with files here and on the server,
 * builds no engine until somebody says which side wins where both hold a file. Everything else is the engine's, spelled the same way, so a
 * reader comparing the status bar with the daemon's log is looking at one vocabulary.
 *
 * The labels are the user's words rather than the engine's — `idle` is what the engine calls a
 * device with nothing left to do, and what a person wants to read is *Fully synced*, which is
 * also the phrase Obsidian Sync uses for the same thing.
 */

export type SyncState =
  | 'disconnected'
  | 'joining'
  | 'idle'
  | 'syncing'
  | 'paused'
  | 'offline'
  | 'error'

export interface SyncStatus {
  state: SyncState
  /** How much the last scan found still to send; 0 when everything is through. */
  pending: number
  /** When the last sync finished, ISO-8601, or null before one has. */
  lastSyncAt: string | null
  /** What the last failure said, cleared by the next sync that gets through. */
  lastError: string | null
  /** The feed position this device holds. */
  cursor: number
  /** The vault's head, as last heard from the server, or null before it has been asked. */
  headSeq: number | null
  /**
   * How many deletes made on this device the engine holds back until the person decides
   * whether they go everywhere (phase 3b, decision 8); 0 when none are.
   */
  heldDeletes: number
  /**
   * How many changes to Obsidian's settings from other devices are staged rather than written,
   * waiting for Reload now or Keep this device's (phase 3b, decision 11); 0 when none are.
   */
  deferred: number
}

/** A device that has not been set up: no engine, nothing to report, nothing wrong. */
export const DISCONNECTED_STATUS: SyncStatus = Object.freeze({
  state: 'disconnected',
  pending: 0,
  lastSyncAt: null,
  lastError: null,
  cursor: 0,
  headSeq: null,
  heldDeletes: 0,
  deferred: 0,
})

export const STATUS_LABEL: Record<SyncState, string> = {
  disconnected: 'Not connected',
  joining: 'Choose how to join',
  idle: 'Fully synced',
  syncing: 'Syncing',
  paused: 'Paused',
  offline: 'Offline',
  error: 'Sync error',
}

/**
 * The glyph each state wears. Lucide names, which is what `setIcon` takes; no colour is named
 * anywhere — the status bar takes the theme's own, and a theme that recolours it is right to.
 */
export const STATUS_ICON: Record<SyncState, string> = {
  disconnected: 'cloud-off',
  joining: 'git-merge',
  idle: 'check-circle',
  syncing: 'refresh-cw',
  paused: 'pause-circle',
  offline: 'wifi-off',
  error: 'alert-circle',
}

/**
 * The engine's status as the plugin's. The fields are the same; the state is wider, and a held
 * or staged count the engine leaves out — it always sets both, but the fields are optional — is
 * none.
 */
export const statusOf = (engine: EngineStatus): SyncStatus => ({
  ...engine,
  heldDeletes: engine.heldDeletes ?? 0,
  deferred: engine.deferred ?? 0,
})

/** What the status bar says while deletions are held. */
export const HELD_LABEL = 'Deletions held'

/**
 * Whether the status bar leads with the held deletions: they are held, and sync has settled —
 * a state doing something (syncing, paused, offline, failing) keeps its own word, with the held
 * line in the tooltip.
 */
const leadsWithHeld = (status: SyncStatus): boolean =>
  status.heldDeletes > 0 && status.state === 'idle'

/** The tooltip's line for held deletions: how many, and where they are decided. */
export function heldLine(count: number): string {
  const files =
    count === 1 ? '1 file deleted on this device is' : `${count} files deleted on this device are`
  return (
    `${files} held back from the other devices, because so many went at once. Decide on the ` +
    'Sync tab whether they are deleted everywhere or put back.'
  )
}

/**
 * The one word for the status, which is the state's label but for one case: a device that has
 * settled with changes still unsent — what the last push kept back — is *Waiting*, never *Fully
 * synced*. Nothing is being sent at that moment, and saying it is all through would be a lie.
 */
export function statusLabel(status: SyncStatus): string {
  if (leadsWithHeld(status)) return HELD_LABEL
  if (status.state === 'idle' && status.pending > 0) return 'Waiting'
  return STATUS_LABEL[status.state]
}

/**
 * What the status bar says: the word, and how much is waiting while nothing is being sent.
 *
 * No number while a sync runs. The engine counts what its scan found and says nothing more
 * until the whole push is recorded, so a number here would stand still for the length of a
 * big push and then drop to nothing — which reads as stuck. It is in the tooltip instead, as
 * what the run found rather than what is left.
 */
export function statusText(status: SyncStatus): string {
  const label = statusLabel(status)
  if (leadsWithHeld(status)) return `${label} (${status.heldDeletes})`
  return status.state === 'idle' && status.pending > 0 ? `${label} (${status.pending})` : label
}

/** The tooltip's line for settings from other devices waiting to be applied. */
export function stagedLine(count: number): string {
  return `Settings waiting (${count}) — Apply and reload on the Sync tab.`
}

/** What the tooltip says of a join waiting for its question to be answered. */
export const JOINING_LINE =
  'This vault and the server both hold files. Nothing syncs until you choose, on the Sync tab, ' +
  'which side is kept where both have a file.'

/** How many changes, in words: `1 change is`, `3 changes are`. */
export function changesAre(count: number): string {
  return count === 1 ? '1 change is' : `${count} changes are`
}

/**
 * The whole of it, for the tooltip: what state sync is in, how much is on its way, when it
 * last got through, and what went wrong if anything did.
 */
export function statusTooltip(status: SyncStatus): string {
  const lines = [`Abele Sync: ${statusLabel(status)}`]
  if (status.state === 'syncing' && status.pending > 0) {
    lines.push(`${status.pending} ${status.pending === 1 ? 'change' : 'changes'} found to send`)
  }
  if (status.state === 'idle' && status.pending > 0) {
    lines.push(`${changesAre(status.pending)} waiting to be sent`)
  }
  if (status.heldDeletes > 0) lines.push(heldLine(status.heldDeletes))
  if (status.deferred > 0) lines.push(stagedLine(status.deferred))
  if (status.state === 'joining') lines.push(JOINING_LINE)
  else if (status.state !== 'disconnected') {
    lines.push(`Last sync ${formatWhen(status.lastSyncAt)}`)
  }
  if (status.lastError !== null) lines.push(status.lastError)
  return lines.join('\n')
}

/**
 * Draws the status into a status-bar item.
 *
 * Built from Obsidian's own element helpers rather than from markup, so nothing here can put a
 * string from a server into the DOM as HTML; the icon is `setIcon`, which is the one way a
 * plugin gets a Lucide glyph that follows the theme.
 */
export function renderStatus(el: HTMLElement, status: SyncStatus): void {
  el.empty()
  el.addClass('abele-sync-status')
  el.toggleClass('abele-sync-status_warning', leadsWithHeld(status))
  const icon = el.createSpan({ cls: 'abele-sync-status-icon' })
  // A tick beside *Waiting* would say the opposite of the word.
  setIcon(
    icon,
    leadsWithHeld(status)
      ? 'alert-triangle'
      : status.state === 'idle' && status.pending > 0
        ? 'clock'
        : STATUS_ICON[status.state]
  )
  el.createSpan({ cls: 'abele-sync-status-text', text: statusText(status) })
  el.setAttribute('aria-label', statusTooltip(status))
}
