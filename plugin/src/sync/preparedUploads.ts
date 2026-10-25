import type { StateStore } from '@abele/sync-sdk/core'

export interface PreparedSource {
  path: string
  sha: string
  size: number
}
const PENDING = 'plugin:prepared-upload-sources'
const receiptKey = (sha: string) => 'plugin:prepared-upload:' + sha
// Leave a margin before the scoped server's 24-hour prepared-blob lifetime.
export const PREPARED_UPLOAD_LIFETIME = 23 * 60 * 60 * 1000

/** Acknowledged immutable uploads, never authority to install or overwrite local bytes. */
export class PreparedUploads {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly receipts = new Map<string, { context: string; at: number } | null>()
  constructor(
    private readonly state: StateStore,
    private readonly context: () => string,
    private readonly now = Date.now
  ) {}
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work)
    this.queue = next.catch(() => {})
    return next
  }
  async known(sha: string): Promise<boolean> {
    const key = this.context() + ':' + sha
    let receipt = this.receipts.get(key)
    if (receipt === undefined) {
      try {
        receipt = JSON.parse((await this.state.getMeta?.(receiptKey(sha))) ?? 'null')
      } catch {
        receipt = null
      }
      this.receipts.set(key, receipt ?? null)
    }
    const age = receipt ? this.now() - receipt.at : Infinity
    return (
      receipt?.context === this.context() &&
      Number.isFinite(age) &&
      age >= 0 &&
      age < PREPARED_UPLOAD_LIFETIME
    )
  }
  async preparedAt(sha: string): Promise<number | undefined> {
    if (!(await this.known(sha))) return undefined
    return this.receipts.get(this.context() + ':' + sha)?.at
  }
  async pending(): Promise<PreparedSource[]> {
    try {
      const saved = JSON.parse((await this.state.getMeta?.(PENDING)) ?? 'null')
      if (saved?.context !== this.context() || !Array.isArray(saved.rows) || saved.rows.length > 2)
        return []
      return saved.rows.filter(
        (row: PreparedSource) =>
          row &&
          typeof row.path === 'string' &&
          row.path.length <= 4096 &&
          /^[a-f0-9]{64}$/.test(row.sha) &&
          Number.isSafeInteger(row.size) &&
          row.size >= 0
      )
    } catch {
      return []
    }
  }
  begin(source: PreparedSource): Promise<void> {
    return this.serialize(async () => {
      const rows = (await this.pending()).filter((row) => row.sha !== source.sha)
      rows.push(source)
      await this.state.setMeta?.(
        PENDING,
        JSON.stringify({ context: this.context(), rows: rows.slice(-2) })
      )
    })
  }
  acknowledge(sha: string, at = this.now()): Promise<void> {
    return this.serialize(async () => {
      const receipt = { context: this.context(), at }
      await this.state.setMeta?.(receiptKey(sha), JSON.stringify(receipt))
      this.receipts.set(this.context() + ':' + sha, receipt)
      await this.forgetPending(sha)
    })
  }
  private async forgetPending(sha: string): Promise<void> {
    const rows = (await this.pending()).filter((row) => row.sha !== sha)
    await this.state.setMeta?.(
      PENDING,
      rows.length ? JSON.stringify({ context: this.context(), rows }) : null
    )
  }
  discard(sha: string): Promise<void> {
    return this.serialize(() => this.forgetPending(sha))
  }
  async spend(shas: readonly string[]): Promise<void> {
    // Retire before sending: a lost commit response may already have consumed the grant.
    await this.state.transaction(async (tx) => {
      for (const sha of shas) {
        await tx.setMeta?.(receiptKey(sha), null)
        this.receipts.delete(this.context() + ':' + sha)
      }
    })
  }
}
