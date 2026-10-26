import { EngineError, type StateStore } from '@abele/sync-sdk/core'
import { waitingCode, type NotSyncedItem, type NotSyncedKind } from './notSynced'
import { SyncTaskBudget, yieldSyncTask } from './syncTaskBudget'
import { STATE_PROJECTION_PASS, type StateProjectionPass } from './stateProjectionPass'

const SUMMARY = 'not-synced-v1'
const PREFIXES = ['file-retry:', 'pull-held:', 'pull-refused:', 'not-synced-outgoing:']
export const notSyncedMetadata = (key: string): boolean =>
  ['v2-directories', 'held-deletes', 'token-asset-outbox', 'not-synced-collisions'].includes(key) ||
  PREFIXES.some((prefix) => key.startsWith(prefix))
const serverCodes = new Set([
  'quota_exceeded',
  'quota_waiting',
  'forbidden',
  'unauthorized',
  'rate_limited',
  'scripts_forbidden',
  'settings_forbidden',
  'leaves_scope',
])
function kind(reason: string, local = false): NotSyncedKind {
  if (reason.startsWith('unsupported-host-name:')) return 'name'
  const code = reason.split(':', 1)[0]
  if (code === 'too_large') return 'too-large'
  if (local || !serverCodes.has(code)) return 'held'
  return waitingCode(code) ? 'waiting' : 'server'
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid not-synced metadata')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid held-file reason')
  return value
}

