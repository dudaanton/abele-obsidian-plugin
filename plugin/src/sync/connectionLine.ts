import type { TokenConnectionRecord } from './tokenConnectionRegistry'
import { connectionStatusText, type ConnectionActivity } from './tokenUi'
import { formatWhen } from './format'
import { transferText } from './transferProgress'

/**
 * What one connection row says, as a code and one line: a dot coloured by its state and the one
 * thing worth reading now. The window behind the row says the rest.
 */

export type ConnectionTone = 'green' | 'orange' | 'red' | 'accent' | 'faint'

type Row = Pick<TokenConnectionRecord, 'status' | 'paused'>

const ATTENTION = ['error', 'needs-token', 'scope_unavailable', 'disconnected']

/** Something is moving: a first scan, a comparison, a push or a pull. */
export function connectionBusy(row: Row, activity?: ConnectionActivity): boolean {
  if (row.paused) return false
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
  if (ATTENTION.includes(row.status) || activity?.startup?.outcome === 'failed') return 'red'
  if (row.paused || row.status === 'offline') return 'orange'
  if (connectionBusy(row, activity)) return 'accent'
  if (activity?.conflicts?.length || activity?.refused?.length) return 'orange'
  return 'green'
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The one line under the connection's name: what it is doing, or what it waits on. */
export function connectionLine(row: Row, activity?: ConnectionActivity): string {
  if (row.paused) return 'Paused'
  const phase = activity?.startup ?? activity?.inspection
  const numbered = (stage: string, completed: number, total: number) =>
    stage +
    (total > 0
      ? ` · ${completed.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} of ${total.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
      : '')
  if (phase)
    return (
      numbered(activity?.startup?.stage ?? 'Checking the vault', phase.completed, phase.total) +
      (activity?.startup?.outcome === 'failed' ? ' · Needs attention' : '')
    )
  if (row.status === 'offline') return 'Server unavailable, retrying'
  if (ATTENTION.includes(row.status) || row.status === 'scope_updating')
    return connectionStatusText(row, activity)
  if (activity?.transfer) return transferText(activity.transfer)
  if (activity?.comparison)
    return numbered('Comparing files', activity.comparison.completed, activity.comparison.total)
  if (activity?.pull) return transferText({ ...activity.pull, totalKnown: false })
  if (activity?.total !== undefined && (activity.completed ?? 0) < activity.total)
    return `${activity.completed ?? 0} of ${activity.total} files`
  if (row.status === 'syncing') return 'Syncing'
  if (activity?.conflicts?.length)
    return count(activity.conflicts.length, 'conflict copy', 'conflict copies')
  if (activity?.refused?.length)
    return count(activity.refused.length, 'file', 'files') + ' not sent'
  if (activity?.lastSync) return 'Synced ' + formatWhen(new Date(activity.lastSync).toISOString())
  return 'Not synced yet'
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
