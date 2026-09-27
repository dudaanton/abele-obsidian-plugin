import { setIcon } from 'obsidian'
import type { EngineStatus } from '@abele/sync-core'
import { formatWhen } from './format'

/**
 * What the plugin says sync is doing, in one word and one line.
 *
 * The engine has five states and knows nothing about a device that was never set up, which is
 * the state a vault spends most of its life in: `disconnected` is the plugin's own, and it is
 * the only one this module adds. Everything else is the engine's, spelled the same way, so a
 * reader comparing the status bar with the daemon's log is looking at one vocabulary.
 *
 * The labels are the user's words rather than the engine's — `idle` is what the engine calls a
 * device with nothing left to do, and what a person wants to read is *Fully synced*, which is
 * also the phrase Obsidian Sync uses for the same thing.
 */

export type SyncState = 'disconnected' | 'idle' | 'syncing' | 'paused' | 'offline' | 'error'

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
}

/** A device that has not been set up: no engine, nothing to report, nothing wrong. */
export const DISCONNECTED_STATUS: SyncStatus = Object.freeze({
  state: 'disconnected',
  pending: 0,
  lastSyncAt: null,
  lastError: null,
  cursor: 0,
  headSeq: null,
})

export const STATUS_LABEL: Record<SyncState, string> = {
  disconnected: 'Not connected',
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
  idle: 'check-circle',
  syncing: 'refresh-cw',
  paused: 'pause-circle',
  offline: 'wifi-off',
  error: 'alert-circle',
}

/** The engine's status as the plugin's. The fields are the same; only the state is wider. */
export const statusOf = (engine: EngineStatus): SyncStatus => ({ ...engine })

/**
 * The one word for the status, which is the state's label but for one case: a device that has
 * settled with changes still unsent — what the last push kept back — is *Waiting*, never *Fully
 * synced*. Nothing is being sent at that moment, and saying it is all through would be a lie.
 */
export function statusLabel(status: SyncStatus): string {
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
  return status.state === 'idle' && status.pending > 0 ? `${label} (${status.pending})` : label
}

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
  if (status.state !== 'disconnected') lines.push(`Last sync ${formatWhen(status.lastSyncAt)}`)
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
  const icon = el.createSpan({ cls: 'abele-sync-status-icon' })
  // A tick beside *Waiting* would say the opposite of the word.
  setIcon(icon, status.state === 'idle' && status.pending > 0 ? 'clock' : STATUS_ICON[status.state])
  el.createSpan({ cls: 'abele-sync-status-text', text: statusText(status) })
  el.setAttribute('aria-label', statusTooltip(status))
}
