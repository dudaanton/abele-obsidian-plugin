import { DISCONNECTED_STATUS, type SyncStatus } from './status'
import type { TokenUi } from './tokenUi'

/**
 * Every connection folded into the one status the status bar shows: moving beats failing beats
 * offline beats paused; conflict copies and what waits for a decision are counted across all.
 */
export function tokenStatus(
  ui: Pick<TokenUi, 'rows' | 'activity' | 'candidates' | 'questions'> | null | undefined
): SyncStatus {
  const rows = ui?.rows.value ?? []
  const status: SyncStatus = { ...DISCONNECTED_STATUS }
  if (!rows.length || !ui) return status
  const activity = ui.activity.value
  status.state = rows.some((one) => one.status === 'syncing')
    ? 'syncing'
    : rows.some((one) =>
          ['error', 'scope_updating', 'scope_unavailable', 'needs-token'].includes(one.status)
        )
      ? 'error'
      : rows.some((one) => one.status === 'offline')
        ? 'offline'
        : rows.every((one) => one.paused)
          ? 'paused'
          : 'idle'
  status.pending = rows.reduce((sum, one) => sum + (activity[one.id]?.pending ?? 0), 0)
  status.conflicts = rows.reduce((sum, one) => sum + (activity[one.id]?.conflicts?.length ?? 0), 0)
  status.review = ui.candidates.value.length + ui.questions.value.length
  status.lastError = rows.map((one) => activity[one.id]?.error).find(Boolean) ?? null
  const stamps = rows
    .map((one) => activity[one.id]?.lastSync)
    .filter((one): one is number => typeof one === 'number')
  if (stamps.length === rows.length) status.lastSyncAt = new Date(Math.min(...stamps)).toISOString()
  return status
}
