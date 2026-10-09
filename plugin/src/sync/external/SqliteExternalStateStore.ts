/** Compatibility export only. The implementation lives in core; CLI delegates on its own
 * already-open connection. This file does not allocate another database or implement policy. */
export { SqliteExternalStateStore, type ExternalSqliteDatabase } from '@abele/sync-core'
