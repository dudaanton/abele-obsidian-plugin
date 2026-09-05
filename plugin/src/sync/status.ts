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

/** What the status bar says: the label, and how much is still to go while it goes. */
export function statusText(status: SyncStatus): string {
  if (status.state === 'syncing' && status.pending > 0) {
    return `${STATUS_LABEL.syncing} ${status.pending}`
  }
  return STATUS_LABEL[status.state]
}

/**
 * The whole of it, for the tooltip: what state sync is in, when it last got through, and what
 * went wrong if anything did.
 */
export function statusTooltip(status: SyncStatus): string {
  const lines = [`Abele Sync: ${STATUS_LABEL[status.state]}`]
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
  setIcon(icon, STATUS_ICON[status.state])
  el.createSpan({ cls: 'abele-sync-status-text', text: statusText(status) })
  el.setAttribute('aria-label', statusTooltip(status))
}
