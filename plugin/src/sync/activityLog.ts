import type { AppliedChange } from '@abele/sync-sdk/core'
import { transferText, type TransferSnapshot } from './transferProgress'

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
  private cancel?: () => void
  constructor(
    private readonly write: (line: string) => void,
    private readonly now = Date.now,
    private readonly schedule?: (work: () => void, delay: number) => () => void
  ) {}

  update(value?: TransferSnapshot): void {
    this.cancel?.()
    this.cancel = undefined
    const now = this.now()
    const changed = value?.stage !== this.last?.stage
    if (changed && this.last) this.write(`${this.last.stage}: ended · ${transferText(this.last)}`)
    if (!value) {
      this.last = undefined
      return
    }
    const fraction = value.totalKnown && value.total ? value.completed / value.total : 0
    const byteFraction = value.totalBytes ? (value.bytes ?? 0) / value.totalBytes : 0
    const advance = Math.max(fraction, byteFraction)
    if (changed || advance - this.fraction >= 0.05 - Number.EPSILON || now - this.at >= 30000) {
      this.write(changed ? `${value.stage}: started · ${transferText(value)}` : transferText(value))
      this.at = now
      this.fraction = advance
    }
    this.last = { ...value }
    this.cancel = this.schedule?.(() => this.update(this.last), 30000 - (now - this.at))
  }
}
