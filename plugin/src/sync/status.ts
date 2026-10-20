import type { EngineStatus } from '@abele/sync-sdk/core'
import SyncStatusItem from '@/components/sync/SyncStatusItem.vue'
import { renderKit } from '@/components/obsidian/mount'
import { formatWhen } from './format'
import { t } from '@/i18n'

/**
 * What the plugin says sync is doing, in one word and one line.
 *
 * The engine has five states and knows nothing about a device that was never set up, which is
 * the state a vault spends most of its life in: `disconnected` is the plugin's own. So is
 * `joining`: a connection that is still starting. Everything else is the engine's,
 * spelled the same way, so a reader comparing the status bar with the daemon's log is looking at one vocabulary.
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
  progressText?: string
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
  /** Conflict copies saved beside the files they came from, still in the vault; 0 when none. */
  conflicts?: number
  /** Incoming code and private files waiting for the person's decision; 0 when none. */
  review?: number
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
  joining: 'Connecting',
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

/** A settled sync with conflict copies leads with them: they are what the person has to open. */
const leadsWithConflicts = (status: SyncStatus): boolean =>
  !leadsWithHeld(status) && (status.conflicts ?? 0) > 0 && status.state === 'idle'

/** A settled sync with something to decide leads with how much waits. */
const leadsWithReview = (status: SyncStatus): boolean =>
  !leadsWithHeld(status) &&
  !leadsWithConflicts(status) &&
  (status.review ?? 0) > 0 &&
  status.state === 'idle'

/** Whether the status bar wears the warning colour. */
export const statusWarns = (status: SyncStatus): boolean =>
  leadsWithHeld(status) || leadsWithConflicts(status)

/** The tooltip's line for held deletions: how many, and where they are decided. */
export function heldLine(count: number): string {
  return t('sync.status.heldLine', { count })
}

/**
 * The one word for the status, which is the state's label but for one case: a device that has
 * settled with changes still unsent — what the last push kept back — is *Waiting*, never *Fully
 * synced*. Nothing is being sent at that moment, and saying it is all through would be a lie.
 */
export function statusLabel(status: SyncStatus): string {
  if (leadsWithHeld(status)) return t('sync.status.held')
  if (leadsWithConflicts(status))
    return t('sync.status.conflicts', { count: status.conflicts ?? 0 })
  if (leadsWithReview(status)) return t('sync.status.review')
  if (status.state === 'idle' && status.pending > 0) return t('sync.status.waiting')
  return t(`sync.status.${status.state}`)
}

/**
 * What the status bar says: the word, and how much is waiting while nothing is being sent.
 *
 * A running connection supplies its short phase and progress line. Hosts without live
 * progress retain the state label; their pending count is a scan result, not a transfer count.
 */
export function statusText(status: SyncStatus): string {
  if (status.state === 'syncing' && status.progressText) return status.progressText
  const label = statusLabel(status)
  if (leadsWithHeld(status)) return `${label} (${status.heldDeletes})`
  if (leadsWithConflicts(status)) return label
  if (leadsWithReview(status)) return `${label} (${status.review})`
  return status.state === 'idle' && status.pending > 0 ? `${label} (${status.pending})` : label
}

/** The tooltip's line for settings from other devices waiting to be applied. */
export function stagedLine(count: number): string {
  return t('sync.status.stagedLine', { count })
}

/** How many changes, in words: `1 change is`, `3 changes are`. */
export function changesAre(count: number): string {
  return t('sync.status.changesAre', { count })
}

/**
 * The whole of it, for the tooltip: what state sync is in, how much is on its way, when it
 * last got through, and what went wrong if anything did.
 */
export function statusTooltip(status: SyncStatus): string {
  const lines = [t('sync.status.title', { status: statusLabel(status) })]
  if (status.state === 'syncing' && status.pending > 0) {
    lines.push(t('sync.status.found', { count: status.pending }))
  }
  if (status.state === 'idle' && status.pending > 0) {
    lines.push(t('sync.status.unsent', { count: status.pending }))
  }
  if (status.heldDeletes > 0) lines.push(heldLine(status.heldDeletes))
  if ((status.conflicts ?? 0) > 0)
    lines.push(t('sync.status.copies', { count: status.conflicts ?? 0 }))
  if ((status.review ?? 0) > 0) lines.push(t('sync.status.decision', { count: status.review ?? 0 }))
  if (status.deferred > 0) lines.push(stagedLine(status.deferred))
  if (status.state === 'joining') lines.push(t('sync.status.connecting'))
  else if (status.state !== 'disconnected') {
    lines.push(t('sync.status.last', { when: formatWhen(status.lastSyncAt) }))
  }
  if (status.lastError !== null) lines.push(status.lastError)
  return lines.join('\n')
}

/** The glyph beside the word: a tick beside *Waiting* would say the opposite of the word. */
function statusIcon(status: SyncStatus): string {
  if (statusWarns(status)) return 'alert-triangle'
  if (leadsWithReview(status)) return 'eye'
  if (status.state === 'idle' && status.pending > 0) return 'clock'
  return STATUS_ICON[status.state]
}

/**
 * Draws the status into a status-bar item: the item's own class and tooltip, and inside it the
 * kit's glyph and word, patched in place on every change. Text, never markup, so nothing here
 * can put a string from a server into the DOM as HTML. Taken out with `unrenderKit` when the
 * plugin unloads.
 */
export function renderStatus(el: HTMLElement, status: SyncStatus): void {
  el.addClass('abele-sync-status')
  el.toggleClass('abele-sync-status_warning', statusWarns(status))
  const tooltip = statusTooltip(status)
  el.setAttribute('aria-label', tooltip)
  renderKit(el, SyncStatusItem, { icon: statusIcon(status), text: statusText(status), tooltip })
}
