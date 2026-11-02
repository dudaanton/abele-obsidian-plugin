import type { FileSystem, StateStore, SyncReport } from '@abele/sync-sdk/core'
import { AbeleError } from '@abele/sync-sdk/protocol'

const PREFIX = 'plugin:size-refusal:'
type Refusal = {
  context: string
  size: number
  mtime: number
  ctime?: number
  limit: number
  sha: string
}
/** A server size verdict is stable only for this exact source and policy. */
export class SizeRefusals {
  private keys?: Promise<Set<string>>
  private readonly saved = new Map<string, string | null>()
  constructor(
    private readonly state: StateStore,
    private readonly fs: FileSystem,
    private readonly context: () => string,
    private readonly limit: () => number | undefined
  ) {}
  private knownKeys() {
    return (this.keys ??= Promise.resolve(this.state.metadataKeys?.(PREFIX) ?? []).then(
      (keys) => new Set(keys)
    ))
  }
  async assertAllowed(
    path: string | undefined,
    identity: { sha: string; size: number },
    signal?: AbortSignal
  ): Promise<void> {
    signal?.throwIfAborted()
    if (
      !path ||
      (this.state.metadataKeys && !(await this.knownKeys()).has(PREFIX + encodeURIComponent(path)))
    )
      return
    const key = PREFIX + encodeURIComponent(path)
    let raw = this.saved.get(key)
    if (raw === undefined) {
      raw = await this.state.getMeta(key)
      this.saved.set(key, raw)
    }
    let row: Refusal
    try {
      row = JSON.parse(raw ?? 'null')
    } catch {
      return
    }
    if (
      !row ||
      row.context !== this.context() ||
      row.limit !== this.limit() ||
      row.size !== identity.size ||
      row.sha !== identity.sha ||
      !(row.size > row.limit)
    )
      return
    const current = await this.fs.stat(path)
    signal?.throwIfAborted()
    if (
      current &&
      current.size === row.size &&
      current.mtime === row.mtime &&
      current.ctime === row.ctime
    )
      throw new AbeleError('too_large', 'This file is too large for this server', {
        size: row.size,
        limit: row.limit,
      })
  }
  async record(row: SyncReport['push']['rejected'][number], state: StateStore): Promise<void> {
    const limit = this.limit()
    if (
      row.code !== 'too_large' ||
      !row.path ||
      limit === undefined ||
      !('sha' in row.op) ||
      !('size' in row.op) ||
      !('mtime' in row.op) ||
      !(row.op.size > limit)
    )
      return
    const current = await this.fs.stat(row.path)
    if (!current || current.size !== row.op.size || current.mtime !== row.op.mtime) return
    const key = PREFIX + encodeURIComponent(row.path),
      value = JSON.stringify({
        context: this.context(),
        size: current.size,
        mtime: current.mtime,
        ...(current.ctime === undefined ? {} : { ctime: current.ctime }),
        limit,
        sha: row.op.sha,
      } satisfies Refusal)
    if (this.saved.get(key) === value) return
    await state.setMeta(key, value)
    const publish = () => {
      this.saved.set(key, value)
      void this.knownKeys().then((keys) => keys.add(key))
    }
    if (state.afterCommit) state.afterCommit(publish)
    else publish()
  }
}
