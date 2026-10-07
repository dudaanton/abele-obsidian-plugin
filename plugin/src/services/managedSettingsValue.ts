import { settingsSnapshot } from './settingsEdits'

interface Snapshot {
  readonly value: unknown
}
const snapshot = (value: unknown): Snapshot => ({
  value: value === undefined ? undefined : settingsSnapshot(value),
})

/** Only unacknowledged local intent. SettingsKeeper serializes read, apply and write IO;
 * completed writes never pin a managed value over a subsequently read external file. */
export class ManagedSettingsValue {
  private pending: Snapshot | null = null

  reset(): void {
    this.pending = null
  }

  request(value: unknown): void {
    this.pending = snapshot(value)
  }

  protects(): boolean {
    return this.pending !== null
  }

  retain(): Snapshot | null {
    return this.pending ? snapshot(this.pending.value) : null
  }

  /** A save requested during IO must not be cleared by acknowledgment of an older save. */
  beginWrite(): () => void {
    const requested = this.pending
    return () => {
      if (this.pending === requested) this.pending = null
    }
  }
}
