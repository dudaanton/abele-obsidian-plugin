import {
  SyncEngine,
  V2EngineClient,
  selectiveDefaults,
  applyStaged,
  ExpectedWrites,
  EngineError,
  sha256,
  type FileSystem,
  type StateStore,
  type EngineClient,
  type SyncReport,
  type EngineStatus,
  type SelectiveSettings,
} from '@abele/sync-core'
import {
  V2ManifestSchema,
  V2ChangesSchema,
  V2ConnectionSchema,
  decodeAccessToken,
  type V2ManifestItem,
  type V2Change,
  type V2Connection,
  type ChangeItem,
} from '@abele/sync-protocol'
import type { ConnectionRuntime } from './connectionEngines'
import type { TokenUiRuntime, DeviceReviews } from './tokenUi'
import type { ExecutableCandidate } from './executableReview'
import { executablePath, configurationPath, type ExecutablePaths } from './stagedPluginCode'
import type { ReviewSource } from './reviewState'
import { sourceIdentity } from './reviewState'
import type { ConsentTarget } from './attachmentConsent'

export interface TokenEngineOptions {
  id: string
  encoded: string
  fs: FileSystem
  state: StateStore
  reviews: DeviceReviews
  fetch: typeof fetch
  WebSocket?: typeof WebSocket
  paths?: ExecutablePaths
  paused?: boolean
  selective?: SelectiveSettings
  fallbackMs?: number
  assertHeld?(): void
  changed(status: EngineStatus, report?: SyncReport): void
  failed(error: unknown): void
  covers(path: string): Promise<boolean>
  expectedSource?: ReviewSource
  localFiles?: {
    note(path: string): Promise<{ id: string; targets: ConsentTarget[] } | null>
    resolve(id: string): ConsentTarget | null
  }
}
/** Host wiring around the retained engine. All exchange and journaling belongs to core. */
export class TokenEngineRuntime implements ConnectionRuntime, TokenUiRuntime {
  readonly engine: SyncEngine
  readonly client: V2EngineClient
  private active = true
  private permitted = true
  private authority: V2Connection | null = null
  private held = new Set<string>()
  private unstatus: () => void
  private readonly token
  private readonly selective: SelectiveSettings
  constructor(private readonly options: TokenEngineOptions) {
    this.selective = structuredClone(options.selective ?? selectiveDefaults())
    this.token = decodeAccessToken(options.encoded)
    const transport: typeof fetch = async (input, init) => {
      this.assertHeld()
      const response = await options.fetch(input, init)
      this.assertHeld()
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      )
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) this.permitted = false
        return response
      }
      if (url.pathname === '/v2/connection') {
        this.authority = V2ConnectionSchema.parse(await response.clone().json())
        this.permitted = this.authority.status === 'active'
        if (
          this.authority.scope.kind !== this.token.scope.kind ||
          this.authority.scope.id !== this.token.scope.id
        )
          throw new EngineError('protocol', 'Token selector identity changed')
      } else if (url.pathname === '/v2/manifest') {
        const page = V2ManifestSchema.parse(await response.json())
        const items: V2ManifestItem[] = []
        for (const item of page.items)
          if (!(await this.reviewItem(item, null, page.cursor))) {
            await this.joinItem(item)
            items.push(item)
          }
        await this.refreshHolds()
        return Response.json({ ...page, items }, { headers: response.headers })
      } else if (url.pathname === '/v2/changes') {
        const page = V2ChangesSchema.parse(await response.json())
        const items: V2Change[] = []
        for (const event of page.items) {
          const reviewed =
            event.type === 'content'
              ? await this.reviewItem(event.item, event.prev_path, event.cursor)
              : await this.reviewDeparture(event)
          if (!reviewed) items.push(event)
        }
        await this.refreshHolds()
        return Response.json({ ...page, items }, { headers: response.headers })
      }
      return response
    }
    this.client = new V2EngineClient(options.encoded, {
      fetch: transport,
      ...(options.WebSocket ? { WebSocket: options.WebSocket } : {}),
    })
    this.client.onRemoval = (_id, path) => options.covers(path)
    this.engine = new SyncEngine({
      client: this.client,
      fs: options.fs,
      state: options.state,
      selective: this.selective,
      stillHeld: () => this.active,
      ignore: { ignores: (path) => this.blocked(path) },
      // Host transport durably stages every executable delivery before core receives the page.
      defer: (path) => executablePath(path, false, options.paths),
      ...(options.paths?.scriptsFolder ? { scriptsFolder: options.paths.scriptsFolder } : {}),
      ...(options.fallbackMs ? { fallbackMs: options.fallbackMs } : {}),
      onSync: (report) => options.changed(this.engine.status, report),
      onFail: (error) => options.failed(error),
    })
    this.unstatus = this.engine.onStatus((status) => options.changed(status))
    if (options.paused) this.engine.pause()
  }
  async updateSelective(selective: SelectiveSettings): Promise<void> {
    await this.engine.runExclusive(async () => {
      this.assertHeld()
      Object.assign(this.selective, structuredClone(selective))
    })
    if (this.engine.status.state !== 'paused') await this.engine.rescan()
  }
  private assertHeld(): void {
    if (!this.active) throw new EngineError('lost', 'Connection stopped')
    this.options.assertHeld?.()
  }
  private source(): ReviewSource {
    if (!this.authority) throw new EngineError('protocol', 'Connection authority is missing')
    return {
      id: this.options.id,
      address: this.token.address,
      spaceId: this.authority.space_id,
      tokenId: this.authority.token_id,
      scope: this.authority.scope,
    }
  }
  private blocked(path: string): boolean {
    return (
      (!this.isRoot() && configurationPath(path, this.options.paths)) ||
      [...this.held].some((held) => path === held || path.startsWith(held + '/'))
    )
  }
  private isRoot(): boolean {
    const scope = this.authority?.scope ?? this.token.scope
    return scope.kind === 'folder' && scope.path === '/'
  }
  private async refreshHolds(): Promise<void> {
    const latest = new Map<string, ExecutableCandidate>()
    for (const one of await this.options.reviews.executables.state())
      if (one.source.id === this.options.id) latest.set(one.fileId, one)
    this.held = new Set(
      [...latest.values()]
        .filter((one) => one.status !== 'approved')
        .flatMap((one) => [one.path, ...(one.previousPath ? [one.previousPath] : [])])
    )
  }
  private async reviewItem(
    item: V2ManifestItem,
    previous: string | null,
    cursor: number
  ): Promise<boolean> {
    if (!this.isRoot() && configurationPath(item.path, this.options.paths)) return true
    const baseline = await this.options.state.byFileId(item.file_id)
    if (
      baseline?.versionId === item.version_id &&
      item.kind !== 'directory' &&
      baseline.sha === item.sha &&
      baseline.wirePath === item.path
    )
      return false
    const from = previous ?? (baseline?.path !== item.path ? (baseline?.path ?? null) : null)
    const directory = item.kind === 'directory'
    if (
      item.kind !== 'script' &&
      ![item.path, from].some(
        (path) => path !== null && executablePath(path, directory, this.options.paths)
      )
    )
      return false
    const prior = (await this.options.reviews.executables.state()).find(
      (one) =>
        one.source.id === this.options.id &&
        one.fileId === item.file_id &&
        one.versionId === item.version_id &&
        one.path === item.path
    )
    if (
      prior &&
      (prior.mtime !== item.mtime ||
        prior.kind !== item.kind ||
        prior.sha !== (directory ? null : item.sha) ||
        (!directory && prior.bytes?.length !== item.size))
    )
      throw new EngineError('lost', 'Immutable executable delivery changed; recovery required')
    if (!prior) {
      const bytes = directory ? null : await this.client.versionBytes(item.file_id, item.version_id)
      this.assertHeld()
      await this.options.reviews.executables.stage({
        source: this.source(),
        fileId: item.file_id,
        versionId: item.version_id,
        path: item.path,
        previousPath: from,
        operation: directory
          ? from
            ? 'move_directory'
            : 'mkdir'
          : from
            ? 'move'
            : baseline
              ? 'modify'
              : 'create',
        directory,
        receivedAt: Date.now(),
        mtime: item.mtime,
        kind: item.kind,
        sha: directory ? null : item.sha,
        bytes,
      })
      await this.options.state.setMeta('token-review-sequence:' + item.version_id, String(cursor))
    }
    return true
  }
  private async reviewDeparture(event: Exclude<V2Change, { type: 'content' }>): Promise<boolean> {
    if (!this.isRoot() && configurationPath(event.path, this.options.paths)) return true
    let directory = false
    const directories = JSON.parse(
      (await this.options.state.getMeta('v2-directories')) ?? '{"directories":[]}'
    ) as { directories: { file_id: string }[] }
    directory = directories.directories.some((one) => one.file_id === event.file_id)
    directory ||= (await this.options.reviews.executables.state()).some(
      (one) => one.source.id === this.options.id && one.fileId === event.file_id && one.directory
    )
    if (!executablePath(event.path, directory, this.options.paths)) return false
    const version = event.type === 'removal' ? 'removal-' + event.cursor : event.version_id
    await this.options.reviews.executables.stage({
      source: this.source(),
      fileId: event.file_id,
      versionId: version,
      path: event.path,
      previousPath: null,
      operation: directory ? 'delete_directory' : event.type === 'removal' ? 'removal' : 'delete',
      directory,
      receivedAt: Date.now(),
      mtime: Date.parse(event.at),
      sha: null,
      bytes: null,
    })
    await this.options.state.setMeta('token-review-sequence:' + version, String(event.cursor))
    return true
  }
  private async joinItem(item: V2ManifestItem): Promise<void> {
    if (item.kind === 'directory' || (await this.options.state.get(item.path))) return
    const before = await this.options.fs.stat(item.path)
    if (!before) return
    const local = await this.options.fs.read(item.path),
      hash = await sha256(local)
    if (hash === item.sha) return
    const incoming = await this.client.versionBytes(item.file_id, item.version_id)
    if (incoming.length !== item.size || (await sha256(incoming)) !== item.sha)
      throw new EngineError('protocol', 'Incoming content integrity mismatch')
    const dot = item.path.lastIndexOf('.'),
      slash = item.path.lastIndexOf('/')
    const stem = dot > slash ? item.path.slice(0, dot) : item.path,
      ext = dot > slash ? item.path.slice(dot) : ''
    const copy =
      stem + ' (Conflicted copy local ' + before.mtime + ' ' + hash.slice(0, 12) + ')' + ext
    const work = async () => {
      this.assertHeld()
      if (await this.options.state.get(item.path)) return
      const current = await this.options.fs.stat(item.path)
      if (
        !current ||
        current.mtime !== before.mtime ||
        (await sha256(await this.options.fs.read(item.path))) !== hash
      )
        throw new EngineError('lost', 'Local file changed during first connection; retry required')
      await this.options.state.setMeta(
        'token-first-connection:' + item.file_id,
        JSON.stringify({
          path: item.path,
          copy,
          localSha: hash,
          remoteSha: item.sha,
          version: item.version_id,
        })
      )
      const exists = await this.options.fs.stat(copy)
      if (exists && (await sha256(await this.options.fs.read(copy))) !== hash)
        throw new EngineError('lost', 'Conflict copy path is occupied')
      if (!exists) await this.options.fs.writeAtomic(copy, local, before.mtime)
      this.assertHeld()
      if ((await sha256(await this.options.fs.read(item.path))) !== hash)
        throw new EngineError('lost', 'Local file changed; preserved conflict copy remains')
      await this.options.fs.writeAtomic(item.path, incoming, item.mtime)
    }
    const lease = (this.options.fs as FileSystem & { [key: symbol]: unknown })[
      Symbol.for('abele.sync.placement-v1')
    ] as ((paths: string[], work: () => Promise<void>) => Promise<void>) | undefined
    await (lease ? lease([item.path, copy], work) : work())
  }
  async start(): Promise<void> {
    await this.refreshHolds()
    this.assertHeld()
    this.engine.start()
  }
  async sync(): Promise<void> {
    await this.refreshHolds()
    this.assertHeld()
    await this.engine.sync()
    await this.publishPending()
  }
  invalidate(): void {
    this.active = false
  }
  async close(): Promise<void> {
    await this.engine.stop()
    this.unstatus()
  }
  async disconnect(): Promise<void> {
    this.invalidate()
    await this.close()
  }
  async pause(paused: boolean): Promise<void> {
    this.assertHeld()
    if (paused) this.engine.pause()
    else this.engine.resume()
  }
  async resolve(fileId: string): Promise<ConsentTarget | null> {
    return this.options.localFiles?.resolve(fileId) ?? null
  }
  covers(path: string): boolean {
    return (
      this.active &&
      this.permitted &&
      this.client.includes(path) &&
      !(!this.isRoot() && configurationPath(path, this.options.paths))
    )
  }
  async pathFor(fileId: string): Promise<string | null> {
    return (await this.options.state.byFileId(fileId))?.path ?? null
  }
  entryFor(path: string) {
    return this.options.state.get(path)
  }
  async opened(path: string): Promise<{ source: ReviewSource; noteId: string }[]> {
    this.assertHeld()
    if (this.token.scope.kind !== 'group' || !this.covers(path)) return []
    const entry = await this.options.state.get(path)
    if (!entry || !path.endsWith('.md')) return []
    const note = await this.options.localFiles?.note(path)
    if (!note) return []
    const source = this.source()
    for (const target of note.targets) {
      const received = await this.options.state.get(target.path)
      if (received && received.sha === (await sha256(await this.options.fs.read(target.path))))
        await this.options.reviews.attachments.recordReceived(source, target.id)
    }
    await this.options.reviews.attachments.observeNote(
      source,
      note.id,
      note.targets.map((one) => one.id)
    )
    return [{ source, noteId: note.id }]
  }
  async publishAttachment(id: string): Promise<void> {
    this.assertHeld()
    const target = await this.resolve(id)
    if (!target || !(await this.options.reviews.attachments.mayUpload(this.source(), target)))
      throw new Error('File publication is not approved')
    const info = await this.options.fs.stat(target.path)
    if (!info) throw new Error('File is no longer available')
    const bytes = await this.options.fs.read(target.path),
      hash = await sha256(bytes)
    const marker = 'token-asset-publication:' + id + ':' + hash + ':' + info.mtime
    const key = (await this.options.state.getMeta(marker)) ?? crypto.randomUUID()
    await this.options.state.setMeta(marker, key)
    const queue = JSON.parse((await this.options.state.getMeta('token-asset-outbox')) ?? '[]') as {
      id: string
      path: string
      bytes: number[]
      sha: string
      mtime: number
      key: string
    }[]
    if (!queue.some((one) => one.key === key)) {
      queue.push({ id, path: target.path, bytes: [...bytes], sha: hash, mtime: info.mtime, key })
      await this.options.state.setMeta('token-asset-outbox', JSON.stringify(queue))
    }
    await this.publishPending()
    await this.sync()
  }
  private async publishPending(): Promise<void> {
    const queue = JSON.parse((await this.options.state.getMeta('token-asset-outbox')) ?? '[]') as {
      id: string
      path: string
      bytes: number[]
      sha: string
      mtime: number
      key: string
    }[]
    for (const one of [...queue]) {
      const target = await this.resolve(one.id)
      if (!target || !(await this.options.reviews.attachments.mayUpload(this.source(), target)))
        throw new Error('Pending file publication requires its original local identity')
      const bytes = new Uint8Array(one.bytes)
      if ((await sha256(bytes)) !== one.sha)
        throw new EngineError('lost', 'Pending publication integrity mismatch')
      this.assertHeld()
      await this.client.publishGroupAsset(one.path, bytes, one.mtime, one.key)
      this.assertHeld()
      queue.splice(
        queue.findIndex((item) => item.key === one.key),
        1
      )
      await this.options.state.setMeta('token-asset-outbox', JSON.stringify(queue))
    }
  }
  async apply(candidate: ExecutableCandidate): Promise<void> {
    this.assertHeld()
    if (candidate.source.id !== this.options.id) throw new Error('Review connection changed')
    if (
      this.options.expectedSource &&
      sourceIdentity(candidate.source) !== sourceIdentity(this.options.expectedSource)
    )
      throw new Error('Review source binding changed')
    await this.engine.runExclusive(async () => {
      this.assertHeld()
      const key = 'token-reviewed-apply:' + candidate.id
      if (await this.options.state.getMeta(key)) return
      if (candidate.directory) {
        await this.applyDirectory(candidate)
      } else {
        const prior = await this.options.state.byFileId(candidate.fileId)
        if (prior?.versionId !== candidate.versionId) {
          const bytes = candidate.bytes === null ? null : Uint8Array.from(candidate.bytes)
          if (bytes && (await sha256(bytes)) !== candidate.sha)
            throw new Error('Reviewed content changed')
          const localClient = new Proxy(this.client, {
            get(target, name) {
              if (name === 'getBlob')
                return async (sha: string) => {
                  if (sha !== candidate.sha || !bytes)
                    throw new Error('Unreviewed content requested')
                  return bytes.slice()
                }
              const value = Reflect.get(target, name)
              return typeof value === 'function' ? value.bind(target) : value
            },
          }) as EngineClient
          const change: ChangeItem = {
            seq:
              Number(
                await this.options.state.getMeta('token-review-sequence:' + candidate.versionId)
              ) || 0,
            file_id: candidate.fileId,
            version_id: candidate.versionId,
            path: candidate.path,
            prev_path: candidate.previousPath,
            op:
              candidate.operation === 'delete' || candidate.operation === 'removal'
                ? 'delete'
                : candidate.previousPath
                  ? 'move'
                  : 'modify',
            kind: candidate.kind === 'directory' ? 'script' : (candidate.kind ?? 'script'),
            sha: candidate.sha,
            size: bytes?.length ?? null,
            mtime: bytes ? candidate.mtime : null,
            actor: { kind: 'key', id: candidate.source.tokenId, name: 'token connection' },
            at: new Date(candidate.receivedAt).toISOString(),
          }
          if (candidate.operation === 'removal' && (await this.options.covers(candidate.path))) {
            if (prior) await this.options.state.delete(prior.path)
          } else {
            const result = await applyStaged(
              localClient,
              this.options.fs,
              this.options.state,
              [change],
              {
                filter: { excluded: () => false },
                dirty: new Set(),
                expected: new ExpectedWrites(),
                preserveMissing: new Set(prior ? [prior.fileId] : []),
              }
            )
            if (result.held.length)
              throw new Error('The local file changed; this version remains pending')
          }
        }
      }
      await this.options.state.setMeta(key, candidate.versionId)
    })
    await this.refreshHolds()
  }
  private async applyDirectory(candidate: ExecutableCandidate): Promise<void> {
    const work = async () => {
      const local = new V2EngineClient(this.options.encoded, {
        fetch: async (input) => {
          const path = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          ).pathname
          if (path === '/v2/connection')
            return Response.json({
              protocol: 2,
              token_id: candidate.source.tokenId,
              space_id: candidate.source.spaceId,
              scope: candidate.source.scope,
              status: 'active',
              limits: { max_file_bytes: Number.MAX_SAFE_INTEGER, quota_bytes: null },
            })
          if (path === '/v2/manifest')
            return Response.json({
              cursor: 0,
              next: null,
              items: [
                {
                  file_id: candidate.fileId,
                  version_id: candidate.versionId,
                  kind: 'directory',
                  path: candidate.path,
                  mtime: candidate.mtime,
                },
              ],
            })
          if (path === '/v2/changes')
            return Response.json({
              cursor: 0,
              next: null,
              items: [
                {
                  type: 'delete',
                  cursor: 0,
                  file_id: candidate.fileId,
                  version_id: candidate.versionId,
                  path: candidate.path,
                  at: new Date(candidate.mtime).toISOString(),
                },
              ],
            })
          throw new Error('Approval cannot make a network request')
        },
      })
      await local.prepare(this.options.fs, this.options.state)
      if (candidate.operation === 'delete_directory') await local.changes(0)
      else await local.manifest(null)
      await local.finishPull()
    }
    await work()
  }
}
