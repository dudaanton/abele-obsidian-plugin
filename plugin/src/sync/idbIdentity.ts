import { EngineError } from '@abele/sync-core'
import { completion, wait } from './idbRequests'

const META = 'meta'
const DATABASE_IDENTITY = 'database-identity-v1'
export interface DatabaseIdentity {
  key: string
  value: string
}
export interface StateOpenOptions {
  /** Plugin meta key checked exactly on every reopen; never initialized by the retry path. */
  identity?: DatabaseIdentity
}
export class StateRecoveryRequired extends EngineError {
  constructor(cause?: unknown) {
    super(
      'io',
      'Sync recovery required: reopened storage lost or changed its identity; this engine is stopped before any retry',
      cause
    )
  }
}

/** Only initial open may add the generic store identity. Reopen always performs strict reads. */
export async function initializeDatabaseIdentity(db: IDBDatabase): Promise<DatabaseIdentity> {
  // One serialized transaction: simultaneous initial connections cannot mint different IDs.
  const tx = db.transaction([META], 'readwrite')
  const done = completion(tx, 'cannot establish the database identity')
  try {
    const row = await wait<{ value: unknown } | undefined>(
      tx.objectStore(META).get(DATABASE_IDENTITY)
    )
    let value: unknown = row?.value
    if (row === undefined) {
      value = crypto.randomUUID()
      await wait(tx.objectStore(META).put({ key: DATABASE_IDENTITY, value }))
    }
    if (typeof value !== 'string' || !value) throw new StateRecoveryRequired()
    await done
    return { key: DATABASE_IDENTITY, value }
  } catch (error) {
    void done.catch(() => {})
    try {
      tx.abort()
    } catch {
      /* already completed */
    }
    throw error
  }
}

/** Bypass overlays and once()/reopen(): only the actual fresh database can prove identity. */
export async function verifyReopenedIdentity(
  db: IDBDatabase,
  checks: DatabaseIdentity[]
): Promise<void> {
  try {
    const tx = db.transaction([META], 'readonly')
    for (const check of checks) {
      const row = await wait<{ value: unknown } | undefined>(tx.objectStore(META).get(check.key))
      if (row?.value !== check.value) throw new StateRecoveryRequired()
    }
  } catch (cause) {
    if (cause instanceof StateRecoveryRequired) throw cause
    throw new StateRecoveryRequired(cause)
  }
}
