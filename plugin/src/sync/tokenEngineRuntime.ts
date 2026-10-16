import { connectionPrivateRoot } from './connectionPaths'
import { assertPhysicalPath } from './external/projection'
import { scopedFileSystem, FolderScopeError } from './scopedFileSystem'
import { sha256 } from './external/hash'
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
  fingerprintFile,
  downloadToStage,
  TransferBudget,
  receiveToStage,
  type FileSystem,
  type ChunkSource,
  type StateStore,
  type EngineClient,
  type SyncReport,
  type EngineStatus,
  type SelectiveSettings,
  type PathMatcher,
} from '@abele/sync-core'
import { ExchangeTrace } from './exchangeTrace'
import { connectStage, connectionError } from './tokenUi'
import {
  V2ManifestSchema,
  V2ChangesSchema,
  V2ConnectionSchema,
  ErrorCodeSchema,
  decodeAccessToken,
  normalisePath,
  validatePath,
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
import { reviewFileSystem } from './reviewFileSystem'
import { TransferProgress, type TransferSnapshot } from './transferProgress'

export interface TokenEngineOptions {
  id: string
  localRoot?: string
  encoded: string
  fs: FileSystem
  state: StateStore
  reviews: DeviceReviews
  fetch: typeof fetch
  transferBudget?: TransferBudget
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
  pulling?(progress?: { stage: string; completed: number; total: number }): void
  progress?(progress?: TransferSnapshot): void
  event?(text: string): void
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
  private readonly transferBudget: TransferBudget
  private active = true
  private serverAvailable = true
  private readonly requests = new AbortController()
  private readonly transportObservers = new Set<
    (path: string, active: boolean, successful?: boolean, rangeOffset?: number) => void
  >()
  observeTransport(
    listener: (path: string, active: boolean, successful?: boolean, rangeOffset?: number) => void
  ): () => void {
    if (!this.active) return () => {}
    this.transportObservers.add(listener)
    return () => {
      this.transportObservers.delete(listener)
    }
  }
  private observeRequest(
    path: string,
    active: boolean,
    successful?: boolean,
    rangeOffset?: number
  ): void {
    for (const listener of this.transportObservers) {
      try {
        listener(path, active, successful, rangeOffset)
      } catch {
        /* Diagnostics cannot affect an exchange. */
      }
    }
  }
  private permitted = true
  private ignore: PathMatcher | null = null
  private authority: V2Connection | null = null
  private readonly compared = new Set<string>()
  private inventoryTotal = 0
  private comparisonPublished = 0
  private held = new Set<string>()
  private readonly manifestIds = new Set<string>()
  private readonly assetPaths = new Map<string, string>()
  private pulling = false
  private readonly pullPaths = new Set<string>()
  private readonly pulledPaths = new Set<string>()
  private readonly progress: TransferProgress
  private readonly folderProgress: TransferProgress
  private readonly pendingFolders = new Set<string>()
  private preparingFolders(paths: string[]): void {
    paths = paths.filter(
      (path) =>
        this.client.includes(path) &&
        !this.ignore?.ignores(path + '/') &&
        !this.selective.excludedFolders.some(
          (folder) => path === folder || path.startsWith(folder + '/')
        )
    )
    if (!paths.length) return
    this.pendingFolders.clear()
    this.folderProgress.begin('Preparing folders', false)
    for (const path of paths) {
      this.pendingFolders.add(path)
      this.folderProgress.add(path, 0)
    }
    this.folderProgress.inventoryComplete()
  }
  private folderPrepared(path: string): void {
    if (!this.pendingFolders.delete(path)) return
    this.folderProgress.done(path)
    if (!this.pendingFolders.size) {
      this.folderProgress.clear()
      this.progress.refresh()
    }
  }
  private readonly incomingNames = new Map<string, string>()
  private readonly receivedPaths = new Set<string>()
  private readonly uploadNames = new Map<string, string>()
  private pullProgress(stage = 'Receiving files'): void {
    if (this.pulling)
      this.options.pulling?.({
        stage,
        completed: this.pulledPaths.size,
        total: this.pullPaths.size,
      })
  }
  private pulled(path: string): void {
    const received = this.receivedPaths.has(path)
    if (!received) this.progress.reused(path)
    if (this.progress.done(path))
      this.options.event?.((received ? 'Downloaded ' : 'Matched local file ') + path)
    if (this.pulling && this.pullPaths.has(path)) {
      this.pulledPaths.add(path)
      this.pullProgress()
    }
  }
  private unstatus: () => void
  private readonly token
  private readonly selective: SelectiveSettings
  constructor(private readonly options: TokenEngineOptions) {
    this.progress = new TransferProgress(
      (one) => {
        if (!this.pendingFolders.size) options.progress?.(one)
      },
      Date.now,
      (work, delay) => {
        const timer = window.setTimeout(work, delay)
        return () => window.clearTimeout(timer)
      }
    )
    this.folderProgress = new TransferProgress(
      (one) => {
        if (one) options.progress?.(one)
      },
      Date.now,
      (work, delay) => {
        const timer = window.setTimeout(work, delay)
        return () => window.clearTimeout(timer)
      }
    )
    this.transferBudget = options.transferBudget ?? new TransferBudget()
    this.selective = structuredClone(options.selective ?? selectiveDefaults())
    this.token = decodeAccessToken(options.encoded)
    if (this.token.scope.kind === 'folder' && (options.localRoot ?? this.token.scope.path) !== '/')
      options.fs = scopedFileSystem(
        options.fs,
        (path) => this.assertLocalPaths([path]),
        (path) => !this.outsideScope(path),
        connectionPrivateRoot(options.id)
      )
    const transport: typeof fetch = (input, init) =>
      this.trace.run(
        (init?.method ?? 'GET') +
          ' ' +
          new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
            .pathname,
        async () => {
          this.assertHeld()
          let response: Response
          let successful = false
          const path = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          ).pathname
          if (
            (path === '/v2/commit' ||
              path === '/v2/group-assets' ||
              path.endsWith('/external/verify')) &&
            typeof init?.body === 'string'
          )
            this.assertScopedPayload(JSON.parse(init.body))
          const range = /^bytes=(\d+)-\d+$/.exec(new Headers(init?.headers).get('range') ?? '')
          const rangeOffset = range ? Number(range[1]) : undefined
          this.observeRequest(path, true, undefined, rangeOffset)
          const request = new AbortController()
          const abort = () => request.abort()
          const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
          for (const signal of [callerSignal, this.requests.signal]) {
            if (signal?.aborted) abort()
            else signal?.addEventListener('abort', abort, { once: true })
          }
          try {
            response = await options.fetch(input, { ...init, signal: request.signal })
            successful = response.ok
          } catch (error) {
            const native = nativeSyncFailure(error)
            if (native) {
              this.trace.log(native.message)
            }
            throw error
          } finally {
            this.observeRequest(path, false, successful, rangeOffset)
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
          if (url.pathname.startsWith('/v2/uploads/') && init?.method === 'PUT') {
            const body = init.body
            const size = ArrayBuffer.isView(body)
              ? body.byteLength
              : body instanceof ArrayBuffer
                ? body.byteLength
                : 0
            this.progress.bytes(url.pathname, 0, size)
          }
          if (url.pathname === '/v2/connection') {
            this.authority = V2ConnectionSchema.parse(await response.clone().json())
            this.permitted = this.authority.status === 'active'
            if (
              this.authority.scope.kind !== this.token.scope.kind ||
              this.authority.scope.id !== this.token.scope.id
            )
              throw new EngineError('protocol', 'Token selector identity changed')
            if (
              this.token.scope.kind === 'folder' &&
              this.permitted &&
              this.authority.scope.path !== (options.localRoot ?? this.token.scope.path)
            ) {
              this.engine?.pause()
              throw new FolderScopeError(
                'The shared folder was renamed on the server (' +
                  (options.localRoot ?? this.token.scope.path) +
                  ' → ' +
                  this.authority.scope.path +
                  '); sync stopped. Local files were kept.'
              )
            }
          } else if (url.pathname === '/v2/manifest') {
            const page = V2ManifestSchema.parse(await response.json())
            this.assertScopedPayload(page)
            if (this.pulling) {
              for (const item of page.items) this.pullPaths.add(item.path)
              this.pullProgress('Receiving files')
            }
            if (!url.searchParams.get('next')) this.manifestIds.clear()
            for (const item of page.items) this.manifestIds.add(item.file_id)
            const incomingPaths: string[] = []
            for (const item of page.items)
              if ((await options.state.byFileId(item.file_id))?.versionId !== item.version_id)
                incomingPaths.push(item.path)
            const incoming = new Set(incomingPaths)
            for (const item of page.items)
              if (
                item.kind !== 'directory' &&
                incoming.has(item.path) &&
                !this.localExcluded(item.path, item.size)
              ) {
                this.incomingNames.set(item.file_id, item.path)
                this.progress.add(item.path, item.size)
              }
            this.progress.inventoryComplete(page.next === null)
            this.preparingFolders(
              page.items.filter((item) => item.kind === 'directory').map((item) => item.path)
            )
            if (incomingPaths.length) await options.preparePlacement?.(incomingPaths)
            const items: V2ManifestItem[] = []
            for (const item of page.items)
              if (!(await this.reviewItem(item, null, page.cursor))) {
                await this.joinItem(item)
                items.push(item)
                if (!incoming.has(item.path)) this.pulled(item.path)
              } else {
                if (item.kind === 'directory') this.folderPrepared(item.path)
                this.progress.done(item.path)
                if (this.pulling) {
                  this.pulledPaths.add(item.path)
                  this.pullProgress()
                }
                options.event?.('Received for review ' + item.path)
              }
            if (page.next === null) await this.reviewMissingExecutables()
            await this.refreshHolds()
            return Response.json({ ...page, items }, { headers: response.headers })
          } else if (url.pathname === '/v2/changes') {
            const page = V2ChangesSchema.parse(await response.json())
            this.assertScopedPayload(page)
            if (this.progress.stage !== 'Downloading') this.progress.begin('Downloading')
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
            const incoming = new Set(incomingPaths)
            for (const event of page.items)
              if (
                event.type === 'content' &&
                event.item.kind !== 'directory' &&
                incoming.has(event.item.path) &&
                !this.localExcluded(event.item.path, event.item.size)
              ) {
                this.incomingNames.set(event.item.file_id, event.item.path)
                this.progress.add(event.item.path, event.item.size)
              }
            this.progress.inventoryComplete(page.next === null)
            this.preparingFolders(
              page.items.flatMap((event) =>
                event.type === 'content' && event.item.kind === 'directory' ? [event.item.path] : []
              )
            )
            if (incomingPaths.length) await options.preparePlacement?.(incomingPaths)
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
              else if (event.type === 'content') {
                if (event.item.kind === 'directory') this.folderPrepared(event.item.path)
                this.progress.done(event.item.path)
                options.event?.('Received for review ' + event.item.path)
              }
            }
            await this.refreshHolds()
            return Response.json({ ...page, items }, { headers: response.headers })
          }
          if (
            url.pathname === '/v2/commit' ||
            url.pathname === '/v2/group-assets' ||
            url.pathname === '/v2/trash' ||
            url.pathname === '/v2/trash/restore' ||
            /^\/v2\/files\/[^/]+\/(history|head|restore|external\/verify)$/.test(url.pathname)
          )
            this.assertScopedPayload(await response.clone().json())
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
      includes(path) || (this.active && this.permitted && this.assetPaths.has(path))
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
      this.pulling = (await state.getCursor()) === 0
      this.folderProgress.clear()
      this.pendingFolders.clear()
      this.progress.begin('Downloading')
      this.incomingNames.clear()
      this.receivedPaths.clear()
      this.uploadNames.clear()
      this.pullPaths.clear()
      this.pulledPaths.clear()
      this.pullProgress('Reading server inventory')
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
            this.assetPaths.set(local.path, identity.fileId)
        }
      }
    }
    this.client.onRemoval = (_id, path) => options.covers(path)
    const openVersion = this.client.openVersion.bind(this.client)
    this.client.openVersion = async (fileId, versionId, expected, signal) => {
      const path = this.incomingNames.get(fileId) ?? (await options.state.byFileId(fileId))?.path
      if (path) this.progress.current(path)
      const source = await openVersion(fileId, versionId, expected, signal)
      return new Proxy(source, {
        get: (target, key) => {
          if (key === 'read')
            return async (offset: number, length: number, signal?: AbortSignal) => {
              const bytes = await target.read(offset, length, signal)
              if (path) this.receivedPaths.add(path)
              this.progress.bytes(fileId + ':' + versionId, offset, bytes.length)
              return bytes
            }
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }
    const versionBytes = this.client.versionBytes.bind(this.client)
    this.client.versionBytes = async (fileId, versionId) => {
      const path = this.incomingNames.get(fileId)
      if (path) this.progress.current(path)
      const bytes = await versionBytes(fileId, versionId)
      if (path) this.receivedPaths.add(path)
      this.progress.bytes(fileId + ':' + versionId, 0, bytes.length)
      return bytes
    }
    const finishPull = this.client.finishPull.bind(this.client)
    this.client.finishPull = async () => {
      await finishPull()
      this.progress.clear()
      options.comparing?.()
    }
    const putBlob = this.client.putBlob.bind(this.client)
    this.client.putBlob = async (sha, bytes) => {
      if (this.progress.stage !== 'Uploading') this.progress.begin('Uploading')
      const path = this.uploadNames.get(sha)
      if (path) this.progress.current(path)
      await putBlob(sha, bytes)
    }
    const putBlobSource = this.client.putBlobSource.bind(this.client)
    this.client.putBlobSource = async (...args) => {
      if (this.progress.stage !== 'Uploading') this.progress.begin('Uploading')
      const path = this.uploadNames.get(args[0].sha)
      if (path) this.progress.current(path)
      await putBlobSource(...args)
    }
    let pushTotal = 0
    const uploadOps = new Map<string, number>()
    const uploadHashes = new Set<string>()
    const progressState = new Proxy(options.engineState ?? options.state, {
      get: (target, name) => {
        if (name === 'put')
          return async (entry: Parameters<StateStore['put']>[0]) => {
            await target.put(entry)
            if (this.progress.stage === 'Downloading') this.pulled(entry.path)
          }
        if (name === 'setJournal')
          return async (journal: Awaited<ReturnType<StateStore['getJournal']>>) => {
            await target.setJournal(journal)
            if (!journal) return
            if (this.progress.stage !== 'Uploading') {
              this.progress.begin('Uploading')
              uploadOps.clear()
              uploadHashes.clear()
              pushTotal = Math.max(this.engine.status.pending, journal.ops.length)
            }
            for (const [index, op] of journal.ops.entries()) {
              const path =
                'path' in op
                  ? op.path
                  : 'to_path' in op
                    ? op.to_path
                    : await this.pathFor(op.file_id)
              if (path) this.progress.current(path)
              if (path && 'sha' in op) this.uploadNames.set(op.sha, path)
              const id = journal.idempotencyKey + ':' + index
              if (!uploadOps.has(id)) {
                const size = 'sha' in op && !uploadHashes.has(op.sha) && 'size' in op ? op.size : 0
                if ('sha' in op) uploadHashes.add(op.sha)
                uploadOps.set(id, size)
                this.progress.add(id, uploadOps.get(id))
              }
            }
            if (uploadOps.size >= pushTotal) this.progress.inventoryComplete()
            this.progress.counts(Math.max(0, pushTotal - this.engine.status.pending), pushTotal)
          }
        const value = Reflect.get(target, name)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    this.engine = new SyncEngine({
      transferBudget: this.transferBudget,
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
              this.pulled(path)
            }
          if (name === 'mkdir' && target.mkdir)
            return async (path: string) => {
              await this.trace.run('mkdir ' + path, () => target.mkdir(path), true)
              this.folderPrepared(path)
              this.pulled(path)
            }
          if (name === 'beginAtomicWrite' && target.beginAtomicWrite)
            return async (...args: Parameters<NonNullable<FileSystem['beginAtomicWrite']>>) => {
              const stage = await target.beginAtomicWrite(...args)
              const written = () => {
                this.actions.written(args[0])
                this.pulled(args[0])
              }
              return new Proxy(stage, {
                get(target, key) {
                  if (key === 'commit')
                    return async (signal?: AbortSignal) => {
                      await target.commit(signal)
                      written()
                    }
                  const value = Reflect.get(target, key)
                  return typeof value === 'function' ? value.bind(target) : value
                },
              })
            }
          const value = Reflect.get(target, name)
          if (
            name === Symbol.for('abele.sync.directory-identity-v1') &&
            typeof value === 'function'
          )
            return (path: string) =>
              this.trace.run('directory identity ' + path, () => value.call(target, path), true)
          if ((name === 'list' || name === 'listDirectories') && typeof value === 'function') {
            const trace = this.trace
            const inventoried = (completed: number) => {
              if (name === 'list') this.inventoryTotal = completed
            }
            return async function* () {
              const finish = trace.begin('fs ' + String(name))
              let completed = 0
              try {
                for await (const info of value.call(target)) {
                  completed++
                  yield info
                }
              } finally {
                inventoried(completed)
                trace.inventory(completed)
                finish(completed)
              }
            }
          }
          if (name === PLACEMENT && typeof value === 'function')
            return (
              paths: string[],
              work: () => Promise<unknown>,
              preserve: boolean | readonly string[] = true
            ) =>
              this.trace.run('placement ' + paths.join(', '), () =>
                value.call(target, paths, work, preserve)
              )
          if (
            (name === 'read' || name === 'stat' || name === 'fingerprint') &&
            typeof value === 'function'
          )
            return (path: string) =>
              this.trace.run('fs ' + String(name) + ' ' + path, async () => {
                if (name === 'stat') return value.call(target, path)
                const total = this.inventoryTotal
                if (this.compared.size === 0) options.comparing?.({ completed: 0, total })
                const bytes =
                  name === 'fingerprint'
                    ? await value.call(target, path)
                    : await connectStage(
                        'Comparing files',
                        'Comparing a local file could not finish. Try syncing again.',
                        () => value.call(target, path)
                      )
                this.compared.add(path)
                if (Date.now() - this.comparisonPublished >= 250 || this.compared.size === total) {
                  this.comparisonPublished = Date.now()
                  options.comparing?.({ completed: this.compared.size, total })
                }
                return bytes
              })
          return typeof value === 'function' ? value.bind(target) : value
        },
      }),
      state: progressState,
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
        this.serverAvailable = true
        this.pendingFolders.clear()
        this.folderProgress.clear()
        this.progress.clear()
        this.pulling = false
        options.pulling?.()
        options.comparing?.()
        this.trace.finishFirstSync()
        options.changed(this.engine.status, report)
        void this.outbox.drain().catch(() => options.publicationChanged?.())
      },
      onFail: (error) => {
        this.pendingFolders.clear()
        this.folderProgress.clear()
        options.event?.('Error: ' + connectionError(error))
        this.progress.clear()
        this.pulling = false
        options.pulling?.()
        options.comparing?.()
        options.failed(error)
      },
      log: (line) => {
        this.trace.log(line)
        options.event?.(line)
      },
    })
    this.unstatus = this.engine.onStatus((status) => {
      if (status.state === 'offline') this.serverAvailable = false
      if (status.state === 'syncing' && this.progress.stage === 'Uploading') {
        pushTotal = Math.max(pushTotal, status.pending)
        this.progress.counts(pushTotal - status.pending, pushTotal)
      }
      options.changed(status)
    })
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
        bytes.length <= this.transferBudget.maxChunkBytes
          ? this.client.publishGroupAsset(normalisePath(one.path), bytes, one.mtime, one.key)
          : this.publishAssetSource(one, {
              size: bytes.length,
              read: async (offset, length) => bytes.slice(offset, offset + length),
              assertUnchanged: async () => {},
              close: async () => {},
            }),
      openSource: (id) => {
        if (!options.fs.openRead) throw new Error('Publication source is unavailable')
        return options.fs.openRead(id)
      },
      sendSource: (one, source) => this.publishAssetSource(one, source),
      discardSource: async (id) => {
        if (!options.fs.reopenStage) throw new Error('Publication stage cleanup is unavailable')
        await (await options.fs.reopenStage(id)).discard()
      },
      changed: () => options.publicationChanged?.(),
    })
    const commit = this.client.commitRaw.bind(this.client)
    this.client.commitRaw = async (ops, key) => {
      const outcome = await commit(ops, key)
      for (const [index, result] of outcome.body.results.entries()) {
        const op = ops[index]
        const path =
          'path' in op ? op.path : 'to_path' in op ? op.to_path : await this.pathFor(op.file_id)
        if (path) {
          this.progress.current(path)
          options.event?.(
            result.status === 'rejected'
              ? 'Not sent ' + path + ': ' + result.code
              : 'Uploaded ' + path
          )
        }
      }
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
  private publishAssetSource(
    one: { path: string; sha: string; mtime: number; key: string },
    source: ChunkSource
  ): Promise<unknown> {
    return this.transferBudget.run(async () => {
      const expected = { sha: one.sha, size: source.size }
      await this.client.putBlobSource(
        expected,
        source,
        this.requests.signal,
        this.transferBudget.maxChunkBytes
      )
      this.assertHeld()
      const response = await this.options.fetch(new URL('/v2/group-assets', this.token.address), {
        method: 'POST',
        signal: this.requests.signal,
        cache: 'no-store',
        headers: {
          authorization: 'Bearer ' + this.token.key,
          'content-type': 'application/json',
          'idempotency-key': one.key,
        },
        body: JSON.stringify({ path: normalisePath(one.path), ...expected, mtime: one.mtime }),
      })
      this.assertHeld()
      if (!response.ok)
        throw new EngineError('protocol', 'File publication response is unavailable')
      const result: unknown = await response.json()
      this.assertScopedPayload(result)
      return result
    }, this.requests.signal)
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
  private outsideScope(path: string): boolean {
    const root = this.options.localRoot ?? this.token.scope.path
    return (
      this.token.scope.kind === 'folder' &&
      root !== '/' &&
      path !== root &&
      !path.startsWith(root + '/')
    )
  }
  /** Host identity resolution and rooted inventory supply physical spelling, never a wire alias. */
  private assertLocalPaths(paths: readonly string[]): void {
    for (const path of paths) {
      try {
        assertPhysicalPath(path)
        // Compare the exact physical root bytes; Unicode normalization grants no access.
        if (!this.outsideScope(path)) continue
      } catch {
        /* Malformed physical paths cannot reach filesystem operations. */
      }
      this.engine?.pause()
      throw new FolderScopeError('The local file is outside this connection; sync stopped: ' + path)
    }
  }
  private assertIncomingPaths(paths: readonly string[]): void {
    for (const path of paths) {
      try {
        validatePath(path)
        if (!this.outsideScope(path)) continue
      } catch {
        /* Refuse aliases and traversal. */
      }
      this.engine?.pause()
      throw new FolderScopeError(
        'The server returned a path outside this connection; sync stopped: ' + path
      )
    }
  }
  private assertScopedPayload(value: unknown): void {
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      if (
        ['path', 'to_path', 'prev_path', 'conflict_path', 'previousPath'].includes(key) &&
        typeof item === 'string'
      )
        this.assertIncomingPaths([item])
      else this.assertScopedPayload(item)
    }
  }
  private blocked(path: string): boolean {
    return (
      this.outsideScope(path.replace(/\/$/, '')) ||
      (this.ignore?.ignores(path) ?? false) ||
      (!this.isRoot() && configurationPath(path, this.options.paths)) ||
      [...this.held].some((held) => path === held || path.startsWith(held + '/'))
    )
  }
  private isRoot(): boolean {
    const scope = this.authority?.scope ?? this.token.scope
    return scope.kind === 'folder' && scope.path === '/'
  }
  folderScope(): string | undefined {
    return this.token.scope.kind === 'folder'
      ? (this.options.localRoot ?? this.token.scope.path)
      : undefined
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
    this.assertIncomingPaths([item.path, ...(previous ? [previous] : [])])
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
        : (baseline?.wirePath ?? baseline?.path) !== item.path
          ? (baseline?.wirePath ?? baseline?.path ?? null)
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
    this.assertIncomingPaths([event.path])
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
      this.assertScopedPayload(page)
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
    this.assertIncomingPaths([item.path])
    if (
      configurationPath(item.path, this.options.paths) &&
      item.path !== this.options.ownSettingsPath
    )
      return
    const identity = await this.options.state.byFileId(item.file_id)
    if (identity && (identity.wirePath ?? identity.path) === item.path) {
      this.assertLocalPaths([identity.path])
      // Core places through this retained physical identity, not the wire-spelled sibling.
      return
    }
    if (item.kind === 'directory' || (await this.options.state.get(item.path))) return
    const before = await this.options.fs.stat(item.path)
    if (!before) return
    if (
      this.options.fs.openRead &&
      this.options.fs.fingerprint &&
      this.options.fs.beginAtomicWrite
    ) {
      await this.joinStreamingItem(item, before)
      return
    }
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
  private async joinStreamingItem(
    item: Exclude<V2ManifestItem, { kind: 'directory' }>,
    before: { mtime: number; size: number }
  ): Promise<void> {
    const fs = this.options.fs
    const local = await fs.fingerprint(item.path)
    if (local.sha === item.sha) return
    const dot = item.path.lastIndexOf('.'),
      slash = item.path.lastIndexOf('/')
    const stem = dot > slash ? item.path.slice(0, dot) : item.path,
      ext = dot > slash ? item.path.slice(dot) : ''
    const copy =
      stem + ' (Conflicted copy local ' + before.mtime + ' ' + local.sha.slice(0, 12) + ')' + ext
    const work = async () => {
      this.assertHeld()
      if (await this.options.state.get(item.path)) return
      const actual = await fs.fingerprint(item.path)
      if (actual.sha !== local.sha || actual.generation !== local.generation)
        throw new EngineError('lost', 'Local file changed during first connection; retry required')
      const incoming = await this.client.openVersion(
        item.file_id,
        item.version_id,
        item,
        this.requests.signal
      )
      let incomingStage
      try {
        incomingStage = await fs.beginAtomicWrite(item.path, item.mtime, local)
      } catch (error) {
        await incoming.close()
        throw error
      }
      await receiveToStage(incoming, incomingStage, item, this.transferBudget, this.requests.signal)
      const afterDownload = await fs.fingerprint(item.path)
      if (afterDownload.sha !== local.sha || afterDownload.generation !== local.generation)
        throw new EngineError('lost', 'Local file changed during first connection; retry required')
      await this.options.state.setMeta(
        'token-first-connection:' + item.file_id,
        JSON.stringify({
          path: item.path,
          copy,
          localSha: local.sha,
          remoteSha: item.sha,
          version: item.version_id,
        })
      )
      if (await fs.stat(copy)) {
        if ((await fs.fingerprint(copy)).sha !== local.sha)
          throw new EngineError('lost', 'Conflict copy path is occupied')
      } else {
        const source = await fs.openRead(item.path, local)
        let stage
        try {
          stage = await fs.beginAtomicWrite(copy, before.mtime, null)
        } catch (error) {
          await source.close()
          throw error
        }
        await downloadToStage(source, stage, local, this.transferBudget, this.requests.signal)
      }
      this.assertHeld()
      if ((await fs.fingerprint(item.path)).sha !== local.sha)
        throw new EngineError('lost', 'Local file changed; preserved conflict copy remains')
      await incomingStage.commit(this.requests.signal)
    }
    const placement = Reflect.get(fs, PLACEMENT) as
      | ((paths: string[], work: () => Promise<void>) => Promise<void>)
      | undefined
    await (placement ? placement([item.path, copy], work) : work())
  }
  async pendingLocal(): Promise<number> {
    return (await this.pendingLocalDetails()).count
  }
  async pendingLocalDetails(): Promise<{ count: number; paths: string[] }> {
    this.assertHeld()
    const result = await scan(this.options.fs, this.options.state, {
      excluded: (path, size) =>
        this.blocked(path) ||
        !this.client.includes(path) ||
        isExcluded(path, size, this.selective, this.options.paths?.scriptsFolder ?? 'Scripts'),
    })
    this.assertHeld()
    const paths = await Promise.all(
      result.ops.map(async (op) =>
        'path' in op ? op.path : 'to_path' in op ? op.to_path : await this.pathFor(op.file_id)
      )
    )
    return {
      count: result.ops.length,
      paths: [...new Set(paths.filter((path): path is string => path !== null))],
    }
  }
  async start(): Promise<void> {
    await this.refreshHolds()
    this.assertHeld()
    await this.outbox.restore()
    this.engine.start()
  }
  /** Starting a retry does not prove reachability; only a completed exchange clears offline. */
  get available(): boolean {
    return this.serverAvailable
  }
  async sync(retryHeld = true): Promise<void> {
    await this.refreshHolds()
    this.assertHeld()
    await this.engine.sync()
    await this.outbox.drain(retryHeld)
  }
  invalidate(): void {
    this.active = false
    this.pendingFolders.clear()
    this.progress.clear()
    this.folderProgress.clear()
    this.requests.abort()
  }
  async close(): Promise<void> {
    this.invalidate()
    const failures: unknown[] = []
    try {
      await this.engine.stop()
    } catch (error) {
      failures.push(error)
    }
    try {
      await this.outbox.close()
    } catch (error) {
      failures.push(error)
    }
    try {
      this.unstatus()
    } catch (error) {
      failures.push(error)
    }
    this.transportObservers.clear()
    this.compared.clear()
    this.held.clear()
    this.manifestIds.clear()
    this.assetPaths.clear()
    this.incomingNames.clear()
    this.receivedPaths.clear()
    this.uploadNames.clear()
    this.authority = null
    this.ignore = null
    if (failures.length === 1) throw failures[0]
    if (failures.length) throw new AggregateError(failures, 'Sync runtime cleanup failed')
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
      !this.outsideScope(path) &&
      this.client.includes(path) &&
      !(!this.isRoot() && configurationPath(path, this.options.paths))
    )
  }
  acceptsLocal(path: string, size: number): boolean {
    return this.covers(path) && !this.localExcluded(path, size)
  }
  private localExcluded(path: string, size: number): boolean {
    return (
      this.outsideScope(path.replace(/\/$/, '')) ||
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
      if (
        received &&
        received.sha === (await fingerprintFile(this.options.fs, target.path, sha256)).sha
      )
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
    this.assertLocalPaths([target.path])
    await this.options.preparePlacement?.([target.path])
    const capture = async () => {
      this.assertHeld()
      const current = await this.resolve(id),
        before = await this.options.fs.stat(target.path)
      if (!current || current.path !== target.path || !before)
        throw new Error('File is no longer available')
      if (this.options.fs.openRead && this.options.fs.beginAtomicWrite) {
        const identity = await fingerprintFile(this.options.fs, target.path, sha256)
        const source = await this.options.fs.openRead(target.path)
        let stage
        try {
          stage = await this.options.fs.beginAtomicWrite(target.path, before.mtime, identity)
        } catch (error) {
          await source.close()
          throw error
        }
        await receiveToStage(source, stage, identity, this.transferBudget, this.requests.signal)
        const after = await this.options.fs.stat(target.path)
        if (
          !after ||
          before.size !== after.size ||
          before.mtime !== after.mtime ||
          (await fingerprintFile(this.options.fs, target.path, sha256)).sha !== identity.sha ||
          (await this.resolve(id))?.path !== target.path
        )
          throw new Error('File changed during publication capture; retry from the current file')
        return {
          id,
          path: target.path,
          bytes: new Uint8Array(),
          source: { id: stage.id, size: identity.size },
          sha: identity.sha,
          mtime: before.mtime,
        }
      }
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
  async apply(candidate: ExecutableCandidate, assertAllowed: () => void = () => {}): Promise<void> {
    this.assertHeld()
    if (candidate.source.id !== this.options.id) throw new Error('Review connection changed')
    if (
      this.options.expectedSource &&
      sourceIdentity(candidate.source) !== sourceIdentity(this.options.expectedSource)
    )
      throw new Error('Review source binding changed')
    this.assertIncomingPaths([
      candidate.path,
      ...(candidate.previousPath ? [candidate.previousPath] : []),
    ])
    await this.engine.runExclusive(async () => {
      this.assertHeld()
      const key = 'token-reviewed-apply:' + candidate.id
      if (await this.options.state.getMeta(key)) return
      assertAllowed()
      const fs = reviewFileSystem(this.options.fs, assertAllowed)
      if (candidate.directory) {
        await this.applyDirectory(candidate, fs)
      } else {
        const prior = await this.options.state.byFileId(candidate.fileId)
        if (prior?.versionId !== candidate.versionId) {
          const bytes = candidate.bytes === null ? null : Uint8Array.from(candidate.bytes)
          if (bytes && (await sha256(bytes)) !== candidate.sha)
            throw new Error('Reviewed content changed')
          const localClient = new Proxy(this.client, {
            get(target, name) {
              if (name === 'openVersion')
                return async (
                  fileId: string,
                  versionId: string,
                  expected: { size: number; sha: string }
                ) => {
                  if (
                    fileId !== candidate.fileId ||
                    versionId !== candidate.versionId ||
                    expected.sha !== candidate.sha ||
                    expected.size !== bytes?.length
                  )
                    throw new Error('Unreviewed content requested')
                  return {
                    size: bytes.length,
                    read: async (offset: number, length: number) =>
                      bytes.slice(offset, offset + length),
                    assertUnchanged: async () => {},
                    close: async () => {},
                  }
                }
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
            assertAllowed()
            if (prior) await this.options.state.delete(prior.path)
          } else {
            assertAllowed()
            const result = await applyStaged(localClient, fs, this.options.state, [change], {
              filter: { excluded: () => false },
              dirty: new Set(),
              expected: new ExpectedWrites(),
              preserveMissing: new Set(prior ? [prior.fileId] : []),
            })
            if (result.held.length)
              throw new Error('The local file changed; this version remains pending')
          }
        }
      }
      await this.options.state.setMeta(key, candidate.versionId)
    })
    await this.refreshHolds()
  }
  private async applyDirectory(candidate: ExecutableCandidate, fs: FileSystem): Promise<void> {
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
      await local.prepare(fs, this.options.state)
      if (candidate.operation === 'delete_directory') await local.changes(0)
      else await local.manifest(null)
      await local.finishPull()
    }
    await work()
  }
}
