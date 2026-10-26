import { englishSyncText, type SyncText } from './presentation'
import type { TokenConnectionRecord } from './tokenConnectionRegistry'
import {
  connectionStatusText,
  safetyStopReason,
  SCOPE_DELETED,
  type ConnectionActivity,
} from './tokenUi'
import { formatWhen } from './format'
import { transferText } from './transferProgress'
import { splitNotSynced } from './notSynced'

/**
 * What one connection row says, as a code and one line: a dot coloured by its state and the one
 * thing worth reading now. The window behind the row says the rest.
 */

export type ConnectionTone = 'green' | 'orange' | 'red' | 'accent' | 'faint'

type Row = Pick<TokenConnectionRecord, 'status' | 'paused' | 'rootIssue'>

const ATTENTION = ['error', 'needs-token', 'scope_unavailable', 'disconnected']

/** Something is moving: a first scan, a comparison, a push or a pull. */
export function connectionBusy(row: Row, activity?: ConnectionActivity): boolean {
  if (safetyStopReason(activity)) return false
  if (activity?.error === SCOPE_DELETED || row.paused || row.rootIssue) return false
  return (
    row.status === 'syncing' ||
    row.status === 'joining' ||
    row.status === 'scope_updating' ||
    !!activity?.startup ||
    !!activity?.inspection ||
    !!activity?.notSyncedLoading ||
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
  if (safetyStopReason(activity)) return 'red'
  if (row.rootIssue) return 'red'
  if (ATTENTION.includes(row.status) || activity?.startup?.outcome === 'failed') return 'red'
  if (row.paused || row.status === 'offline') return 'orange'
  if (connectionBusy(row, activity)) return 'accent'
  if (
    activity?.conflicts?.length ||
    activity?.refused?.length ||
    activity?.backgroundAttention ||
    activity?.sharedAttention ||
    activity?.notSynced?.length ||
    activity?.notSyncedError
  )
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
  const stopped = safetyStopReason(activity)
  if (stopped) return stopped
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
  if (activity?.sharedAttention) return activity.sharedAttention
  if (activity?.conflicts?.length)
    return text(
      '{count} conflict copies',
      { count: activity.conflicts.length },
      '{count} conflict copy'
    )
  const counts = notSyncedCounts(activity)
  const waiting = counts.waiting ? text('Waiting ({count})', { count: counts.waiting }) : ''
  const notSynced = () =>
    text('{count} files not synced', { count: counts.notSynced }, '{count} file not synced')
      .replace(String(counts.notSynced), counts.notSynced.toLocaleString())
      .concat(waiting ? ' · ' + waiting : '')
  if (counts.notSynced && counts.listed) return notSynced()
  if (activity?.notSyncedError) return text('Could not check which files are not synced')
  if (counts.notSynced) return notSynced()
  if (waiting) return waiting
  if (activity?.notSyncedLoading) return text('Checking the vault')
  if (activity?.lastSync)
    return text('Synced {when}', { when: when(new Date(activity.lastSync).toISOString()) })
  return text('Not synced yet')
}

/**
 * How many files a connection holds back, split by whether the person has to act: refusals are
 * «not synced», a file that only waits (a full server, a rate limit, no server) is «waiting».
 * The list is the count of refusals once it holds any; before that the live refusals stand in.
 */
export function notSyncedCounts(activity?: ConnectionActivity): {
  notSynced: number
  waiting: number
  listed: boolean
} {
  const { refused: listed, waiting: listedWaiting } = splitNotSynced(activity?.notSynced ?? [])
  const refused = new Set(
    listed.length
      ? listed.map((item) => item.path)
      : (activity?.refused ?? []).filter((row) => !row.waiting).map((row) => row.path)
  )
  const known = new Set(listedWaiting.map((item) => item.path))
  const live = new Set(
    (activity?.refused ?? [])
      .filter((row) => row.waiting && !refused.has(row.path) && !known.has(row.path))
      .map((row) => row.path)
  )
  // The list holds one row per path; its length is the count, as large lists are read.
  return {
    notSynced: listed.length || refused.size,
    waiting: listedWaiting.length + live.size,
    listed: listed.length > 0,
  }
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
