import { asEngineError, lostTransaction } from './idbRequests'
import { verifyReopenedIdentity, StateRecoveryRequired, type DatabaseIdentity } from './idbIdentity'

/** Reconnect lifecycle, separated from the ledger overlay. A retry cannot establish identity. */
export class IndexedDbConnection {
  private closed = false
  private reopening: Promise<void> | null = null
  private failure: StateRecoveryRequired | null = null
  onRecoveryRequired: ((error: StateRecoveryRequired) => void) | null = null

  constructor(
    public db: IDBDatabase,
    private readonly connect: () => Promise<IDBDatabase>,
    private readonly identities: DatabaseIdentity[]
  ) {}
  get permitsEffects(): boolean {
    return !this.closed && this.failure === null
  }
  assertRecovery(): void {
    if (this.failure) throw this.failure
  }
  close(): void {
    this.closed = true
    this.db.close()
  }
  begin(what: string, stores: string[], mode: IDBTransactionMode): IDBTransaction {
    this.assertRecovery()
    try {
      return this.db.transaction(stores, mode)
    } catch (cause) {
      throw asEngineError(what, cause)
    }
  }
  async once<T>(what: string, attempt: () => Promise<T>): Promise<T> {
    this.assertRecovery()
    const failedOn = this.db
    try {
      return await attempt()
    } catch (error) {
      if (this.closed || !lostTransaction(error)) throw error
      console.debug(
        `[abele-sync] ${what}: the state database lost its transaction; reopening`,
        error
      )
      try {
        if (this.db === failedOn)
          this.reopening ??= this.reopen().finally(() => {
            this.reopening = null
          })
        await this.reopening
      } catch (cause) {
        console.debug('[abele-sync] the state database would not reopen', cause)
        if (cause instanceof StateRecoveryRequired) throw cause
        throw error
      }
      this.assertRecovery()
      return attempt()
    }
  }
  private async reopen(): Promise<void> {
    const stale = this.db
    let fresh: IDBDatabase | null = null
    try {
      fresh = await this.connect()
      if (this.closed) {
        fresh.close()
        this.assertRecovery()
        return
      }
      await verifyReopenedIdentity(fresh, this.identities)
      // Strict actual database reads: no bootstrap, legacy upgrade or overlay acceptance.
      if (this.closed) {
        fresh.close()
        this.assertRecovery()
        return
      }
      this.db = fresh
      stale.onversionchange = null
      stale.close()
    } catch (cause) {
      fresh?.close()
      stale.onversionchange = null
      try {
        stale.close()
      } catch {
        /* already closed */
      }
      const failure =
        cause instanceof StateRecoveryRequired ? cause : new StateRecoveryRequired(cause)
      this.failure = failure
      this.closed = true
      this.onRecoveryRequired?.(failure)
      throw failure
    }
  }
}
