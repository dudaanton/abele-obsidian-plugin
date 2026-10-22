import type { AppliedChange } from '@abele/sync-sdk/core'
import { transferText, type TransferSnapshot } from './transferProgress'

/** Scheduling reasons belong in diagnostics, rather than displacing file activity. */
export function isSyncTriggerLine(line: string): boolean {
  return /^sync: (?:watch|fallback|events|retry|reconnect|start|keep local)$/.test(line)
}

/** Activity comes from acknowledged transfers and durable engine notifications. */
export function appliedActivity(change: AppliedChange): string {
  if (change.kind === 'delete')
    return `Deleted ${change.origin === 'local' ? 'remotely' : 'locally'} ${change.path}`
  if (change.kind === 'move')
    return `Moved ${change.origin === 'local' ? 'remotely' : 'locally'} ${change.from ?? 'unknown'} → ${change.path}`
  return `${change.origin === 'local' ? 'Uploaded' : 'Downloaded'} ${change.path}`
}

/** Aggregate messages are limited to five-percent advances or thirty-second intervals. */
export class SyncActivityLog {
  private last?: TransferSnapshot
  private at = 0
  private fraction = 0
  private announced = false
  private comparison?: TransferSnapshot
  private cancel?: () => void
  constructor(
    private readonly write: (line: string) => void,
    private readonly now = Date.now,
    private readonly schedule?: (work: () => void, delay: number) => () => void
  ) {}

  /** The SDK finished the local scan, including metadata/cache checks without content reads. */
  finishComparison(total = this.comparison?.total): void {
    const one = this.comparison
    if (!one) return
    // Counts cannot identify which confirmed paths survived an inventory change.
    // The SDK has confirmed the entire new inventory at this boundary.
    if (total !== one.total)
      this.update({ ...one, total, totalKnown: total !== undefined, completed: total ?? 0 })
    if (total)
      this.write(
        `Comparing files: ended · ${transferText({ ...one, total, totalKnown: true, completed: total })}`
      )
    this.comparison = undefined
    if (this.last?.stage === 'Comparing files') {
      this.cancel?.()
      this.cancel = undefined
      this.last = undefined
      this.announced = false
    }
  }

  update(value?: TransferSnapshot): void {
    this.cancel?.()
    this.cancel = undefined
    const restarted =
      value?.stage === 'Comparing files' &&
      this.comparison !== undefined &&
      value.total !== this.comparison.total
    if (value?.stage === 'Comparing files') {
      const completed = Math.max(
        0,
        value.completed,
        restarted ? 0 : (this.comparison?.completed ?? 0)
      )
      value = {
        ...value,
        completed: value.total === undefined ? completed : Math.min(completed, value.total),
      }
      this.comparison = { ...value }
    }
    const now = this.now()
    const changed = restarted || value?.stage !== this.last?.stage
    if (changed && this.last && this.announced)
      this.write(
        this.last.stage === 'Comparing files' ||
          (this.last.totalKnown && (this.last.total ?? 0) > this.last.completed)
          ? `${this.last.stage}: stopped at ${transferText(this.last).replace(this.last.stage + ' · ', '')} — continues`
          : `${this.last.stage}: ended · ${transferText(this.last)}`
      )
    if (!value) {
      this.last = undefined
      this.announced = false
      return
    }
    if (changed) {
      this.announced = false
      this.at = now
      this.fraction = 0
    }
    const hasWork =
      !!(value.completed || value.total || value.bytes) || value.stage === 'Committing changes'
    const fraction = value.totalKnown && value.total ? value.completed / value.total : 0
    const byteFraction = value.totalBytes ? (value.bytes ?? 0) / value.totalBytes : 0
    const advance = Math.max(fraction, byteFraction)
    const elapsed = now - this.at >= 30000
    if (
      (!this.announced && (restarted || hasWork || (elapsed && value.stage !== 'Downloading'))) ||
      (this.announced && (advance - this.fraction >= 0.05 - Number.EPSILON || elapsed))
    ) {
      this.write(
        !this.announced
          ? restarted
            ? `${value.stage}: started again (inventory changed)${value.total === 0 ? '' : ' · ' + transferText(value)}`
            : `${value.stage}: started · ${transferText(value)}`
          : transferText(value)
      )
      this.announced = true
      this.at = now
      this.fraction = advance
    }
    this.last = { ...value }
    if (value.stage !== 'Downloading' || hasWork)
      this.cancel = this.schedule?.(() => this.update(this.last), 30000 - (now - this.at))
  }
}
