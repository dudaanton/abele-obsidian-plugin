import { englishSyncText, type SyncText } from './presentation'
import type { TokenConnectionRecord } from './tokenConnectionRegistry'
import { connectionStatusText, SCOPE_DELETED, type ConnectionActivity } from './tokenUi'
import { formatWhen } from './format'
import { transferText } from './transferProgress'

/**
 * What one connection row says, as a code and one line: a dot coloured by its state and the one
 * thing worth reading now. The window behind the row says the rest.
 */

export type ConnectionTone = 'green' | 'orange' | 'red' | 'accent' | 'faint'

type Row = Pick<TokenConnectionRecord, 'status' | 'paused' | 'rootIssue'>

const ATTENTION = ['error', 'needs-token', 'scope_unavailable', 'disconnected']

/** Something is moving: a first scan, a comparison, a push or a pull. */
export function connectionBusy(row: Row, activity?: ConnectionActivity): boolean {
  if (activity?.error === SCOPE_DELETED || row.paused || row.rootIssue) return false
  return (
    row.status === 'syncing' ||
    row.status === 'joining' ||
    row.status === 'scope_updating' ||
    !!activity?.startup ||
    !!activity?.inspection ||
    !!activity?.comparison ||
    !!activity?.transfer ||
    !!activity?.pull ||
    (activity?.total !== undefined && (activity.completed ?? 0) < activity.total)
  )
}

/**
 * Green when everything is through, the accent while moving, orange when it waits on something
 * outside (paused, no server, a copy to look at), red when the person has to act.
 */
export function connectionTone(row: Row, activity?: ConnectionActivity): ConnectionTone {
  if (activity?.safetyStop) return 'red'
  if (row.rootIssue) return 'red'
  if (ATTENTION.includes(row.status) || activity?.startup?.outcome === 'failed') return 'red'
  if (row.paused || row.status === 'offline') return 'orange'
  if (connectionBusy(row, activity)) return 'accent'
  if (activity?.conflicts?.length || activity?.refused?.length || activity?.backgroundAttention)
    return 'orange'
  return 'green'
}

/** The one line under the connection's name: what it is doing, or what it waits on. */
export function connectionLine(
  row: Row,
  activity?: ConnectionActivity,
  text: SyncText = englishSyncText,
  when: (iso: string) => string = formatWhen
): string {
  if (activity?.safetyStop) return activity.safetyStop
  if (activity?.error === SCOPE_DELETED) return connectionStatusText(row, activity, text)
  if (row.rootIssue) return connectionStatusText(row, activity, text)
  if (row.paused) return text('Paused')
  const phase = activity?.startup ?? activity?.inspection
  const numbered = (stage: string, completed: number, total: number) =>
    text(stage) +
    (total > 0
      ? text(' · {completed} of {total}', {
          completed: completed.toLocaleString(),
          total: total.toLocaleString(),
        })
      : '')
  if (phase)
    return (
      numbered(activity?.startup?.stage ?? 'Checking the vault', phase.completed, phase.total) +
      (activity?.startup?.outcome === 'failed' ? text(' · Needs attention') : '')
    )
  if (row.status === 'offline') return text('Server unavailable, retrying')
  if (ATTENTION.includes(row.status) || row.status === 'scope_updating')
    return connectionStatusText(row, activity, text)
  if (activity?.transfer) return transferText(activity.transfer, text)
  if (activity?.comparison)
    return numbered('Comparing files', activity.comparison.completed, activity.comparison.total)
  if (activity?.pull) return transferText({ ...activity.pull, totalKnown: false }, text)
  if (activity?.total !== undefined && (activity.completed ?? 0) < activity.total)
    return text('{completed} of {total} files', {
      completed: activity.completed ?? 0,
      total: activity.total,
    })
  if (row.status === 'syncing') return text('Syncing')
  if (activity?.backgroundAttention) return activity.backgroundAttention
  if (activity?.conflicts?.length)
    return text(
      '{count} conflict copies',
      { count: activity.conflicts.length },
      '{count} conflict copy'
    )
  if (activity?.refused?.length)
    return text(
      '{count} files not sent',
      { count: activity.refused.length },
      '{count} file not sent'
    )
  if (activity?.lastSync)
    return text('Synced {when}', { when: when(new Date(activity.lastSync).toISOString()) })
  return text('Not synced yet')
}

/** How much of a running exchange is done, for a bar; null when nothing is counted. */
export function connectionProgress(
  activity?: ConnectionActivity
): { completed: number; total: number } | null {
  const one =
    activity?.startup ??
    activity?.inspection ??
    activity?.transfer ??
    activity?.pull ??
    activity?.comparison ??
    (activity?.total !== undefined
      ? { completed: activity.completed ?? 0, total: activity.total }
      : null)
  return one && one.total !== undefined && one.total > 0 && one.completed < one.total
    ? { completed: one.completed, total: one.total }
    : null
}