/** A durable metadata projection, refreshed on engine changes, never during rendering. */
export class NotSyncedState {
  private revision = 0
  private loaded = -1
  private rows: NotSyncedItem[] = []
  private running?: Promise<NotSyncedItem[]>
  private writes: Promise<void> = Promise.resolve()
  private outgoing = new Set<string>()
  collisions(rows: readonly { path: string; with: string }[]): void {
    this.writes = this.writes.then(async () => {
      await this.state.setMeta?.('not-synced-collisions', rows.length ? JSON.stringify(rows) : null)
      this.invalidate()
    })
    void this.writes.catch((error) =>
      console.debug('[abele-sync] cannot persist path collisions', error)
    )
  }
  recordRefusal(
    path: string,
    reason: string,
    expected?: { sha: string; size: number; mtime: number },
    scoped?: StateStore
  ): Promise<void> {
    const key = 'not-synced-outgoing:' + encodeURIComponent(path)
    const value = JSON.stringify({ path, reason, expected })
    if (scoped?.afterCommit && scoped.setMeta) {
      // A push verdict owns a scoped ledger capability. Persist with that verdict,
      // not through the independent root queue while its transaction is still open.
      const afterCommit = scoped.afterCommit.bind(scoped)
      return Promise.resolve(scoped.setMeta(key, value)).then(() => {
        afterCommit(() => {
          this.outgoing.add(path)
          this.invalidate()
        })
      })
    }
    this.outgoing.add(path)
    this.writes = this.writes.then(async () => {
      await this.state.setMeta?.(key, value)
      this.invalidate()
    })
    void this.writes.catch((error) =>
      console.debug('[abele-sync] cannot persist file refusal', error)
    )
    return this.writes
  }
  async resolved(path: string): Promise<void> {
    await this.writes
    // Applied callbacks can run inside an engine overlay. Resolve just this path there;
    // a cold projection would persist a summary and conflict with (or wait on) that overlay.
    if (this.loaded < 0 && !this.outgoing.has(path)) {
      if (!(await this.state.getMeta?.('not-synced-outgoing:' + encodeURIComponent(path)))) return
      this.outgoing.add(path)
    }
    if (!this.outgoing.has(path)) return
    await this.state.setMeta?.('not-synced-outgoing:' + encodeURIComponent(path), null)
    this.outgoing.delete(path)
    this.invalidate()
  }
  constructor(
    private readonly state: StateStore,
    private readonly stat?: (path: string) => Promise<{ size: number } | null>
  ) {}
  invalidate(): void {
    this.revision++
  }
  get dirty(): boolean {
    return this.loaded !== this.revision
  }
  snapshot(): Promise<NotSyncedItem[]> {
    if (this.loaded === this.revision) return Promise.resolve(this.rows)
    if (this.running !== undefined) return this.running
    this.running = (async () => {
      do {
        await this.writes
        const revision = this.revision
        this.rows = await this.read()
        this.loaded = revision
      } while (this.loaded !== this.revision)
      return this.rows
    })().finally(() => {
      this.running = undefined
    })
    return this.running
  }
  private async read(): Promise<NotSyncedItem[]> {
    // The projection also retires resolved evidence and persists dates. Serialize those
    // writes with engine overlays rather than invalidating their revision from a UI read.
    for (;;) {
      try {
        const pass = Reflect.get(this.state, STATE_PROJECTION_PASS) as
          | StateProjectionPass
          | undefined
        if (pass) return await pass.bind(this.state)(() => this.readState(this.state))
        return await this.state.transaction((state) => this.readState(state))
      } catch (error) {
        // Independent metadata writers can invalidate this derived projection. Retry its
        // rolled-back overlay, never a file operation or an externally visible effect.
        if (!(error instanceof EngineError) || error.code !== 'conflict') throw error
        await yieldSyncTask()
      }
    }
  }
  private async readState(state: StateStore): Promise<NotSyncedItem[]> {
    const saved = await state.getMeta?.(SUMMARY)
    const previous: NotSyncedItem[] = saved ? JSON.parse(saved) : []
    if (!Array.isArray(previous)) throw new Error('Invalid not-synced summary')
    const dates = new Map(previous.map((row) => [row.path, row.since]))
    const rows = new Map<string, NotSyncedItem>()
    const outgoing = new Set<string>()
    const now = new Date().toISOString()
    const budget = new SyncTaskBudget()
    const add = (path: unknown, reason: string, direction: 'in' | 'out', local = false) => {
      if (typeof path !== 'string') throw new Error('Invalid not-synced path')
      reason = reason.replace(/^invalid_path: (?=unsupported-host-name:)/, '')
      if (reason.includes('Waiting for the local upload quiet period')) return
      const next = {
        path,
        kind: kind(reason, local),
        direction,
        fact: reason.replace(/^[a-z_-]+: /, ''),
        since: dates.get(path) ?? now,
      }
      // Specific retry evidence replaces the generic incoming-hold explanation.
      if (!rows.has(path) || reason !== 'Held for safety') rows.set(path, next)
    }
    for (const prefix of PREFIXES) {
      for (const key of (await state.metadataKeys?.(prefix)) ?? []) {
        const raw = await state.getMeta?.(key)
        if (!raw) continue
        const row = object(JSON.parse(raw))
        if (prefix === 'not-synced-outgoing:' && row.expected) {
          const expected = object(row.expected)
          const entry = await state.get(text(row.path))
          if (
            entry &&
            entry.sha === expected.sha &&
            entry.size === expected.size &&
            entry.mtime === expected.mtime
          ) {
            await state.setMeta?.(key, null)
            await budget.account(8192)
            continue
          }
        }
        if (prefix === 'not-synced-outgoing:' && typeof row.path === 'string')
          outgoing.add(row.path)
        if (prefix === 'file-retry:' || prefix === 'not-synced-outgoing:') {
          if (typeof row.reason !== 'string') throw new Error('Invalid not-synced reason')
          let path = row.path
          const owner =
            typeof row.owner === 'string'
              ? row.owner
              : typeof path === 'string' && /^(push-receipt|pull-write|pull-evict):/.test(path)
                ? path
                : undefined
          if (row.phase === 'recovery' && owner && path === owner) {
            const raw = await state.getMeta?.(owner)
            if (!raw) {
              await budget.account(8192)
              continue
            }
            const intent = object(JSON.parse(raw))
            path =
              intent.wirePath ??
              intent.path ??
              intent.target ??
              (intent.base ? object(intent.base).wirePath : undefined)
          }
          add(
            path,
            row.reason,
            prefix === 'not-synced-outgoing:' ||
              row.phase === 'push' ||
              row.phase === 'scan' ||
              owner?.startsWith('push-receipt:')
              ? 'out'
              : 'in',
            row.local === true
          )
        } else {
          const change = object(row.change)
          add(
            change.path,
            typeof row.reason === 'string' ? row.reason : 'Held for safety',
            'in',
            true
          )
        }
        await budget.account(8192)
      }
    }
    const directoryRaw = await state.getMeta?.('v2-directories')
    if (directoryRaw) {
      const refused = object(JSON.parse(directoryRaw)).refused ?? []
      if (!Array.isArray(refused)) throw new Error('Invalid directory refusals')
      for (const value of refused) {
        const row = object(value)
        add(
          row.path,
          `${text(row.code)}: ${text(row.message)}`,
          row.direction === 'push' ? 'out' : 'in'
        )
        await budget.account(8192)
      }
    }
    for (const key of ['held-deletes', 'token-asset-outbox']) {
      const raw = await state.getMeta?.(key)
      if (!raw) continue
      const values: unknown = JSON.parse(raw)
      if (!Array.isArray(values)) throw new Error('Invalid held file metadata')
      for (const value of values) {
        const row = object(value)
        if (key === 'held-deletes') add(row.path, 'Deletion awaits your decision', 'out', true)
        else if (row.hold || row.uncertain) {
          const held = row.hold ? object(row.hold) : null
          add(
            row.path,
            held ? `${text(held.code)}: ${text(held.message)}` : text(row.uncertain),
            'out',
            !held
          )
        }
        await budget.account(8192)
      }
    }
    const collisions = await state.getMeta?.('not-synced-collisions')
    if (collisions) {
      const values: unknown = JSON.parse(collisions)
      if (!Array.isArray(values)) throw new Error('Invalid path collision metadata')
      for (const value of values) {
        const row = object(value)
        add(row.path, `Name collides with ${text(row.with)}`, 'out', true)
        await budget.account(8192)
      }
    }
    const result: NotSyncedItem[] = []
    for (const row of rows.values()) {
      if (
        row.kind !== 'too-large' ||
        row.direction !== 'out' ||
        !this.stat ||
        (await this.stat(row.path))
      )
        result.push(row)
      await budget.account(8192)
    }
    result.sort((a, b) => a.path.localeCompare(b.path))
    const serialized = JSON.stringify(result)
    if (serialized !== saved) await state.setMeta?.(SUMMARY, serialized)
    this.outgoing = outgoing
    return result
  }
}
