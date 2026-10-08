import {
  checkExternalPhase,
  EXTERNAL_STATE_KEY,
  ExternalStateError,
  type ExternalPhaseBatch,
  type ExternalStatePort,
} from './state'

/** Both synchronous SQLite hosts can implement this port without a Node/CLI import in core. */
export interface ExternalSqliteDatabase {
  readonly inTransaction?: boolean
  readonly isTransaction?: boolean
  exec(sql: string): unknown
  prepare(sql: string): {
    get(...parameters: (string | number | null)[]): unknown
    run(...parameters: (string | number | null)[]): unknown
  }
}

/** Adapter for an already-open CLI ledger. Does not create a second database or head table. */
export class SqliteExternalStateStore implements ExternalStatePort {
  readonly externalDurability = 'durable' as const
  private unknownCommit = false
  private readonly key = `daemon:${EXTERNAL_STATE_KEY}`

  constructor(private readonly db: ExternalSqliteDatabase) {
    const main = db.prepare('PRAGMA database_list').get() as { file?: string } | undefined
    if (!main?.file || (db.inTransaction === undefined && db.isTransaction === undefined))
      throw new ExternalStateError('unsupported-storage')
  }

  private assertBoundary(): void {
    if (this.db.inTransaction || this.db.isTransaction)
      throw new ExternalStateError('nested-transaction')
  }

  private read(): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(this.key) as
      | { value: unknown }
      | undefined
    if (row && typeof row.value !== 'string') throw new ExternalStateError('recovery-required')
    return row ? (row.value as string) : null
  }

  async getExternalState(): Promise<string | null> {
    this.assertBoundary()
    return this.read()
  }

  async commitExternalPhase(batch: ExternalPhaseBatch): Promise<void> {
    if (this.unknownCommit) throw new ExternalStateError('recovery-required')
    this.assertBoundary()
    let began = false
    let committing = false
    try {
      this.db.exec('BEGIN IMMEDIATE')
      began = true
      const { ledger } = checkExternalPhase(batch, this.read())
      for (const path of ledger.deletePaths ?? [])
        this.db.prepare('DELETE FROM entries WHERE path = ?').run(path)
      for (const entry of ledger.putEntries ?? []) {
        this.db
          .prepare('DELETE FROM entries WHERE path <> ? AND (file_id = ? OR wire_path = ?)')
          .run(entry.path, entry.fileId, entry.wirePath)
        this.db
          .prepare(
            `INSERT INTO entries (path, wire_path, file_id, version_id, sha, size, mtime) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET wire_path = excluded.wire_path, file_id = excluded.file_id,
          version_id = excluded.version_id, sha = excluded.sha, size = excluded.size, mtime = excluded.mtime`
          )
          .run(
            entry.path,
            entry.wirePath,
            entry.fileId,
            entry.versionId,
            entry.sha,
            entry.size,
            entry.mtime
          )
      }
      if (ledger.cursor !== undefined) this.put('cursor', String(ledger.cursor))
      for (const item of ledger.metadata ?? []) {
        if (item.value === null)
          this.db.prepare('DELETE FROM meta WHERE key = ?').run(`daemon:${item.key}`)
        else this.put(`daemon:${item.key}`, item.value)
      }
      this.put(this.key, batch.next)
      committing = true
      this.db.exec('COMMIT')
    } catch (cause) {
      if (began) {
        try {
          this.db.exec('ROLLBACK')
        } catch {
          /* COMMIT may already have landed. */
        }
      }
      if (committing) {
        this.unknownCommit = true
        throw new ExternalStateError('commit-unknown', { cause })
      }
      if (cause instanceof ExternalStateError) throw cause
      throw new ExternalStateError('aborted', { cause })
    }
  }

  private put(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value)
  }
}
