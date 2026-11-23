import { asEngineError, lostTransaction } from './idbRequests'
import { verifyReopenedIdentity, StateRecoveryRequired, type DatabaseIdentity } from './idbIdentity'

/** Reconnect lifecycle, separated from the ledger overlay. A retry cannot establish identity. */
export class IndexedDbConnection {
  private closed = false
  private reopening: Promise<void> | null = null
  private needsReopen = false
  private failure: StateRecoveryRequired | null = null
  onRecoveryRequired: ((error: StateRecoveryRequired) => void) | null = null

  constructor(
    public db: IDBDatabase,
    private readonly connect: () => Promise<IDBDatabase>,
    private readonly identities: DatabaseIdentity[]
  ) {}
  get permitsEffects(): boolean {
    return !this.closed && !this.needsReopen && this.failure === null
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
    if (this.needsReopen && !this.closed) await this.recover()
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
        if (this.db === failedOn) {
          this.needsReopen = true
          await this.recover()
        } else await this.reopening
      } catch (cause) {
        console.debug('[abele-sync] the state database would not reopen', cause)
        if (cause instanceof StateRecoveryRequired) throw cause
        throw error
      }
      this.assertRecovery()
      return attempt()
    }
  }
  private recover(): Promise<void> {
    return (this.reopening ??= this.reopen().finally(() => {
      this.reopening = null
    }))
  }
  private async reopen(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.reopenOnce()
        return
      } catch (cause) {
        if (cause instanceof StateRecoveryRequired || !lostTransaction(cause) || attempt >= 2)
          throw cause
        console.debug('[abele-sync] retrying storage identity read after lost transaction', cause)
      }
    }
  }
  private async reopenOnce(): Promise<void> {
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
      this.needsReopen = false
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
      // Failure to read is not evidence of lost identity. Keep the connection
      // retryable; effects cannot pass once() until a fresh identity read succeeds.
      if (!(cause instanceof StateRecoveryRequired)) throw cause
      const failure = cause
      this.failure = failure
      this.closed = true
      this.onRecoveryRequired?.(failure)
      throw failure
    }
  }
}
