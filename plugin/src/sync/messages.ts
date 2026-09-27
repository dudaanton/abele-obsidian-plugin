import type { SyncReport } from '@abele/sync-core'

/** What the sync log says about a failure and about a sync that got through. */

/** What a failure says. A thrown value that is neither an error nor text is shown as JSON. */
export const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? 'an unknown failure'
  } catch {
    return 'an unknown failure'
  }
}

/** What one sync did, in the line the log keeps — the same one the daemon writes. */
export function summarise(report: SyncReport): string {
  const pulled = report.pull.applied + (report.secondPull?.applied ?? 0)
  const held = (report.secondPull ?? report.pull).held.length
  return (
    `sync: done (pulled ${pulled}, pushed ${report.push.applied}, ` +
    `merged ${report.push.merged}, conflicts ${report.push.conflicts}, ` +
    `rejected ${report.push.rejected.length}, held ${held})`
  )
}
