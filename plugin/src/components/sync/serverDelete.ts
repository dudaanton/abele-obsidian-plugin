import { t } from '@/i18n'
import { ExternalRecoveryRequired } from '@/sync/external/recovery'
/**
 * What deleting one connection's files from the server would take: its whole scope (vault,
 * folder or group) goes to the server's trash, its key and every key inside it are revoked,
 * this device disconnects and keeps its files.
 */
import { shallowRef } from 'vue'

export interface ServerDeleteFacts {
  files: number
  bytes: number
  /** Keys this one and those scoped inside it; deleting revokes them all. */
  access: { label: string; scope: string }[]
  /** A key that can only read cannot delete; the action is shown, not offered. */
  canWrite: boolean
  unavailableReason?: string
}

export interface ServerDeleteSource {
  facts: (connectionId: string) => ServerDeleteFacts | null
  remove: (connectionId: string) => Promise<void>
}

/** Optional design stand override; production uses the current connection's runtime. */
export const serverDeleteSource = shallowRef<ServerDeleteSource | null>(null)

/** Why the action cannot be taken, or nothing when it can. */
export const READ_ONLY =
  'This key can only read. Only someone who can change these files can delete them.'

export class ServerDeleteWait extends Error {
  constructor(stage: 'stop' | 'safety' | 'disconnect') {
    super(
      (stage === 'stop'
        ? 'Sync is still stopping.'
        : stage === 'safety'
          ? 'Safety check is still running.'
          : 'Local disconnect is still finishing.') +
        ' Local files are kept. Try Delete from the server again.'
    )
  }
}

/** Only an explicit pre-request failure can promise that nothing was deleted. */
export function serverDeleteFailure(host: string, error: unknown): string {
  const notDeleted =
    (error as { deletionOutcome?: unknown } | null)?.deletionOutcome === 'not-deleted'
  let reason: string | undefined
  if (
    (error as { code?: string })?.code === 'forbidden' ||
    (error as { status?: number })?.status === 403
  )
    reason = 'This connection does not allow that action.'
  else if (error instanceof ServerDeleteWait) reason = error.message
  else if (error instanceof ExternalRecoveryRequired)
    // Render only locally defined reasons, never arbitrary exception or server response text.
    reason = error.message.includes('installation or retained-byte recovery is unfinished')
      ? 'Local installation or retained-byte recovery is unfinished. The connection and recovery evidence remain intact.'
      : 'Local external-file recovery or disconnect preparation is required. The connection and recovery evidence remain intact.'
  else {
    const stage = (error as { deletionStage?: unknown } | null)?.deletionStage
    if (stage === 'stop')
      reason = 'Sync could not finish stopping. Local files are kept. Try again.'
    if (stage === 'safety' || stage === 'disconnect')
      reason =
        'Local safety checks could not finish. Files and recovery evidence are kept. Try again.'
  }
  if (reason)
    return notDeleted ? reason : t('streamC.6225fbec300d3010', { v1: String(host) }) + ' ' + reason
  return notDeleted
    ? t('streamC.a44e6513a64073e4', { v1: String(host) })
    : t('streamC.6225fbec300d3010', { v1: String(host) })
}

/** Bytes as a person reads a folder's size. */
export function folderSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
