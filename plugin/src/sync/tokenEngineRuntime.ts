import { nativeSyncFailure } from './mobileTransport'
import {
  SyncEngine,
  V2EngineClient,
  selectiveDefaults,
  scan,
  isExcluded,
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
  type PathMatcher,
} from '@abele/sync-core'
import { ExchangeTrace } from './exchangeTrace'
import { connectStage } from './tokenUi'
import {
  V2ManifestSchema,
  V2ChangesSchema,
  V2ConnectionSchema,
  ErrorCodeSchema,
  decodeAccessToken,
  normalisePath,
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
import { TokenActions } from './tokenActions'
import { TokenAssetOutbox, ASSET_IDENTITIES, assetIdentitiesSchema } from './tokenAssetOutbox'
import { PLACEMENT } from './pathCoordinator'

export interface TokenEngineOptions {
  id: string
  encoded: string
  fs: FileSystem
  state: StateStore
  reviews: DeviceReviews
  fetch: typeof fetch
  WebSocket?: typeof WebSocket
  paths?: ExecutablePaths
  ownSettingsPath?: string
  preparePlacement?(paths: readonly string[]): Promise<void>
  recoverPlacement?(): Promise<void>
  engineClient?(client: EngineClient): EngineClient
  engineState?: StateStore
  publicationChanged?(): void
  scopeInput?(selective: SelectiveSettings): Promise<{ key: string; ignore: PathMatcher }>
  paused?: boolean
  selective?: SelectiveSettings
  fallbackMs?: number
  assertHeld?(): void
  changed(status: EngineStatus, report?: SyncReport): void
  comparing?(progress?: { completed: number; total: number }): void
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
  readonly trace = new ExchangeTrace()
  readonly engine: SyncEngine
  readonly client: V2EngineClient
  readonly actions: TokenActions
  private readonly outbox: TokenAssetOutbox
  private active = true
  private readonly requests = new AbortController()
  private readonly transportObservers = new Set<(path: string, active: boolean) => void>()
  observeTransport(listener: (path: string, active: boolean) => void): () => void {
    this.transportObservers.add(listener)
    return () => {
      this.transportObservers.delete(listener)
    }
  }
  private observeRequest(path: string, active: boolean): void {
    for (const listener of this.transportObservers) {
      try {
        listener(path, active)
      } catch {
        /* Diagnostics cannot affect an exchange. */
      }
    }
  }
  private permitted = true
  private ignore: PathMatcher | null = null
  private authority: V2Connection | null = null
  private readonly compared = new Set<string>()
  private held = new Set<string>()
  private readonly manifestIds = new Set<string>()
  private readonly assetPaths = new Map<string, string>()
  private unstatus: () => void
  private readonly token
  private readonly selective: SelectiveSettings
  constructor(private readonly options: TokenEngineOptions) {
    this.selective = structuredClone(options.selective ?? selectiveDefaults())
    this.token = decodeAccessToken(options.encoded)
    const transport: typeof fetch = (input, init) =>
      this.trace.run(
        (init?.method ?? 'GET') +
          ' ' +
          new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
            .pathname,
        async () => {
          this.assertHeld()
          let response: Response
          const path = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          ).pathname
          this.observeRequest(path, true)
          const request = new AbortController()
          const abort = () => request.abort()
          const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
          for (const signal of [callerSignal, this.requests.signal]) {
            if (signal?.aborted) abort()
            else signal?.addEventListener('abort', abort, { once: true })
          }
          try {
            response = await options.fetch(input, { ...init, signal: request.signal })
          } catch (error) {
            const native = nativeSyncFailure(error)
            if (native) {
              this.trace.log(native.message)
            }
            throw error
          } finally {
            this.observeRequest(path, false)
            callerSignal?.removeEventListener('abort', abort)
            this.requests.signal.removeEventListener('abort', abort)
          }
          this.assertHeld()
          const url = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          )
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) this.permitted = false
            if (response.status >= 500) {
              // Read a clone so the protocol client can still decode classified refusals.
              const body = await response
                .clone()
                .json()
                .catch((): null => null)
              const code = ErrorCodeSchema.safeParse(body?.error?.code)
              if (
                !code.success ||
                code.data === 'internal' ||
                typeof body?.error?.message !== 'string'
              )
                throw new EngineError('offline', 'The sync server is temporarily unavailable')
            }
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
            if (!url.searchParams.get('next')) this.manifestIds.clear()
            for (const item of page.items) this.manifestIds.add(item.file_id)
            const incomingPaths: string[] = []
            for (const item of page.items)
              if ((await options.state.byFileId(item.file_id))?.versionId !== item.version_id)
                incomingPaths.push(item.path)
            await options.preparePlacement?.(incomingPaths)
            const items: V2ManifestItem[] = []
            for (const item of page.items)
              if (!(await this.reviewItem(item, null, page.cursor))) {
                await this.joinItem(item)
                items.push(item)
              }
            if (page.next === null) await this.reviewMissingExecutables()
            await this.refreshHolds()
            return Response.json({ ...page, items }, { headers: response.headers })
          } else if (url.pathname === '/v2/changes') {
            const page = V2ChangesSchema.parse(await response.json())
            const incomingPaths: string[] = []
            for (const one of page.items)
              if (
                one.type !== 'content' ||
                (await options.state.byFileId(one.item.file_id))?.versionId !== one.item.version_id
              )
                incomingPaths.push(
                  ...(one.type === 'content'
                    ? [one.item.path, ...(one.prev_path ? [one.prev_path] : [])]
                    : [one.path])
                )
            await options.preparePlacement?.(incomingPaths)
            const items: V2Change[] = []
            for (const event of page.items) {
              if (event.type !== 'content')
                for (const [path, id] of this.assetPaths)
                  if (id === event.file_id) this.assetPaths.delete(path)
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
      )
    this.client = new V2EngineClient(options.encoded, {
      fetch: transport,
      ...(options.WebSocket ? { WebSocket: options.WebSocket } : {}),
    })
    const prepare = this.client.prepare.bind(this.client)
    const includes = this.client.includes.bind(this.client)
    this.client.includes = (path) =>
      includes(path) || (this.active && this.permitted && this.assetPaths.has(normalisePath(path)))
    this.client.prepare = async (fs, state, excluded) => {
      this.compared.clear()
      await this.trace.run('write recovery before placement', async () =>
        options.recoverPlacement?.()
      )
      this.assetPaths.clear()
      if (options.scopeInput) {
        const input = await options.scopeInput(this.selective)
        this.assertHeld()
        const prior = await state.getMeta('scope')
        this.ignore = input.ignore
        if (prior !== input.key) {
          await state.setCursor(0)
          await state.setMeta('scope', input.key)
        }
      }
      const localExcluded = (path: string, size: number) => this.localExcluded(path, size)
      await prepare(
        new Proxy(fs, {
          get(target, name) {
            if (name === 'list')
              return async function* () {
                for await (const info of target.list())
                  if (!localExcluded(info.path, info.size)) yield info
              }
            const value = Reflect.get(target, name)
            return typeof value === 'function' ? value.bind(target) : value
          },
        }),
        state,
        excluded
      )
      if (this.token.scope.kind === 'group') {
        const identities = assetIdentitiesSchema.parse(
          JSON.parse((await options.state.getMeta(ASSET_IDENTITIES)) ?? '[]')
        )
        for (const identity of identities) {
          const local = await this.resolve(identity.id),
            entry = await options.state.byFileId(identity.fileId)
          if (
            local &&
            entry &&
            includes(entry.wirePath ?? entry.path) &&
            !configurationPath(local.path, options.paths)
          )
            this.assetPaths.set(normalisePath(local.path), identity.fileId)
        }
      }
    }
    this.client.onRemoval = (_id, path) => options.covers(path)
    this.engine = new SyncEngine({
      client: options.engineClient?.(this.client) ?? this.client,
      fs: new Proxy(options.fs, {
        get: (target, name) => {
          if (name === 'watch' && target.watch)
            return (notify: (paths: string[]) => void) =>
              target.watch((paths) => {
                // Polling settings and editor activity also reports ignored files.
                // They cannot change this connection's inventory; keep the ignore
                // control file itself observable so scope changes still take effect.
                const relevant = paths.filter(
                  (path) => path === '.abele-sync-ignore' || !this.ignore?.ignores(path)
                )
                if (relevant.length) notify(relevant)
              })
          if (name === 'writeAtomic')
            return async (path: string, bytes: Uint8Array, mtime: number) => {
              await target.writeAtomic(path, bytes, mtime)
              this.actions.written(path)
            }
          const value = Reflect.get(target, name)
          if ((name === 'list' || name === 'listDirectories') && typeof value === 'function') {
            const trace = this.trace
            return async function* () {
              const finish = trace.begin('fs ' + String(name))
              let completed = 0
              try {
                for await (const info of value.call(target)) {
                  completed++
                  yield info
                }
              } finally {
                trace.inventory(completed)
                finish(completed)
              }
            }
          }
          if (name === PLACEMENT && typeof value === 'function')
            return (paths: string[], work: () => Promise<unknown>) =>
              this.trace.run('placement ' + paths.join(', '), () => value.call(target, paths, work))
          if ((name === 'read' || name === 'stat') && typeof value === 'function')
            return (path: string) =>
              this.trace.run('fs ' + String(name) + ' ' + path, async () => {
                if (name === 'stat') return value.call(target, path)
                const total = this.trace.snapshot().firstSync.total
                if (this.compared.size === 0) options.comparing?.({ completed: 0, total })
                const bytes = await connectStage(
                  'Comparing files',
                  'Comparing a local file could not finish. Try syncing again.',
                  () => value.call(target, path)
                )
                this.compared.add(path)
                if (
                  this.compared.size <= 8 ||
                  this.compared.size % 128 === 0 ||
                  this.compared.size === total
                )
                  options.comparing?.({ completed: this.compared.size, total })
                return bytes
              })
          return typeof value === 'function' ? value.bind(target) : value
        },
      }),
      state: options.engineState ?? options.state,
      selective: this.selective,
      stillHeld: () => this.active,
      ignore: { ignores: (path) => this.blocked(path) },
      // Host transport durably stages every executable delivery before core receives the page.
      defer: (path) =>
        executablePath(path, false, options.paths) ||
        (configurationPath(path, options.paths) && path !== options.ownSettingsPath),
      ...(options.paths?.scriptsFolder ? { scriptsFolder: options.paths.scriptsFolder } : {}),
      ...(options.fallbackMs ? { fallbackMs: options.fallbackMs } : {}),
      onSync: (report) => {
        options.comparing?.()
        this.trace.finishFirstSync()
        options.changed(this.engine.status, report)
        void this.outbox.drain().catch(() => options.publicationChanged?.())
      },
      onFail: (error) => {
        options.comparing?.()
        options.failed(error)
      },
      log: (line) => this.trace.log(line),
    })
    this.unstatus = this.engine.onStatus((status) => options.changed(status))
    this.actions = new TokenActions(this.engine, options.state, this.client)
    this.outbox = new TokenAssetOutbox({
      state: options.state,
      binding: () => sourceIdentity(options.expectedSource ?? this.source()),
      assertOwned: () => this.assertHeld(),
      serial: (work) => this.engine.runExclusive(work),
      approved: async (id) => {
        const target = await this.resolve(id)
        return !!target && (await options.reviews.attachments.mayUpload(this.source(), target))
      },
      maxBytes: () => this.authority?.limits.max_file_bytes ?? 0,
      send: (one, bytes) =>
        this.client.publishGroupAsset(normalisePath(one.path), bytes, one.mtime, one.key),
      changed: () => options.publicationChanged?.(),
    })
    const commit = this.client.commitRaw.bind(this.client)
    this.client.commitRaw = async (ops, key) => {
      const outcome = await commit(ops, key)
      this.actions.recordDeleteResults(this.client, ops, outcome.body.results)
      return outcome
    }
    if (options.paused) this.engine.pause()
  }
  async updateSelective(selective: SelectiveSettings): Promise<void> {
    await this.engine.runExclusive(async () => {
      this.assertHeld()
      Object.assign(this.selective, structuredClone(selective))
    })
    if (this.engine.status.state !== 'paused') await this.engine.rescan()
  }
  written(path: string): void {
    this.actions.written(path)
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
      (this.ignore?.ignores(path) ?? false) ||
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
    const directory = item.kind === 'directory'
    const directories = directory
      ? (JSON.parse(
          (await this.options.state.getMeta('v2-directories')) ?? '{"directories":[]}'
        ) as { directories: { file_id: string; path: string }[] })
      : null
    const priorDirectory = directories?.directories.find(
      (one) => one.file_id === item.file_id
    )?.path
    const from =
      previous ??
      (directory
        ? priorDirectory !== item.path
          ? (priorDirectory ?? null)
          : null
        : baseline?.path !== item.path
          ? (baseline?.path ?? null)
          : null)
    // Creating a directory cannot activate code. Executable files are reviewed individually;
    // directory moves and departures still require review of their affected code paths.
    if (directory && from === null) return false
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
  /** A scope recheck walks the manifest at its current head, skipping older departures.
   * Review holds are temporary scope exclusions, so recover their real departure events
   * before core interprets an absent reviewed file as an edit to revive. Absence alone
   * is never deletion authority (including group loss and incomplete manifest pages). */
  private async reviewMissingExecutables(): Promise<void> {
    const latest = new Map<string, ExecutableCandidate>()
    for (const one of await this.options.reviews.executables.state())
      if (one.source.id === this.options.id) latest.set(one.fileId, one)
    const missing = [...latest.values()].filter(
      (one) =>
        !this.manifestIds.has(one.fileId) &&
        !['delete', 'delete_directory', 'removal'].includes(one.operation)
    )
    if (!missing.length) return
    let since = Infinity
    for (const one of missing) {
      const cursor = await this.options.state.getMeta('token-review-sequence:' + one.versionId)
      if (cursor === null) throw new EngineError('lost', 'Executable review cursor is missing')
      const value = Number(cursor)
      if (!Number.isSafeInteger(value) || value < 0)
        throw new EngineError('lost', 'Executable review cursor is invalid')
      since = Math.min(since, value)
    }
    const ids = new Set(missing.map((one) => one.fileId)),
      events = new Map<string, V2Change>()
    let next: string | null = null
    do {
      const url = new URL('/v2/changes', this.token.address)
      url.searchParams.set('since', String(since))
      if (next !== null) url.searchParams.set('next', next)
      const response = await this.trace.run('review departure recovery', () =>
        this.options.fetch(url, {
          headers: { authorization: 'Bearer ' + this.token.key },
          cache: 'no-store',
        })
      )
      this.assertHeld()
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.permitted = false
          throw new EngineError('unauthorized', 'Executable departure recovery access closed')
        }
        throw new EngineError('protocol', 'Executable departure recovery failed')
      }
      const page = V2ChangesSchema.parse(await response.json())
      for (const event of page.items) {
        const id = event.type === 'content' ? event.item.file_id : event.file_id
        if (ids.has(id)) events.set(id, event)
      }
      next = page.next
      if (next !== null && (!Number.isSafeInteger(Number(next)) || Number(next) <= since))
        throw new EngineError('protocol', 'Executable departure recovery did not advance')
      since = page.cursor
    } while (next !== null)
    for (const event of events.values())
      if (event.type !== 'content') await this.reviewDeparture(event)
  }
  private async joinItem(item: V2ManifestItem): Promise<void> {
    if (
      configurationPath(item.path, this.options.paths) &&
      item.path !== this.options.ownSettingsPath
    )
      return
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
  async pendingLocal(): Promise<number> {
    this.assertHeld()
    const result = await scan(this.options.fs, this.options.state, {
      excluded: (path, size) =>
        this.blocked(path) ||
        !this.client.includes(path) ||
        isExcluded(path, size, this.selective, this.options.paths?.scriptsFolder ?? 'Scripts'),
    })
    this.assertHeld()
    return result.ops.length
  }
  async start(): Promise<void> {
    await this.refreshHolds()
    this.assertHeld()
    await this.outbox.restore()
    this.engine.start()
  }
  async sync(retryHeld = true): Promise<void> {
    await this.refreshHolds()
    this.assertHeld()
    await this.engine.sync()
    await this.outbox.drain(retryHeld)
  }
  invalidate(): void {
    this.active = false
    this.requests.abort()
  }
  async close(): Promise<void> {
    this.invalidate()
    await this.engine.stop()
    await this.outbox.close()
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
  acceptsLocal(path: string, size: number): boolean {
    return this.covers(path) && !this.localExcluded(path, size)
  }
  private localExcluded(path: string, size: number): boolean {
    return (
      (this.ignore?.ignores(path) ?? false) ||
      (!this.isRoot() && configurationPath(path, this.options.paths)) ||
      isExcluded(path, size, this.selective, this.options.paths?.scriptsFolder ?? 'Scripts')
    )
  }
  async pathFor(fileId: string): Promise<string | null> {
    return (await this.options.state.byFileId(fileId))?.path ?? null
  }
  entryFor(path: string) {
    return this.options.state.get(path)
  }
  heldDeletes() {
    return this.engine.heldDeletes()
  }
  decideDeletes(kind: 'confirm' | 'restore', ids: readonly string[]) {
    return this.actions.decideDeletes(kind, ids)
  }
  deferred() {
    return this.engine.deferred()
  }
  applyDeferred(ids: readonly string[]) {
    return this.actions.applyDeferred(ids)
  }
  keepLocal(paths: string[] | undefined, ids: readonly string[]) {
    return this.engine.keepLocal(paths, ids)
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
    await this.options.preparePlacement?.([target.path])
    const capture = async () => {
      this.assertHeld()
      const current = await this.resolve(id),
        before = await this.options.fs.stat(target.path)
      if (!current || current.path !== target.path || !before)
        throw new Error('File is no longer available')
      const bytes = await this.options.fs.read(target.path),
        hash = await sha256(bytes),
        after = await this.options.fs.stat(target.path)
      if (
        !after ||
        before.size !== after.size ||
        before.mtime !== after.mtime ||
        bytes.length !== after.size ||
        (await sha256(await this.options.fs.read(target.path))) !== hash ||
        (await this.resolve(id))?.path !== target.path
      )
        throw new Error('File changed during publication capture; retry from the current file')
      this.assertHeld()
      return { id, path: target.path, bytes: bytes.slice(), sha: hash, mtime: before.mtime }
    }
    const placement = Reflect.get(this.options.fs, PLACEMENT) as
      | (<T>(paths: string[], work: () => Promise<T>) => Promise<T>)
      | undefined
    const copy = placement ? await placement([target.path], capture) : await capture()
    // Enqueue after releasing the path lease: core may itself be waiting for that lease.
    const key = await this.outbox.enqueue(copy)
    await this.outbox.drain(false, key)
    await this.engine.sync()
  }
  publications() {
    return this.outbox.state()
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
