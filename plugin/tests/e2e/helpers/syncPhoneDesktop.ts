import { createRequire } from 'node:module'
import { openReplica } from '../../../node_modules/@abele/sync-sdk/dist/node-replica.js'

type Database = { close(): void }
type DatabaseConstructor = new (path: string) => Database

/** Fail before the long phone scenario if the SDK's disk ledger cannot open. */
export function assertDesktopReplicaReady(
  load: () => DatabaseConstructor = () => createRequire(import.meta.url)('better-sqlite3')
): void {
  try {
    const db = new (load())(':memory:')
    db.close()
  } catch (cause) {
    throw new Error(
      'Desktop SDK replica requires the better-sqlite3 native binding; install dependencies with scripts enabled before the phone gate',
      { cause }
    )
  }
}

/** The large gate needs a lock lease long enough for the SDK's synchronous manifest work. */
export async function syncDesktopGateReplica(options: {
  key: string
  dir: string
  stateDir: string
  fetch: typeof fetch
}): Promise<void> {
  // The public open() API does not expose the Node replica's lock timing, and it
  // replaces a failed engine sync with a generic SyncError. Use the same SDK disk
  // replica directly so this gate retains the original cause on failure.
  const replica = await openReplica({
    ...options,
    lockTiming: { heartbeatMs: 1000, watchMs: 600_000 },
  })
  try {
    await replica.buildEngine({}).sync()
  } catch (cause) {
    throw new Error('Desktop SDK replica pull failed', { cause })
  } finally {
    replica.close()
  }
}
