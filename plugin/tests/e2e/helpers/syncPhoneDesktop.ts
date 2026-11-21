import { createRequire } from 'node:module'

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
