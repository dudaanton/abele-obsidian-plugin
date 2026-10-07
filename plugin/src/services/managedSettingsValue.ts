import { settingsSnapshot } from './settingsEdits'

interface Snapshot {
  readonly value: unknown
}
const snapshot = (value: unknown): Snapshot => ({
  value: value === undefined ? undefined : settingsSnapshot(value),
})

/** Atomic settings values: requests protect queued saves; acknowledged write identities fence
 * every read overlapping a successful save, regardless of when that save was requested. */
export class ManagedSettingsValue {
  private pending: Snapshot | null = null
  private written: Snapshot | null = null

  reset(): void {
    this.pending = null
    this.written = null
  }

  request(value: unknown): void {
    this.pending = snapshot(value)
  }

  /** Capture before native IO, never the identity of an unacknowledged request. */
  beginRead(): object | null {
    return this.written
  }

  protects(read: object | null): boolean {
    return this.pending !== null || (this.written !== null && this.written !== read)
  }

  retain(read: object | null): Snapshot | null {
    const value = this.pending ?? (this.written !== read ? this.written : null)
    return value ? snapshot(value.value) : null
  }

  /** Called before IO; invoke the receipt only after success (including an accepted no-op).
   * The file queue orders writes. A newer queued request cannot be cleared by this receipt. */
  beginWrite(value: unknown): () => void {
    const requested = this.pending
    const written = snapshot(value)
    let acknowledged = false
    return () => {
      if (acknowledged) return
      acknowledged = true
      this.written = written
      if (this.pending === requested) this.pending = null
    }
  }
}
