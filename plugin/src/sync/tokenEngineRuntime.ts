import { gateMobileSource } from './mobileLargeFileGate'
import { FINGERPRINT_UPLOAD, PHONE_FALLBACK_BYTES } from './mobileWholeRead'
import { connectionPrivateRoot } from './connectionPaths'
import { assertPhysicalPath } from './external/projection'
import { scopedFileSystem, FolderScopeError } from './scopedFileSystem'
import { withinSyncPath } from './scope'
import { LocalPaths } from '@abele/sync-sdk/core'
import { ServerFolderPaths } from './serverFolderPaths'
import { vaultRootFailure } from './vaultPathLinks'
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
  GENERATION_KEY,
  readReconciliation,
  fenceRestoredJournal,
  type FileSystem,
  type ChunkSource,
  type StateStore,
  type EngineClient,
  type SyncReport,
  type EngineStatus,
  type SelectiveSettings,
  type PathMatcher,
} from '@abele/sync-sdk/core'
import { ExchangeTrace } from './exchangeTrace'
import { connectStage, connectionError } from './tokenUi'
import {
  PathSchema,
  V2ManifestSchema,
  V2ChangesSchema,
  V2ConnectionSchema,
  ErrorCodeSchema,
  AbeleError,
  decodeAccessToken,
  normalisePath,
  validatePath,
  type V2ManifestItem,
  type V2Change,
  type V2Connection,
  type ChangeItem,
} from '@abele/sync-sdk/protocol'
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
import { RESTORE_HEADER, assertResponseGeneration, fenceHostGeneration } from './restoreFence'
import type { ScopeRootIssue } from './scopeRoot'
import { LocalFolderPlacement, LocalPlacementError } from './localFolderPlacement'
import { verifyFolderSet, type FolderEntries } from './verifyFolderSet'
import { tokenScope } from './v2/client'
import { RetainedShareCopies } from './retainedShareCopies'
import type { ConnectionItem } from './shareSets'

