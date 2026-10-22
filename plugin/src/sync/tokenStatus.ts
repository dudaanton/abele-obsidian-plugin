import { DISCONNECTED_STATUS, type SyncStatus } from './status'
import { safetyStopReason, type TokenUi } from './tokenUi'
import { connectionLine } from './connectionLine'
import { transferText } from './transferProgress'

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
  const isBusy = (one: (typeof rows)[number]) =>
    !safetyStopReason(activity[one.id]) &&
    !one.paused &&
    ['idle', 'syncing', 'joining'].includes(one.status) &&
    (one.status === 'syncing' ||
      one.status === 'joining' ||
      !!activity[one.id]?.transfer ||
      !!activity[one.id]?.startup ||
      !!activity[one.id]?.inspection)
  status.state = rows.some(isBusy)
    ? 'syncing'
    : rows.some(
          (one) =>
            !!safetyStopReason(activity[one.id]) ||
            ['error', 'scope_updating', 'scope_unavailable', 'needs-token'].includes(one.status)
        )
      ? 'error'
      : rows.some((one) => one.status === 'offline')
        ? 'offline'
        : rows.every((one) => one.paused)
          ? 'paused'
          : 'idle'
  status.pending = rows.reduce((sum, one) => sum + (activity[one.id]?.pending ?? 0), 0)
  status.heldDeletes = rows.reduce((sum, one) => sum + (activity[one.id]?.heldDeletes ?? 0), 0)
  status.deferred = rows.reduce((sum, one) => sum + (activity[one.id]?.deferred ?? 0), 0)
  status.conflicts = rows.reduce((sum, one) => sum + (activity[one.id]?.conflicts?.length ?? 0), 0)
  status.review = ui.candidates.value.length + ui.questions.value.length
  status.lastError =
    rows
      .map((one) => safetyStopReason(activity[one.id]) ?? activity[one.id]?.error)
      .find(Boolean) ?? null
  const busy = rows.find(isBusy)
  if (busy) {
    const transfer = activity[busy.id]?.transfer
    status.progressText = transfer
      ? transferText({
          ...transfer,
          bytes: undefined,
          totalBytes: undefined,
          secondsLeft: undefined,
        })
      : connectionLine(busy, activity[busy.id])
  }
  const stamps = rows
    .map((one) => activity[one.id]?.lastSync)
    .filter((one): one is number => typeof one === 'number')
  if (stamps.length === rows.length) status.lastSyncAt = new Date(Math.min(...stamps)).toISOString()
  return status
}