export interface TokenEngineOptions {
  mobile?: boolean
  id: string
  encoded: string
  item?: string
  uploadAllowed?(path: string): boolean
  retainedChanged?(items: ConnectionItem[]): void
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
  retirePlacement?(generation: string, archive: (value: unknown) => Promise<void>): Promise<void>
  fencePlacement?(head: number): Promise<void>
  engineClient?(client: EngineClient): EngineClient
  engineState?: StateStore
  publicationChanged?(): void
  scopeInput?(
    selective: SelectiveSettings
  ): Promise<{ key: string; ignore: PathMatcher; localCandidates?: readonly string[] }>
  paused?: boolean
  serverRoot?: string
  serverRootChanged?(path: string): void
  rootIssue?: ScopeRootIssue
  rootChanged?(issue: ScopeRootIssue | undefined): void
  localRoot?: string
  followRecoveredRoot?(from: string, to: string): void
  localRootChanged?(path: string): void
  verifyRootFileSystem?(path: string): FileSystem
  inspectRoot?(path: string): Promise<FolderEntries>
  watchRoot?(notice: (issue: ScopeRootIssue) => void): () => void
  rootExists?(): Promise<boolean>
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
  /** Server/ledger-named group candidates, before host representation inspection. */
  discoveryCandidates?(paths: readonly string[]): void
  discoveryLocalCandidates?(paths: readonly string[]): void
  discoveryScope?(scope: V2Connection['scope']): void
  expectedSource?: ReviewSource
  localFiles?: {
    note(path: string): Promise<{ id: string; targets: ConsentTarget[] } | null>
    resolve(id: string): ConsentTarget | null
  }
}
/** Host wiring around the retained engine. All exchange and journaling belongs to core. */
export class TokenEngineRuntime
  implements ConnectionRuntime, Omit<TokenUiRuntime, 'historyClient'>
{
  readonly trace = new ExchangeTrace()
  /** Hashes whose bytes this server holds: own uploads and fully verified received versions.
   * Only lets a matching local receipt stand in for rereading a large file. */
  private readonly wholeReadUploads = new Set<string>()
  /** Own uploads no commit has used yet. A scoped server admits a new sha only against this
   * principal's own upload and spends it on commit, so only these may skip the blob upload. */
  private readonly uploadEntitlements = new Set<string>()
  private readonly uploadFingerprints = new Map<string, Promise<unknown>>()
  private readonly largeUploadPaths = new Set<string>()
  readonly engine: SyncEngine
  readonly client: V2EngineClient
  readonly actions: TokenActions
  private readonly outbox: TokenAssetOutbox
  private readonly transferBudget: TransferBudget
  private active = true
  private serverAvailable = true
  private rootIssue: ScopeRootIssue | undefined
  private unroot: (() => void) | undefined
  private rootControl = false
  private readonly requests = new AbortController()
  private readonly readRequests = new Set<AbortController>()
  private reviewYield = 0
  // Counts installations that stopped a run, so a caller can tell its run was yielded.
  private reviewInterruptions = 0
  private reviewApplications = Promise.resolve()
  private readonly reviewYielded = new EngineError(
    'offline',
    'Sync yielded for approved installation'
  )
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
  private generation: string | null = null
  private readyToPublish = false
  private acceptHandshake = false
  private ignore: PathMatcher | null = null
  private authority: V2Connection | null = null
  private readonly compared = new Set<string>()
  private inventoryTotal = 0
  private comparisonPublished = 0
  private held = new Set<string>()
  private readonly manifestIds = new Set<string>()
  private readonly groupCandidates = new Set<string>()
  private localCandidates = new Set<string>()
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
  /** A consumed page may retain or exclude a directory without calling mkdir. */
  private finishFolderPreparation(): void {
    if (!this.pendingFolders.size) return
    this.pendingFolders.clear()
    this.folderProgress.clear()
    this.progress.refresh()
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
  private readonly placement?: LocalFolderPlacement
  private readonly serverPaths?: ServerFolderPaths
  private readonly localFs: FileSystem
  constructor(private readonly options: TokenEngineOptions) {
    const item = options.item
    if (item) {
      const fetcher = options.fetch
      options.fetch = (input, init) => {
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined)
        )
        headers.set('abele-scope-item', item)
        return fetcher(input, { ...init, headers })
      }
    }
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
    this.localFs = options.fs
    this.transferBudget = options.transferBudget ?? new TransferBudget()
    this.selective = structuredClone(options.selective ?? selectiveDefaults())
    const decoded = decodeAccessToken(options.encoded)
    this.token = { ...decoded, scope: tokenScope(decoded, options.item) }
    if (this.token.scope.kind === 'folder' && (options.localRoot ?? this.token.scope.path) !== '/')
      options.fs = scopedFileSystem(
        options.fs,
        (path) => this.assertPhysicalLocalPaths([path]),
        (path) => {
          const root = this.options.localRoot ?? this.token.scope.path
          return path === root || path.startsWith(root + '/')
        },
        connectionPrivateRoot(options.id),
        () => options.localRoot ?? this.token.scope.path
      )
    if (this.token.scope.kind === 'folder' && this.token.scope.path !== '/') {
      this.serverPaths = new ServerFolderPaths(
        this.token.scope.path,
        options.serverRoot ?? this.token.scope.path
      )
      this.placement = new LocalFolderPlacement(
        this.token.scope.path,
        options.localRoot ?? this.token.scope.path
      )
      options.fs = this.placement.fileSystem(options.fs)
      const prepare = options.preparePlacement?.bind(options)
      if (prepare)
        options.preparePlacement = (paths) =>
          prepare(paths.map((path) => this.placement.toLocal(path)))
    }
    if (this.token.scope.kind === 'group') this.nameCandidates([this.token.scope.path])
    const transport: typeof fetch = (input, init) =>
      this.trace.run(
        (init?.method ?? 'GET') +
          ' ' +
          new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
            .pathname,
        async () => {
          this.assertHeld()
          if (
            this.reviewYield &&
            (!init?.method || init.method === 'GET' || init.method === 'HEAD')
          )
            throw this.reviewYielded
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
          const expectedGeneration =
            this.generation ?? (await options.state.getMeta(GENERATION_KEY))
          const handshake = path === '/v2/connection' && this.acceptHandshake
          const headers = new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : undefined)
          )
          if (!handshake && expectedGeneration) headers.set(RESTORE_HEADER, expectedGeneration)
          if (handshake) headers.delete(RESTORE_HEADER)
          const range = /^bytes=(\d+)-\d+$/.exec(new Headers(init?.headers).get('range') ?? '')
          const rangeOffset = range ? Number(range[1]) : undefined
          this.observeRequest(path, true, undefined, rangeOffset)
          const request = new AbortController()
          if (!init?.method || init.method === 'GET' || init.method === 'HEAD')
            this.readRequests.add(request)
          const abort = () => request.abort()
          const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
          for (const signal of [callerSignal, this.requests.signal]) {
            if (signal?.aborted) abort()
            else signal?.addEventListener('abort', abort, { once: true })
          }
          try {
            const outgoing =
              this.serverPaths &&
              typeof init?.body === 'string' &&
              (path === '/v2/commit' || path.endsWith('/external/verify'))
                ? {
                    ...init,
                    body: JSON.stringify(this.serverPaths.map(JSON.parse(init.body), false)),
                  }
                : init
            const requestUrl = new URL(
              typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
            )
            const prefix = requestUrl.searchParams.get('path_prefix')
            if (this.serverPaths && prefix)
              requestUrl.searchParams.set(
                'path_prefix',
                this.serverPaths.map({ path: prefix }, false).path
              )
            response = await options.fetch(prefix && this.serverPaths ? requestUrl : input, {
              ...outgoing,
              headers,
              signal: request.signal,
            })
            successful = response.ok
          } catch (error) {
            if (this.reviewYield && request.signal.aborted) throw this.reviewYielded
            const native = nativeSyncFailure(error)
            if (native) {
              this.trace.log(native.message)
            }
            throw error
          } finally {
            this.readRequests.delete(request)
            this.observeRequest(path, false, successful, rangeOffset)
            callerSignal?.removeEventListener('abort', abort)
            this.requests.signal.removeEventListener('abort', abort)
          }
          this.assertHeld()
          const url = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          )
          if (url.pathname !== '/v2/connection')
            assertResponseGeneration(response, expectedGeneration)
          if (!response.ok) {
            const refusal = await response
              .clone()
              .json()
              .catch((): null => null)
            if (refusal?.error?.code === 'scope_deleted') {
              this.permitted = false
              this.engine?.pause()
              const error = Object.assign(new Error('Scope deleted on the server'), {
                code: 'scope_deleted',
              })
              options.failed(error)
              throw error
            }
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
            const generation = response.headers.get(RESTORE_HEADER)
            // A connection GET during state()/publication is not a fresh prepare handshake.
            if (!handshake) assertResponseGeneration(response, expectedGeneration)
            this.acceptHandshake = false
            await fenceHostGeneration(
              options.state,
              generation,
              (save) => options.retirePlacement?.(generation, save) ?? Promise.resolve(),
              async (save) => {
                await save(
                  (await options.reviews.executables.state()).filter(
                    (one) => one.source.id === options.id
                  )
                )
                await options.reviews.executables.forgetSource(options.id)
              }
            )
            const authority = V2ConnectionSchema.parse(await response.clone().json())
            this.permitted = authority.status === 'active'
            if (
              authority.scope.kind !== this.token.scope.kind ||
              authority.scope.id !== this.token.scope.id
            )
              throw new EngineError('protocol', 'Token selector identity changed')
            if (
              this.permitted &&
              this.serverPaths &&
              authority.scope.path !== this.serverPaths.remote
            ) {
              if (!PathSchema.safeParse(authority.scope.path).success)
                throw new FolderScopeError(
                  'The server returned an invalid shared-folder name; sync stopped'
                )
              const issue = {
                kind: 'server-renamed' as const,
                from: this.serverPaths.remote,
                to: authority.scope.path,
              }
              this.scopeRootGone(issue)
              throw new FolderScopeError(
                `Shared folder renamed on the server: ${issue.from} → ${issue.to}; sync stopped`
              )
            }
            this.authority = this.serverPaths
              ? { ...authority, scope: { ...authority.scope, path: this.serverPaths.canonical } }
              : authority
            if (this.permitted) options.discoveryScope?.(this.authority.scope)
            return Response.json(this.authority, { headers: response.headers })
          } else if (url.pathname === '/v2/manifest') {
            const page = V2ManifestSchema.parse(this.received(await response.json()))
            this.assertIncomingPaths(page.items.map((item) => item.path))
            if (this.pulling) {
              for (const item of page.items) this.pullPaths.add(item.path)
              this.pullProgress('Receiving files')
            }
            if (!url.searchParams.get('next')) this.manifestIds.clear()
            for (const item of page.items) this.manifestIds.add(item.file_id)
            this.nameCandidates(page.items.map((item) => item.path))
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
            const page = V2ChangesSchema.parse(this.received(await response.json()))
            this.assertIncomingPaths(
              page.items.flatMap((event) =>
                event.type === 'content'
                  ? [event.path, event.item.path, ...(event.prev_path ? [event.prev_path] : [])]
                  : [event.path]
              )
            )
            const scope = this.authority?.scope ?? this.token.scope
            if (
              scope.kind === 'folder' &&
              scope.path !== '/' &&
              page.items.some(
                (event) =>
                  event.type !== 'content' &&
                  (event.file_id === scope.id || event.path === scope.path)
              )
            ) {
              const error = new AbeleError(
                'scope_unavailable',
                'The server folder was removed; local files were kept'
              )
              return Response.json(error.toBody(), { status: error.status })
            }
            if (this.progress.stage !== 'Downloading') this.progress.begin('Downloading')
            this.nameCandidates(
              page.items.flatMap((event) =>
                event.type === 'content'
                  ? [event.item.path, ...(event.prev_path ? [event.prev_path] : [])]
                  : [event.path]
              )
            )
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
          } else if (
            url.pathname === '/v2/commit' ||
            url.pathname === '/v2/trash' ||
            url.pathname === '/v2/trash/restore' ||
            /^\/v2\/files\/[^/]+\/(history|head|restore|external\/verify)$/.test(url.pathname)
          ) {
            const payload = this.received(await response.clone().json())
            this.assertScopedPayload(payload)
            return Response.json(payload, { headers: response.headers })
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
      item: options.item,
      ...(options.WebSocket ? { WebSocket: options.WebSocket } : {}),
    })
    const hasBlob = this.client.hasBlob.bind(this.client)
    this.client.hasBlob = async (sha) => this.uploadEntitlements.has(sha) || (await hasBlob(sha))
    const prepare = this.client.prepare.bind(this.client)
    const includes = this.client.includes.bind(this.client)
    this.client.includes = (path) =>
      includes(path) || (this.active && this.permitted && this.assetPaths.has(path))
    this.client.prepare = async (fs, state, excluded) => {
      this.largeUploadPaths.clear()
      this.readyToPublish = false
      this.acceptHandshake = true
      if (options.rootExists && (await state.getCursor()) > 0 && !(await options.rootExists()))
        this.scopeRootGone({ kind: 'deleted' })
      this.assertHeld()
      this.compared.clear()
      this.assetPaths.clear()
      if (this.token.scope.kind === 'group') {
        const paths: string[] = []
        for await (const entry of state.all()) paths.push(entry.path)
        this.nameCandidates(paths)
      }
      if (options.scopeInput) {
        const input = await options.scopeInput(this.selective)
        this.assertHeld()
        this.localCandidates = new Set(input.localCandidates ?? [])
        options.discoveryLocalCandidates?.([...this.localCandidates])
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
      const candidate = (path: string) => this.namedCandidate(path)
      await prepare(
        new Proxy(fs, {
          get(target, name) {
            if (name === 'list')
              return async function* () {
                for await (const info of target.list())
                  if (candidate(info.path) && !localExcluded(info.path, info.size)) yield info
              }
            const value = Reflect.get(target, name)
            return typeof value === 'function' ? value.bind(target) : value
          },
        }),
        options.state,
        excluded
      )
      const generation = await options.state.getMeta(GENERATION_KEY)
      if (generation !== this.generation) {
        this.wholeReadUploads.clear()
        this.uploadEntitlements.clear()
      }
      this.generation = generation
      const reconciliation = await readReconciliation(options.state)
      options.changed({ ...this.engine.status, reconciliation })
      // state() includes an effects-capable changes decoder; replay stays fenced here.
      const head = await this.client.state()
      await fenceRestoredJournal(options.state, head.head_seq, fs, undefined, this.client)
      await options.fencePlacement?.(head.head_seq)
      await this.outbox.restore()
      await this.trace.run('write recovery after restore handshake', async () =>
        options.recoverPlacement?.()
      )
      this.readyToPublish = true
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
    this.client.onRemoval = async (id) => {
      const entry = await options.state.byFileId(id)
      if (entry) await new RetainedShareCopies(options.state).remember(entry)
      return true
    }
    const manifest = this.client.manifest.bind(this.client)
    this.client.manifest = async (...args) => {
      const page = await manifest(...args)
      this.finishFolderPreparation()
      return page
    }
    const changes = this.client.changes.bind(this.client)
    this.client.changes = async (...args) => {
      const page = await changes(...args)
      this.finishFolderPreparation()
      await this.publishRetainedCopies()
      return page
    }
    const openVersion = this.client.openVersion.bind(this.client)
    this.client.openVersion = async (fileId, versionId, expected, signal) => {
      const path = this.incomingNames.get(fileId) ?? (await options.state.byFileId(fileId))?.path
      if (path) this.progress.current(path)
      const opened = await openVersion(fileId, versionId, expected, signal)
      const source = options.mobile ? gateMobileSource(opened, signal) : opened
      let receivedThrough = 0
      return new Proxy(source, {
        get: (target, key) => {
          if (key === 'read')
            return async (offset: number, length: number, signal?: AbortSignal) => {
              const bytes = await target.read(offset, length, signal)
              if (offset === receivedThrough) receivedThrough += bytes.length
              if (path) this.receivedPaths.add(path)
              this.progress.bytes(fileId + ':' + versionId, offset, bytes.length)
              return bytes
            }
          if (key === 'assertUnchanged')
            return async () => {
              await target.assertUnchanged()
              if (receivedThrough === expected.size) this.wholeReadUploads.add(expected.sha)
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
    const beginPull = this.trace.beginPull.bind(this.trace)
    this.engine = new SyncEngine({
      transferBudget: this.transferBudget,
      client: options.engineClient?.(this.client) ?? this.client,
      fs: new Proxy(options.fs, {
        get: (target, name) => {
          if (name === Symbol.for('abele.sync.upload-owner-v1'))
            return (path: string) => options.uploadAllowed?.(path) ?? true
          if (name === 'watch' && target.watch)
            return (notify: (paths: string[]) => void) =>
              target.watch((paths) => {
                if (this.rootIssue) return
                // Polling settings and editor activity also reports ignored files.
                // They cannot change this connection's inventory; keep the ignore
                // control file itself observable so scope changes still take effect.
                const relevant = paths.filter(
                  (path) =>
                    path === '.abele-sync-ignore' || !this.ignore?.ignores(path.normalize('NFC'))
                )
                if (relevant.length) notify(relevant)
              })
          if (name === 'writeAtomic')
            return async (path: string, bytes: Uint8Array, mtime: number) => {
              await this.trace.run(
                'pull atomic write ' + path,
                () => target.writeAtomic(path, bytes, mtime),
                true
              )
              this.actions.written(path)
              this.pulled(path)
              this.trace.written(path)
            }
          if (name === 'mkdir' && target.mkdir)
            return async (path: string) => {
              await this.trace.run('mkdir ' + path, () => target.mkdir(path), true)
              this.folderPrepared(path)
              this.pulled(path)
            }
          if (name === 'beginAtomicWrite' && target.beginAtomicWrite)
            return async (...args: Parameters<NonNullable<FileSystem['beginAtomicWrite']>>) => {
              const stage = await this.trace.run(
                'pull stage create ' + args[0],
                () => target.beginAtomicWrite(...args),
                true
              )
              const trace = this.trace
              const written = () => {
                this.actions.written(args[0])
                this.pulled(args[0])
                this.trace.written(args[0])
              }
              return new Proxy(stage, {
                get(target, key) {
                  if (key === 'commit')
                    return async (signal?: AbortSignal) => {
                      await trace.run(
                        'pull stage publish ' + args[0],
                        () => target.commit(signal),
                        true
                      )
                      written()
                    }
                  const value = Reflect.get(target, key)
                  if (
                    ['append', 'seal', 'discard'].includes(String(key)) &&
                    typeof value === 'function'
                  )
                    return (...parameters: unknown[]) =>
                      trace.run(
                        'pull stage ' + String(key) + ' ' + args[0],
                        () => value.apply(target, parameters),
                        true
                      )
                  return typeof value === 'function' ? value.bind(target) : value
                },
              })
            }
          const value = Reflect.get(target, name)
          if (name === Symbol.for('abele.sync.trace-pull-v1')) return beginPull
          if (
            name === Symbol.for('abele.sync.directory-identity-v1') &&
            typeof value === 'function'
          )
            return (path: string) =>
              this.trace.run('directory identity ' + path, () => value.call(target, path), true)
          if (name === 'move')
            return async (from: string, to: string) => {
              await target.move(from, to)
              this.trace.written(to)
            }
          if ((name === 'list' || name === 'listDirectories') && typeof value === 'function') {
            const trace = this.trace
            const inventoried = (completed: number) => {
              if (name === 'list') this.inventoryTotal = completed
            }
            const candidate = (path: string) => this.namedCandidate(path)
            const largeUploads = this.largeUploadPaths
            const checkRoot = () => this.checkRoot()
            const nameTracked = async () => {
              if (this.token.scope.kind !== 'group') return
              for await (const entry of options.state.all()) this.nameCandidates([entry.path])
            }
            return async function* () {
              await checkRoot()
              await nameTracked()
              const finish = trace.begin('fs ' + String(name))
              let completed = 0
              try {
                for await (const info of value.call(target)) {
                  if (name === 'list' && !candidate(info.path)) continue
                  if (name === 'list') {
                    if (info.size > PHONE_FALLBACK_BYTES) largeUploads.add(info.path)
                    else largeUploads.delete(info.path)
                  }
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
              this.trace.run(
                'placement ' + paths.join(', '),
                () => value.call(target, paths, work, preserve),
                true
              )
          if (
            (name === 'read' ||
              name === 'stat' ||
              name === 'fingerprint' ||
              name === Symbol.for('abele.sync.fingerprint-fresh-v1')) &&
            typeof value === 'function'
          )
            return (path: string) =>
              this.trace.run('fs ' + String(name) + ' ' + path, async () => {
                if (name === 'stat') return value.call(target, path)
                const total = this.inventoryTotal
                if (this.compared.size === 0) options.comparing?.({ completed: 0, total })
                const bytes =
                  name === 'fingerprint' || name === Symbol.for('abele.sync.fingerprint-fresh-v1')
                    ? ((this.largeUploadPaths.has(path)
                        ? await this.fingerprintForUpload(target, path)
                        : undefined) ?? (await value.call(target, path)))
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
      stillHeld: () => this.active && !this.rootIssue,
      ignore: { ignores: (path) => this.blocked(path) },
      // Host transport durably stages every executable delivery before core receives the page.
      defer: (path) =>
        executablePath(path, false, options.paths) ||
        (configurationPath(path, options.paths) && path !== options.ownSettingsPath),
      ...(options.paths?.scriptsFolder ? { scriptsFolder: options.paths.scriptsFolder } : {}),
      ...(options.fallbackMs ? { fallbackMs: options.fallbackMs } : {}),
      onSync: (report) => {
        this.serverAvailable = true
        this.trace.finishPull(true)
        this.pendingFolders.clear()
        this.folderProgress.clear()
        this.progress.clear()
        this.pulling = false
        options.pulling?.()
        options.comparing?.()
        this.trace.finishFirstSync()
        options.changed(this.engine.status, this.placement?.localMetadata(report) ?? report)
        void this.outbox.drain().catch(() => options.publicationChanged?.())
      },
      onFail: (error) => {
        this.wholeReadUploads.clear()
        this.uploadEntitlements.clear()
        this.trace.finishPull(false)
        this.pendingFolders.clear()
        this.folderProgress.clear()
        if (!this.yieldedForReview(error)) options.event?.('Error: ' + connectionError(error))
        this.progress.clear()
        this.pulling = false
        options.pulling?.()
        const rootFailure = vaultRootFailure(error)
        if (rootFailure) {
          this.engine.pause()
          options.comparing?.()
          options.failed(rootFailure)
          return
        }
        if (error instanceof LocalPlacementError) this.engine.pause()
        if (
          [
            'scope_unavailable',
            'forbidden',
            'unauthorized',
            'vault-root-changed',
            'protocol',
          ].includes((error as { code?: string }).code ?? '')
        )
          this.engine.pause()
        options.comparing?.()
        if (!this.yieldedForReview(error)) options.failed(error)
      },
      log: (line) => {
        this.trace.log(line)
        options.event?.(line)
      },
    })
    this.unstatus = this.engine.onStatus((status) => {
      if (status.state === 'offline') this.serverAvailable = false
      if (status.state === 'syncing') this.trace.beginPullCycle()
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
        if (!this.readyToPublish) return false
        const reconciliation = await readReconciliation(options.state)
        if (reconciliation && reconciliation.phase !== 'complete') return false
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
      let outcome: Awaited<ReturnType<typeof commit>>
      try {
        outcome = await commit(ops, key)
      } catch (error) {
        // The server may have spent the upload before the response was lost.
        for (const op of ops) if ('sha' in op) this.uploadEntitlements.delete(op.sha)
        throw error
      }
      for (const [index, op] of ops.entries())
        if ('sha' in op && outcome.body.results[index]?.status !== 'rejected')
          this.uploadEntitlements.delete(op.sha)
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
    this.rootIssue = options.rootIssue
    if (this.rootIssue) this.engine.pause()
    this.unroot = options.watchRoot?.((issue) => this.scopeRootGone(issue))
  }
  scopeRootGone(issue: ScopeRootIssue): void {
    if (!this.active || JSON.stringify(this.rootIssue) === JSON.stringify(issue)) return
    this.rootIssue = issue
    this.engine.pause()
    this.options.rootChanged?.(issue)
    console.debug('[abele-sync] folder root unavailable; connection stopped', issue.kind)
  }
  async restoreRoot(): Promise<void> {
    if (!this.rootIssue || this.rootIssue.kind === 'server-renamed')
      throw new Error('The folder is not missing')
    await this.engine.runExclusive(async () => {
      const directories = JSON.parse((await this.options.state.getMeta('v2-directories')) ?? '{}')
      if (
        (await this.options.state.getMeta('plugin:scope-root-follow')) ||
        (await this.options.state.getJournal()) ||
        directories.pending
      )
        throw new Error('A previous server operation is unresolved; sync remains stopped')
      // Explicitly pull a new snapshot. Old absence must never become outgoing deletes.
      await this.options.state.transaction(async () => {
        await this.options.state.setCursor(0)
        await this.options.state.setMeta('v2-directories', null)
        const entries = []
        for await (const entry of this.options.state.all()) entries.push(entry.path)
        for (const path of entries) await this.options.state.delete(path)
      })
      this.rootIssue = undefined
      this.options.rootChanged?.(undefined)
    })
    try {
      this.unroot?.()
      this.unroot = this.options.watchRoot?.((issue) => this.scopeRootGone(issue))
      const held = await this.engine.heldDeletes()
      if (held.length)
        await this.engine.decideDeletes(
          'restore',
          held.map((one) => one.fileId)
        )
      await this.engine.sync()
      this.engine.resume()
      this.engine.start()
    } catch (error) {
      this.scopeRootGone({ kind: 'deleted' })
      throw error
    }
  }
  async followServerRoot(): Promise<void> {
    const issue = this.rootIssue
    if (issue?.kind !== 'server-renamed' || !this.serverPaths)
      throw new Error('The server folder was not renamed')
    await this.engine.runExclusive(async () => {
      if (!this.active) throw new EngineError('lost', 'Connection stopped')
      this.options.assertHeld?.()
      if (this.options.rootExists && !(await this.options.rootExists()))
        throw new LocalPlacementError('The local folder is missing; sync remains stopped')
      const directories = JSON.parse((await this.options.state.getMeta('v2-directories')) ?? '{}')
      if (
        (await this.options.state.getJournal()) ||
        directories.pending ||
        (await this.options.state.getMeta('plugin:scope-root-follow'))
      )
        throw new LocalPlacementError(
          'A previous server operation is unresolved; sync remains stopped'
        )
      const response = await this.options.fetch(new URL('/v2/connection', this.token.address), {
        headers: {
          authorization: 'Bearer ' + this.token.key,
          ...(this.generation ? { [RESTORE_HEADER]: this.generation } : {}),
        },
        cache: 'no-store',
        signal: this.requests.signal,
      })
      if (!response.ok)
        throw new EngineError(
          'protocol',
          'Cannot confirm the renamed server folder; sync remains stopped'
        )
      assertResponseGeneration(response, this.generation)
      const authority = V2ConnectionSchema.parse(await response.json())
      if (
        authority.status !== 'active' ||
        authority.scope.kind !== this.token.scope.kind ||
        authority.scope.id !== this.token.scope.id
      )
        throw new EngineError(
          'protocol',
          'The shared folder identity changed; sync remains stopped'
        )
      if (!this.active) throw new EngineError('lost', 'Connection stopped')
      this.options.assertHeld?.()
      if (this.rootIssue !== issue)
        throw new LocalPlacementError(
          'The local folder changed; review its current state before continuing'
        )
      if (authority.scope.path !== issue.to) {
        if (!PathSchema.safeParse(authority.scope.path).success)
          throw new FolderScopeError(
            'The server returned an invalid shared-folder name; sync remains stopped'
          )
        this.scopeRootGone({ ...issue, to: authority.scope.path })
        throw new FolderScopeError(
          'The server folder was renamed again; review its current name before continuing'
        )
      }
      // Only the wire namespace changes. Existing baselines, stages and local paths remain intact.
      // A snapshot skips the historical move whose old path is outside the new server boundary.
      await this.options.state.setCursor(0)
      if (!this.active || this.rootIssue !== issue)
        throw new LocalPlacementError('The connection changed; sync remains stopped')
      this.options.assertHeld?.()
      this.options.serverRootChanged?.(issue.to)
      this.serverPaths.remote = issue.to
      this.rootIssue = undefined
      this.options.rootChanged?.(undefined)
      console.debug('[abele-sync] following renamed server folder at unchanged local placement')
    })
    await this.engine.sync()
    this.engine.resume()
    this.engine.start()
  }
  async followRoot(): Promise<void> {
    const issue = this.rootIssue
    if (issue?.kind !== 'moved' || !this.placement) throw new Error('The folder was not moved')
    await this.engine.runExclusive(async () => {
      this.options.assertHeld?.()
      if (
        (await this.options.state.getJournal()) ||
        (await this.options.state.getMeta('plugin:scope-root-follow'))
      )
        throw new Error('A previous server operation is unresolved; sync remains stopped')
      await verifyFolderSet(
        this.options.state,
        this.options.verifyRootFileSystem?.(issue.path) ?? this.localFs,
        this.placement.server,
        issue.path,
        this.options.inspectRoot?.bind(this.options)
      )
      if (this.rootIssue !== issue)
        throw new LocalPlacementError(
          'The folder moved again; check its current location before following'
        )
      this.options.followRecoveredRoot?.(this.placement.local, issue.path)
      this.options.localRootChanged?.(issue.path)
      this.options.localRoot = issue.path
      this.placement.local = issue.path
      this.rootIssue = undefined
      this.options.rootChanged?.(undefined)
      this.unroot?.()
      this.unroot = this.options.watchRoot?.((issue) => this.scopeRootGone(issue))
      console.debug('[abele-sync] following folder at its new local placement')
    })
    await this.engine.rescan()
    this.engine.resume()
    this.engine.start()
  }
  async updateSelective(selective: SelectiveSettings): Promise<void> {
    await this.engine.runExclusive(async () => {
      this.assertHeld()
      Object.assign(this.selective, structuredClone(selective))
    })
    if (this.engine.status.state !== 'paused') await this.engine.rescan()
  }
  private nameCandidates(paths: readonly string[]): void {
    if (this.token.scope.kind !== 'group') return
    for (const path of paths) this.groupCandidates.add(path)
    this.options.discoveryCandidates?.(paths)
  }
  private received<T>(value: T): T {
    try {
      return this.serverPaths ? this.serverPaths.map(value, true) : value
    } catch (error) {
      this.engine?.pause()
      throw error
    }
  }
  private namedCandidate(path: string): boolean {
    return (
      this.token.scope.kind !== 'group' ||
      this.groupCandidates.has(path) ||
      this.localCandidates.has(path)
    )
  }
  /** An observed local rename extends discovery only from already named members. */
  localRenamed(from: string, to: string): void {
    if (!this.active || this.token.scope.kind !== 'group') return
    const source = from,
      destination = to
    const paths = [...this.groupCandidates].filter(
      (path) => path === source || path.startsWith(source + '/')
    )
    this.nameCandidates(paths.map((path) => destination + path.slice(source.length)))
  }
  written(path: string): void {
    this.actions.written(this.placement?.toServer(path) ?? path)
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
          ...(this.generation ? { [RESTORE_HEADER]: this.generation } : {}),
        },
        body: JSON.stringify({ path: normalisePath(one.path), ...expected, mtime: one.mtime }),
      })
      this.assertHeld()
      assertResponseGeneration(response, this.generation)
      if (!response.ok)
        throw new EngineError('protocol', 'File publication response is unavailable')
      const result: unknown = await response.json()
      this.assertScopedPayload(result)
      return result
    }, this.requests.signal)
  }
  private assertHeld(): void {
    if (!this.active) throw new EngineError('lost', 'Connection stopped')
    if (this.rootIssue?.kind === 'server-renamed' && !this.rootControl)
      throw new FolderScopeError(
        `Shared folder renamed on the server: ${this.rootIssue.from} → ${this.rootIssue.to}; sync stopped`
      )
    if (this.rootIssue && !this.rootControl)
      throw new AbeleError(
        'scope_unavailable',
        'The local folder is gone; restore it from the server or disconnect'
      )
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
    return (
      !!this.placement &&
      path !== this.placement.server &&
      !path.startsWith(this.placement.server + '/')
    )
  }
  /** Host identity resolution and rooted inventory supply physical spelling, never a wire alias. */
  private assertPhysicalLocalPaths(paths: readonly string[]): void {
    const root = this.options.localRoot ?? this.token.scope.path
    for (const path of paths) {
      assertPhysicalPath(path)
      if (path !== root && !path.startsWith(root + '/'))
        throw new FolderScopeError(
          'The local file is outside this connection; sync stopped: ' + path
        )
    }
  }
  private assertLocalPaths(paths: readonly string[]): void {
    for (const path of paths) {
      try {
        assertPhysicalPath(path)
        // Compare the exact physical root bytes; Unicode normalization grants no access.
        const root = this.placement?.server ?? this.options.localRoot ?? this.token.scope.path
        if (
          this.token.scope.kind !== 'folder' ||
          root === '/' ||
          path === root ||
          path.startsWith(root + '/')
        )
          continue
      } catch {
        /* Malformed physical paths cannot reach filesystem operations. */
      }
      this.engine?.pause()
      throw new FolderScopeError('The local file is outside this connection; sync stopped: ' + path)
    }
  }
  private assertIncomingPaths(paths: readonly string[]): void {
    if (this.token.scope.kind !== 'folder' || this.token.scope.path === '/') return
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
    // Core asks about directory prefixes as well as concrete paths.
    if (path.endsWith('/')) path = path.slice(0, -1)
    return (
      this.outsideScope(path) ||
      (this.ignore?.ignores(this.placement?.toLocal(path) ?? path) ?? false) ||
      (!this.isRoot() && configurationPath(path, this.options.paths)) ||
      [...this.held].some((held) => withinSyncPath(path, held))
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
      const page = V2ChangesSchema.parse(this.received(await response.json()))
      this.assertIncomingPaths(
        page.items.flatMap((event) =>
          event.type === 'content'
            ? [event.path, event.item.path, ...(event.prev_path ? [event.prev_path] : [])]
            : [event.path]
        )
      )
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
    if (this.localExcluded(item.path, item.kind === 'directory' ? 0 : item.size)) return
    const reconciliation = await readReconciliation(this.options.state)
    if (reconciliation && reconciliation.phase !== 'complete') return
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
    const inventory = await LocalPaths.forFile(this.options.fs, item.path, this.options.state)
    if (inventory.blocked(item.path)) return
    try {
      item = { ...item, path: inventory.resolve(item.path, 'file') }
    } catch (error) {
      // The ordinary core scan reports aliases; first-contact preservation must not
      // select or overwrite one of them before that scan has run.
      if ((error as { code?: string }).code === 'path_taken') return
      throw error
    }
    const absent = Reflect.get(this.options.fs, Symbol.for('abele.sync.index-absent-v1'))
    if (identity === null && absent && (await absent.call(this.options.fs, item.path))) return
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
    const copyName =
      stem + ' (Conflicted copy local ' + before.mtime + ' ' + hash.slice(0, 12) + ')' + ext
    const copy = (await LocalPaths.forPath(this.options.fs, copyName, this.options.state)).resolve(
      copyName,
      'file'
    )
    const work = async () => {
      this.assertHeld()
      await this.assertJoinPlacement(item.path)
      await this.assertJoinPlacement(copy)
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
      await this.assertJoinPlacement(item.path)
      await this.options.fs.writeAtomic(item.path, incoming, item.mtime)
      this.trace.written(item.path)
    }
    const lease = (this.options.fs as FileSystem & { [key: symbol]: unknown })[
      Symbol.for('abele.sync.placement-v1')
    ] as ((paths: string[], work: () => Promise<void>) => Promise<void>) | undefined
    await (lease ? lease([item.path, copy], work) : work())
  }
  private async assertJoinPlacement(path: string): Promise<void> {
    const inventory = await LocalPaths.forPath(this.options.fs, path, this.options.state)
    if (inventory.blocked(path) || inventory.resolve(path, 'file') !== path)
      throw new EngineError('conflict', 'First-connection placement has a normalization collision')
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
    const copyName =
      stem + ' (Conflicted copy local ' + before.mtime + ' ' + local.sha.slice(0, 12) + ')' + ext
    const copy = (await LocalPaths.forPath(fs, copyName, this.options.state)).resolve(
      copyName,
      'file'
    )
    const work = async () => {
      this.assertHeld()
      await this.assertJoinPlacement(item.path)
      await this.assertJoinPlacement(copy)
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
      await this.assertJoinPlacement(item.path)
      await incomingStage.commit(this.requests.signal)
      this.trace.written(item.path)
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
        (this.options.uploadAllowed && !this.options.uploadAllowed(path)) ||
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
      paths: [
        ...new Set(
          paths
            .filter((path): path is string => path !== null)
            .map((path) => this.placement?.toLocal(path) ?? path)
        ),
      ],
    }
  }
  async start(): Promise<void> {
    if (this.rootIssue) return
    await this.refreshHolds()
    this.assertHeld()
    await this.outbox.restore()
    this.engine.start()
  }
  /** Starting a retry does not prove reachability; only a completed exchange clears offline. */
  get available(): boolean {
    return this.serverAvailable
  }
  private async checkRoot(): Promise<void> {
    if (
      !this.rootIssue &&
      this.options.rootExists &&
      (await this.options.state.getCursor()) > 0 &&
      !(await this.options.rootExists())
    )
      this.scopeRootGone({ kind: 'deleted' })
    this.assertHeld()
  }
  async sync(retryHeld = true): Promise<void> {
    await this.checkRoot()
    await this.refreshHolds()
    this.assertHeld()
    await this.syncThroughReviews()
    await this.outbox.drain(retryHeld)
  }
  private async publishRetainedCopies(): Promise<void> {
    if (!this.options.retainedChanged) return
    const items: ConnectionItem[] = []
    for (const entry of await new RetainedShareCopies(this.options.state).read()) {
      if (this.client.includes(entry.wirePath)) continue
      const stat = await this.options.fs.stat(entry.path)
      if (!stat) continue
      const fingerprint = await fingerprintFile(this.options.fs, entry.path, sha256)
      const edited = fingerprint.sha === entry.sha && fingerprint.size === entry.size ? 0 : 1
      const physical = this.placement?.toLocal(entry.path) ?? entry.path
      items.push({
        id: 'retained:' + this.options.id + ':' + entry.fileId,
        kind: 'file',
        path: physical,
        state: { kind: 'detached' },
        files: 1,
        edited,
        kept: !edited && (await this.options.covers(physical)) ? 1 : 0,
      })
    }
    this.options.retainedChanged(items)
  }
  async removeRetainedCopy(id: string): Promise<void> {
    await this.engine.runExclusive(async () => {
      this.assertHeld()
      const retained = new RetainedShareCopies(this.options.state)
      const entry = (await retained.read()).find(
        (one) => 'retained:' + this.options.id + ':' + one.fileId === id
      )
      if (!entry || this.client.includes(entry.wirePath))
        throw new Error('This file is shared again; its copy is kept')
      const work = async () => {
        this.assertHeld()
        const physical = this.placement?.toLocal(entry.path) ?? entry.path
        if (await this.options.covers(physical))
          throw new Error('Another connection still shares this file; its copy is kept')
        const before = await this.options.fs.stat(entry.path)
        if (!before) {
          await retained.forget(entry.fileId)
          return
        }
        const fingerprint = await fingerprintFile(this.options.fs, entry.path, sha256)
        const latest = await this.options.fs.stat(entry.path)
        if (
          fingerprint.sha !== entry.sha ||
          fingerprint.size !== entry.size ||
          !latest ||
          latest.mtime !== before.mtime ||
          latest.size !== before.size
        )
          throw new Error('This file was edited here; its copy is kept')
        await this.options.fs.remove(entry.path)
        await retained.forget(entry.fileId)
      }
      const placement = Reflect.get(this.options.fs, PLACEMENT) as
        | ((paths: string[], work: () => Promise<void>, preserve: boolean) => Promise<void>)
        | undefined
      await (placement ? placement([entry.path], work, false) : work())
      await this.publishRetainedCopies()
    })
  }
  /** A run an approved installation stopped on purpose is not the caller's failure: an
   * offline error while installing (the engine's own `sync stopped` included) waits for the
   * installation and its restarted engine, then asks again and returns that run's result. */
  private yieldedForReview(error: unknown, since = this.reviewInterruptions): boolean {
    return (
      error === this.reviewYielded ||
      (error instanceof EngineError &&
        error.code === 'offline' &&
        (this.reviewYield > 0 || this.reviewInterruptions !== since))
    )
  }
  private async syncThroughReviews(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const since = this.reviewInterruptions
      try {
        await this.engine.sync()
        return
      } catch (error) {
        if (attempt >= 3 || !this.active || !this.yieldedForReview(error, since)) throw error
        console.debug('[abele-sync] sync yielded to an approved installation; syncing again')
        await this.reviewApplications
        this.assertHeld()
      }
    }
  }
  private async fingerprintForUpload(fs: FileSystem, path: string) {
    const fingerprint = Reflect.get(fs, FINGERPRINT_UPLOAD) as
      | undefined
      | ((
          path: string,
          consume: (identity: { size: number; sha: string }, source: ChunkSource) => Promise<void>,
          signal: AbortSignal,
          acknowledged: (identity: { size: number; sha: string }) => boolean
        ) => Promise<unknown>)
    if (!fingerprint) return undefined
    const pending = this.uploadFingerprints.get(path)
    if (pending !== undefined) return pending
    const work = this.transferBudget.run(() =>
      fingerprint.call(
        fs,
        path,
        async (identity: { size: number; sha: string }, source: ChunkSource) => {
          this.assertHeld()
          if (await this.client.hasBlob(identity.sha)) return
          this.assertHeld()
          await this.client.putBlobSource(
            identity,
            source,
            this.requests.signal,
            this.transferBudget.maxChunkBytes
          )
          this.wholeReadUploads.add(identity.sha)
          this.uploadEntitlements.add(identity.sha)
        },
        this.requests.signal,
        (identity: { sha: string }) => this.wholeReadUploads.has(identity.sha)
      )
    )
    this.uploadFingerprints.set(path, work)
    try {
      return await work
    } finally {
      this.uploadFingerprints.delete(path)
    }
  }
  async reconcile(): Promise<void> {
    this.assertHeld()
    await this.engine.reconcile()
  }
  invalidate(): void {
    this.active = false
    this.pendingFolders.clear()
    this.progress.clear()
    this.folderProgress.clear()
    this.unroot?.()
    this.unroot = undefined
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
      (!this.placement ||
        path === this.placement.local ||
        path.startsWith(this.placement.local + '/')) &&
      this.client.includes(this.placement?.toServer(path) ?? path) &&
      !(!this.isRoot() && configurationPath(path, this.options.paths))
    )
  }
  acceptsLocal(path: string, size: number): boolean {
    return this.covers(path) && !this.localExcluded(this.placement?.toServer(path) ?? path, size)
  }
  private localExcluded(path: string, size: number): boolean {
    if (this.outsideScope(path)) return true
    path = this.placement?.toLocal(path) ?? path
    return (
      (this.ignore?.ignores(path) ?? false) ||
      (!this.isRoot() && configurationPath(path, this.options.paths)) ||
      isExcluded(path, size, this.selective, this.options.paths?.scriptsFolder ?? 'Scripts')
    )
  }
  async pathFor(fileId: string): Promise<string | null> {
    const path = (await this.options.state.byFileId(fileId))?.path
    return path ? (this.placement?.toLocal(path) ?? path) : null
  }
  async entryFor(path: string) {
    path = this.placement?.toServer(path) ?? path
    const exact = await this.options.state.get(path)
    if (exact) return this.placement?.localMetadata(exact) ?? exact
    const key = path.normalize('NFC')
    let match = null
    for await (const entry of this.options.state.all()) {
      if (entry.wirePath === key) {
        if (match) return null
        match = entry
      }
    }
    return match ? (this.placement?.localMetadata(match) ?? match) : null
  }
  historyClient(): V2EngineClient {
    if (!this.placement) return this.client
    const placement = this.placement
    return new Proxy(this.client, {
      get(target, key) {
        const value = Reflect.get(target, key)
        if (['versions', 'trash', 'restore', 'restoreDeleted'].includes(String(key)))
          return async (...args: unknown[]) =>
            placement.localMetadata(await value.apply(target, args))
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  localPath(path: string): string {
    return this.placement?.toLocal(path) ?? path
  }
  async heldDeletes() {
    const held = await this.engine.heldDeletes()
    return this.placement?.localMetadata(held) ?? held
  }
  decideDeletes(kind: 'confirm' | 'restore', ids: readonly string[]) {
    return this.actions.decideDeletes(kind, ids)
  }
  async deferred() {
    const deferred = await this.engine.deferred()
    return this.placement?.localMetadata(deferred) ?? deferred
  }
  applyDeferred(ids: readonly string[]) {
    return this.actions.applyDeferred(ids)
  }
  keepLocal(paths: string[] | undefined, ids: readonly string[]) {
    return this.engine.keepLocal(
      paths?.map((path) => this.placement?.toServer(path) ?? path),
      ids
    )
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
    await this.syncThroughReviews()
  }
  publications() {
    return this.outbox.state()
  }
  private applyReviewed(work: () => Promise<void>): Promise<void> {
    const next = this.reviewApplications.then(() => this.applyReviewedNow(work))
    this.reviewApplications = next.catch(() => {})
    return next
  }
  private async applyReviewedNow(work: () => Promise<void>): Promise<void> {
    // Yield blocked reads through the engine scheduler; issued writes still settle.
    // Restarting preserves the engine's pause state and resumes the retained pull.
    const interrupted = this.engine.status.state === 'syncing'
    if (interrupted) {
      this.reviewYield++
      this.reviewInterruptions++
    }
    try {
      if (interrupted) {
        // Manifest reads stage review metadata in the host, so core waits for them
        // like writes. Cancel only their network wait, before response processing.
        for (const request of this.readRequests) request.abort()
        await this.engine.stop()
      }
      await this.engine.runExclusive(work)
      await this.refreshHolds()
    } finally {
      if (interrupted) this.reviewYield--
      if (interrupted && this.active && !this.rootIssue) this.engine.start()
    }
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
    await this.applyReviewed(async () => {
      this.assertHeld()
      const key = 'token-reviewed-apply:' + candidate.id
      if (await this.options.state.getMeta(key)) return
      if (!(await this.options.reviews.executables.state()).some((one) => one.id === candidate.id))
        throw new EngineError('lost', 'Review belongs to a retired server generation')
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
  }
  private async applyDirectory(candidate: ExecutableCandidate, fs: FileSystem): Promise<void> {
    const work = async () => {
      const local = new V2EngineClient(this.options.encoded, {
        item: this.options.item,
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
