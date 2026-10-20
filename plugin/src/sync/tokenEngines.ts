import { connectionAdapter, connectionInspectionApp, connectionJournalApp } from './connectionScope'
import { connectionPrivateRoot } from './connectionPaths'
import { vaultDisk, releaseVaultPathGuard } from './vaultPathLinks'
import { Platform, type App, type EventRef } from 'obsidian'
import { caseKey } from '@abele/sync-sdk/protocol'
import {
  V2EngineClient,
  GENERATION_KEY,
  reconcileGeneration,
  fenceRestoredJournal,
  type EngineStatus,
  type SyncReport,
} from '@abele/sync-sdk/core'
import { RESTORE_HEADER, fenceHostGeneration, assertResponseGeneration } from './restoreFence'
import { ConnectionEngines, type ConnectionRuntime } from './connectionEngines'
import { TokenEngineRuntime } from './tokenEngineRuntime'
import type { TokenConnectionRecord } from './tokenConnectionRegistry'
import { TokenUi, connectionError, connectStage, failureDetails } from './tokenUi'
import {
  factoryOf,
  transportOf,
  socketOf,
  fallbackMsOf,
  pollMsOf,
  type SyncServiceDeps,
} from './environment'
import { pendingTeardown, recordTeardown } from './teardownBarrier'
import { RuntimeFence } from './external/recovery'
import { ObsidianFileSystem } from './ObsidianFileSystem'
import { coordinatedFileSystem, pathCoordinatorOf } from './pathCoordinator'
import { editCopiesOf } from './editCopies'
import { transferBudgetOf } from './transferBudget'
import { registerConnectionEditCopies } from './editCopyStore'
import { openTokenLedger } from './tokenLedger'
import { reviewSourceOf } from './reviewState'
import {
  requireExternalLifecycleSafety,
  requireExternalEnrollmentSafety,
  recoverExternalState,
  activeExternalDocuments,
} from './external/pluginSafety'
import { tokenOffloadsOf } from './tokenOffloadCoordinator'
import { tokenOffloadConnection } from './tokenOffloadConnection'
import { tokenExternalBinding } from './tokenExternalBinding'
import { TokenSettingsPort } from './tokenSettingsPort'
import { TokenAttachmentHost } from './tokenAttachmentHost'
import type { IndexedDbStateStore } from './IndexedDbStateStore'
import { readIgnore, ignoreFor, scopeKey, withinSyncPath } from './scope'
import { OwnSettingsWatch } from './ownSettings'
import { ExternalFileActions } from './external/fileActions'
import { externalActionsOf } from './external/actionHost'
import { devicePins } from './external/devicePins'
import { watchScopeRoot } from './scopeRoot'
import { LocalFolderPlacement } from './localFolderPlacement'
import { inspectFolder } from './verifyFolderSet'
import { localGroupCandidates } from './localGroupCandidates'
import { removeDetachedCopies } from './removeDetachedCopies'
import { RetainedShareCopies } from './retainedShareCopies'
import { fingerprintFile } from '@abele/sync-sdk/core'
import { sha256 } from './external/hash'

/** One native host, independent durable engines, and one vault-wide placement coordinator. */
export class TokenEngines {
  private readonly engines = new ConnectionEngines()
  private readonly live = new Map<string, TokenEngineRuntime>()
  private readonly pending = new Set<string>()
  private readonly retries = new Map<string, (assertCurrent: () => void) => Promise<void>>()
  private readonly startupCancels = new Map<string, () => void>()
  private readonly activityEpoch = new Map<string, number>()
  private readonly activityReports = new Map<string, number>()
  private readonly offloadPorts = new Map<
    string,
    Awaited<ReturnType<typeof tokenOffloadConnection>>
  >()
  private closed = false
  private closing: Promise<void> | undefined
  private rebuilding: Promise<void> = Promise.resolve()
  private readonly localFiles: TokenAttachmentHost
  private readonly renameEvent: EventRef
  constructor(
    private readonly app: App,
    private readonly ui: TokenUi,
    private readonly key: (reference: string) => string | null,
    private readonly deps: SyncServiceDeps = {},
    private scriptsFolder = 'Scripts',
    private readonly ownSettings?: { path: string; arrived(): void }
  ) {
    ui.itemSets.install()
    ui.itemSets.copyCounts = (id) => this.detachedCopies(id, false)
    ui.itemSets.removeLocal = async (id) => {
      await this.detachedCopies(id, true)
    }
    externalActionsOf.set(app.vault, this)
    this.localFiles = new TokenAttachmentHost(app, (path) =>
      tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault)).isOffloaded(path)
    )
    this.renameEvent = app.vault.on('rename', (file, from) => {
      this.localFiles.renamed(from, file.path)
      const pins = this.devicePins()
      const moved = pins.map((path) =>
        caseKey(path) === caseKey(from) || caseKey(path).startsWith(caseKey(from) + '/')
          ? file.path + path.slice(from.length)
          : path
      )
      if (JSON.stringify(moved) !== JSON.stringify(pins)) this.saveDevicePins(moved)
      for (const runtime of this.live.values()) runtime.localRenamed(from, file.path)
    })
    ui.connectionsChanged = async (assertCurrent) => {
      assertCurrent?.()
      this.start()
      // Enrollment supplies its cancellation check and detaches startup. Settings
      // writers and recovery callers need the completed startup outcome.
      if (!assertCurrent) await this.engines.settled()
    }
    ui.disconnectRuntime = async (id) => {
      await this.engines.remove(id)
      TokenSettingsPort.forget(ui, id)
      this.activityEpoch.delete(id)
      this.activityReports.delete(id)
    }
    ui.stopRuntime = async (id) => {
      // Remote-only files still need authenticated hydration before requests are aborted.
      // This preparation shares the bounded deletion wait and retains every recovery guard.
      await this.offloadPorts.get(id)?.prepareDisconnect()
      // Abort network work, but keep the host's ownership and recovery ports until the
      // writer drains and departure safety is checked. Only disconnect removes the host.
      const runtime = this.live.get(id)
      if (runtime) {
        await runtime.disconnect()
        ui.runtimes.delete(id)
      } else await this.engines.remove(id)
    }
    ui.connectionForgotten = async (id) => {
      await this.engines.remove(id)
      if (ui.registry.records().length === 0) releaseVaultPathGuard(this.app.vault)
    }
    ui.retryConnection = async (id, assertCurrent) => {
      assertCurrent()
      const state = ui.registry.records().find((one) => one.id === id)?.state
      if (
        state?.['abele-sync-token-state:server-delete'] ||
        state?.['abele-sync-token-state:scope-deleted']
      )
        throw new Error('Server deletion is awaiting confirmation; this connection cannot restart.')
      const retry = this.retries.get(id)
      if (retry) await retry(assertCurrent)
      else await ui.connectionsChanged(assertCurrent)
    }
    ui.connectionChangeGuard = async (id, assertCurrent = () => {}, scope) => {
      assertCurrent()
      if (this.closed) throw new Error('Connection host closed; recovery required')
      if (!id) {
        // A new connection owns no durable recovery work yet.
        const journalApp = connectionJournalApp(this.app, crypto.randomUUID())
        const root = scope?.kind === 'folder' && scope.path !== '/' ? scope.path : undefined
        const app = root
          ? connectionInspectionApp(
              journalApp,
              connectionAdapter(vaultDisk(this.app.vault), root, root),
              root
            )
          : journalApp
        requireExternalEnrollmentSafety(app)
        await requireExternalLifecycleSafety(
          app,
          factoryOf(this.deps),
          undefined,
          true,
          undefined,
          assertCurrent,
          {},
          false,
          true
        )
        return
      }
      const record = this.ui.registry.records().find((one) => one.id === id)
      const root =
        record?.scope?.kind === 'folder' ? (record.localRoot ?? record.scope.path) : undefined
      const scopedApp =
        root && root !== '/'
          ? connectionInspectionApp(
              connectionJournalApp(this.app, id),
              connectionAdapter(vaultDisk(this.app.vault), root, connectionPrivateRoot(id)),
              root,
              connectionPrivateRoot(id)
            )
          : connectionJournalApp(this.app, id)
      const inspecting = this.startupCancels.has(id) && !ui.runtimes.has(id)
      if (id) await this.offloadPorts.get(id)?.prepareDisconnect()
      await requireExternalLifecycleSafety(
        scopedApp,
        factoryOf(this.deps),
        undefined,
        true,
        id ? this.ui.registry.records().find((one) => one.id === id)?.ledgerId : undefined,
        assertCurrent,
        {},
        !inspecting
      )
      assertCurrent()
      if (this.closed) throw new Error('Connection host closed; recovery required')
      if (inspecting) this.startupCancels.get(id)?.()
    }
  }
  updateScriptsFolder(folder: string): Promise<void> {
    const work = this.rebuilding.then(async () => {
      if (this.closed || folder === this.scriptsFolder) return
      await this.engines.reset()
      if (this.closed) return
      this.scriptsFolder = folder
      this.ui.reviews?.executables.updatePaths({ scriptsFolder: folder })
      this.ui.reviews?.attachments.updatePaths({ scriptsFolder: folder })
      this.announce()
      this.start()
      await this.engines.settled()
    })
    // A failed drain remains a recovery barrier rather than opening a new engine over it.
    this.rebuilding = work
    return work
  }
  /** Cold-start links wait before Obsidian has finished indexing the vault. */
  announce(): void {
    if (this.closed) return
    for (const record of this.ui.registry.records())
      if (
        record.secretReference &&
        !record.paused &&
        record.scope &&
        !record.pending &&
        record.status !== 'needs-token' &&
        !record.state['abele-sync-token-state:scope-deleted'] &&
        !record.state['abele-sync-token-state:server-delete']
      )
        this.ui.registry.setStatus(record.id, 'joining')
    this.ui.refresh()
  }
  presentReviews(): void {
    if (this.closed) return
    for (const id of this.live.keys()) {
      const port = TokenSettingsPort.forConnection(this.ui, id, this.app)
      port.heldPrompt.foreground()
      port.settingsPrompt.foreground()
    }
  }
  /** Resume/pocket events share the same engine operations as explicit Sync now. */
  async foreground(visible: boolean): Promise<void> {
    if (this.closed) return
    if (visible && (await this.ui.itemSets.refreshAll())) {
      this.start()
      await this.engines.settled()
    }
    if (visible) this.presentReviews()
    if (!Platform.isMobile) return
    await Promise.all(
      [...this.live].map(async ([id, runtime]) => {
        if (this.ui.registry.records().find((record) => record.id === id)?.paused) return
        try {
          await runtime.sync()
        } catch (error) {
          this.failed(id, error)
        }
      })
    )
  }
  start(): void {
    if (this.closed) return
    void this.ui.itemSets
      .refreshAll()
      .then((changed) => {
        if (changed && !this.closed) this.start()
      })
      .catch((error) => console.debug('[Abele Sync items]', error))
    const teardown = pendingTeardown(this.app)
    const documents = teardown.then(() => activeExternalDocuments(this.app, factoryOf(this.deps)))
    const beforeOpening = documents.then(async (found) => {
      const manager = tokenOffloadsOf(this.app.vault, pathCoordinatorOf(this.app.vault))
      for (const document of found) {
        if (this.closed) return
        manager.remember(
          document.ledgerId,
          document.files
            .filter((one) => one.representation !== 'hydrated')
            .flatMap((one) =>
              one.lastProvenLocalBase
                ? [
                    {
                      path: one.lastProvenLocalBase.path,
                      size: one.lastProvenLocalBase.size,
                      mtime: one.lastProvenLocalBase.mtime,
                    },
                  ]
                : []
            ),
          [
            ...document.files.flatMap((one) => (one.projectionPath ? [one.projectionPath] : [])),
            ...document.operations.flatMap((one) =>
              one.ownedArtifacts.map((artifact) => artifact.path)
            ),
          ]
        )
      }
    })
    // Stages consume these barriers independently; observe rejection immediately.
    void documents.catch(() => {})
    void beforeOpening.catch(() => {})
    const records = this.ui.registry
      .records()
      .filter(
        (one) =>
          one.secretReference &&
          one.scope &&
          !this.ui.itemSets.store.forRecord(one.id)?.item.detached &&
          !one.pending &&
          one.status !== 'needs-token' &&
          !one.state['abele-sync-token-state:scope-deleted'] &&
          !one.state['abele-sync-token-state:server-delete']
      )
    this.engines.start(
      records.map((one) => one.id),
      (id) =>
        this.create(
          records.find((one) => one.id === id),
          { teardown, documents, ready: beforeOpening }
        ),
      (id, error) => this.failed(id, error)
    )
    this.refreshDestinations()
  }
  private failed(id: string, error: unknown): void {
    if (this.closed || !this.ui.registry.records().some((one) => one.id === id)) return
    const code = (error as { code?: string })?.code
    if (code === 'forbidden' || code === 'scope_removed')
      void this.ui.itemSets.refreshAll().then((changed) => {
        if (changed && !this.closed) this.start()
      })
    if (code === 'startup-cancelled') return
    if (
      code !== 'scope_deleted' &&
      this.ui.registry.records().find((one) => one.id === id)?.state[
        'abele-sync-token-state:scope-deleted'
      ]
    )
      return
    if (code === 'scope_deleted') {
      this.ui.registry.storage(id).saveLocalStorage('abele-sync-token-state:scope-deleted', true)
      void this.live
        .get(id)
        ?.pause(true)
        .catch(() => {})
    }
    this.ui.finishStartup(id, 'failed')
    this.ui.registry.setStatus(
      id,
      code === 'unauthorized' || code === 'forbidden'
        ? 'needs-token'
        : code === 'scope_updating' || code === 'scope_unavailable' || code === 'scope_deleted'
          ? code === 'scope_deleted'
            ? 'scope_unavailable'
            : code
          : code === 'offline' || code === 'unreachable'
            ? 'offline'
            : 'error'
    )
    const failure = {
      stage: this.ui.activity.value[id]?.startup?.stage,
      ...failureDetails(error),
      message: error instanceof Error ? error.message : (JSON.stringify(error) ?? 'unknown'),
    }
    console.debug('[Abele Sync failure]', id, failure)
    this.ui.publish(id, {
      error: connectionError(error, !this.ui.runtimes.has(id)),
      failure,
      inspection: undefined,
    })
  }
  private create(
    record: TokenConnectionRecord,
    beforeOpening: { teardown: Promise<void>; documents: Promise<unknown>; ready: Promise<void> }
  ): ConnectionRuntime {
    record.localRoot = this.ui.registry.pinLocalRoot(record.id)
    let active = true,
      runtime: TokenEngineRuntime | undefined
    let closeStore: (() => void) | undefined,
      closeCopies: (() => void) | undefined,
      unbind: (() => void) | undefined
    let stateHandle: IndexedDbStateStore | undefined
    let opening: Promise<IndexedDbStateStore> | undefined
    const credential = this.key(record.secretReference)
    let fence: RuntimeFence | undefined
    const claim = () =>
      new RuntimeFence(
        this.app,
        record.ledgerId,
        () =>
          active &&
          !this.closed &&
          (!stateHandle || stateHandle.permitsEngineEffects) &&
          this.key(record.secretReference) === credential &&
          this.ui.registry
            .records()
            .some(
              (one) =>
                one.id === record.id &&
                one.ledgerId === record.ledgerId &&
                one.secretReference === record.secretReference &&
                one.address === record.address &&
                one.spaceId === record.spaceId &&
                one.tokenId === record.tokenId &&
                one.scope?.kind === record.scope?.kind &&
                one.scope?.id === record.scope?.id
            )
      )
    let starting: Promise<void> | undefined
    let draining: Promise<void> | undefined
    let startup = new AbortController()
    const cancel = () => {
      const error = Object.assign(new Error('Vault inspection cancelled'), {
        code: 'startup-cancelled',
      })
      startup.abort(error)
      this.ui.finishStartup(record.id, 'cancelled')
      active = false
      runtime?.invalidate()
      fence?.release()
      unbind?.()
      this.live.delete(record.id)
    }
    const assertActive = () => {
      startup.signal.throwIfAborted()
      if (!active || this.closed) throw new Error('Sync startup cancelled')
      fence?.assertOwned()
    }
    const stage = async <T>(
      name: string,
      work: () => Promise<T>,
      progressing = false
    ): Promise<T> => {
      assertActive()
      this.ui.startupStage(record.id, name)
      let timer: number | undefined
      let cancelWait: (() => void) | undefined
      try {
        let result: T
        if (!progressing) {
          let workError: unknown
          try {
            result = await connectStage(
              name,
              `${name} could not finish starting sync. Try Sync now again.`,
              async () => {
                assertActive()
                let value: T
                try {
                  value = await work()
                } catch (error) {
                  assertActive()
                  workError = error
                  throw error
                }
                assertActive()
                return value
              },
              startup.signal
            )
          } catch (error) {
            // Keep the diagnostic failure for recovery callers; timeout/cancel
            // still wins over a late failure from revoked work.
            if (workError !== undefined && !startup.signal.aborted) throw workError
            throw error
          }
        } else {
          result = await Promise.race([
            work(),
            new Promise<never>((_, reject) => {
              cancelWait = () => {
                const reason: unknown = startup.signal.reason
                reject(reason instanceof Error ? reason : new Error('Sync startup cancelled'))
              }
              startup.signal.addEventListener('abort', cancelWait, { once: true })
              if (startup.signal.aborted) cancelWait()
              const check = () => {
                const current = this.ui.activity.value[record.id]?.startup
                const remaining = 120000 - (Date.now() - (current?.progressAt ?? Date.now()))
                if (remaining <= 0) {
                  const error = Object.assign(
                    new Error(`${current?.stage ?? name} stalled. Try Sync now again.`),
                    { code: 'startup-stage' }
                  )
                  startup.abort(error)
                  reject(error)
                } else timer = window.setTimeout(check, Math.min(1000, remaining))
              }
              timer = window.setTimeout(check, 1000)
            }),
          ])
        }
        assertActive()
        this.ui.finishStartup(record.id, 'complete')
        return result
      } finally {
        window.clearTimeout(timer)
        if (cancelWait) startup.signal.removeEventListener('abort', cancelWait)
      }
    }
    const start = async () => {
      await stage('Waiting for previous sync', () => beforeOpening.teardown)
      await stage('Reading offloaded file records', async () => {
        await beforeOpening.documents
        await beforeOpening.ready
        assertActive()
      })
      if (!active || this.closed) return
      fence = claim()
      this.pending.add(record.id)
      this.refreshDestinations()
      const key = this.key(record.secretReference)
      if (!key || !record.scope) throw new Error('Connection needs its token')
      let localRoot = this.ui.registry.pinLocalRoot(record.id)
      const scopedRoot = record.scope.kind === 'folder' && localRoot !== '/' ? localRoot : undefined
      const adapter = scopedRoot
        ? connectionAdapter(
            vaultDisk(this.app.vault),
            () => localRoot,
            connectionPrivateRoot(record.id)
          )
        : vaultDisk(this.app.vault)
      const journalApp = connectionJournalApp(this.app, record.id)
      const connectionApp = scopedRoot
        ? connectionInspectionApp(
            journalApp,
            adapter,
            () => localRoot,
            connectionPrivateRoot(record.id)
          )
        : journalApp

      let inventory: ReadonlyMap<string, { path: string; size: number; mtime: number }> | undefined
      const inspection = {
        scope: scopedRoot,
        inventory: (files: typeof inventory) => {
          inventory = files
        },
        signal: startup.signal,
        stage: (name: string) => {
          assertActive()
          this.ui.startupStage(record.id, name)
        },
        inventoryProgress: (completed: number, total: number) => {
          assertActive()
          this.ui.startupProgress(record.id, completed, total)
        },
        progress: (completed: number, total: number) => {
          assertActive()
          this.ui.inspectionProgress(record.id, completed, total)
        },
      }
      await stage(
        'Checking recovery records',
        () =>
          requireExternalLifecycleSafety(
            connectionApp,
            factoryOf(this.deps),
            undefined,
            true,
            undefined,
            assertActive,
            inspection,
            false,
            true,
            true
          ),
        true
      )
      assertActive()
      const state = await stage('Opening sync storage', async () => {
        opening = openTokenLedger(factoryOf(this.deps), this.ui.registry, record, assertActive)
        const opened = await opening
        if (startup.signal.aborted) {
          opened.close()
          assertActive()
        }
        return opened
      })
      stateHandle = state
      closeStore = () => state.close()
      assertActive()
      state.onRecoveryRequired((error) => {
        active = false
        fence?.release()
        this.failed(record.id, error)
      })
      state.onClosedElsewhere(() => {
        active = false
        fence?.release()
        this.failed(record.id, new Error('Connection opened elsewhere'))
      })
      const own = new OwnSettingsWatch(
        this.ownSettings?.path ?? `${this.app.vault.configDir}/plugins/abele/data.json`,
        () => this.ownSettings?.arrived()
      )
      const binding = await stage('Checking connection identity', () =>
        tokenExternalBinding(record, key)
      )
      assertActive()
      const groupCandidates = new Set<string>([record.scope.path.normalize('NFC')])
      let localCandidates = new Set<string>()
      if (record.scope.kind === 'group')
        for await (const entry of state.all()) groupCandidates.add(entry.path.normalize('NFC'))
      let discoveryScope = record.scope
      const externalPlacement =
        record.scope.kind === 'folder' && record.scope.path !== '/'
          ? new LocalFolderPlacement(record.scope.path, localRoot)
          : undefined
      const discoveryRoots = record.scope.kind === 'folder' ? [localRoot] : []
      const discovery =
        record.scope.kind === 'folder' && record.scope.path === '/'
          ? undefined
          : {
              roots: discoveryRoots,
              includes: (path: string) =>
                discoveryScope.kind === 'folder'
                  ? path === localRoot || path.startsWith(localRoot + '/')
                  : groupCandidates.has(path.normalize('NFC')) ||
                    localCandidates.has(path.normalize('NFC')),
            }
      const ordinary = new ObsidianFileSystem(this.app, {
        adapter,
        connectionId: scopedRoot ? record.id : undefined,
        journalOwner: record.id,
        diagnostic: (operation, startedAt, outcome, paths) =>
          runtime?.trace.record(operation, startedAt, outcome, paths),
        fileScope: () =>
          runtime ? runtime.folderScope() : record.scope.kind === 'folder' ? localRoot : undefined,
        discovery,
        startupInventory: () => inventory,
        runtimeFence: fence,
        ledger: state,
        preserveEmptyDirectories: true,
        pollMs: pollMsOf(this.deps),
        onEngineWrite: (path) => {
          own.noteWrite(path)
          runtime?.written(path)
        },
      })
      if (ordinary.needsRecoveryHandshake() || (await state.getExternalState()) !== null)
        await stage('Checking server restore generation', async () => {
          const transport = transportOf(this.deps)
          const client = new V2EngineClient(this.ui.itemSets.encoded(record), {
            item: this.ui.itemSets.store.forRecord(record.id)?.item.id,
            fetch: async (input, init) => {
              assertActive()
              const connection =
                new URL(
                  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
                ).pathname === '/v2/connection'
              const headers = new Headers(init?.headers)
              const expected = await state.getMeta(GENERATION_KEY)
              if (!connection && expected) headers.set(RESTORE_HEADER, expected)
              const response = await transport(input, {
                ...init,
                headers,
                signal: startup.signal,
              })
              assertActive()
              if (!connection) assertResponseGeneration(response, expected)
              if (response.ok && connection) {
                const generation = response.headers.get(RESTORE_HEADER)
                await fenceHostGeneration(
                  state,
                  generation,
                  (archive) => ordinary.retireGeneration(generation, archive),
                  async (archive) => {
                    const reviews = this.ui.reviews?.executables
                    if (!reviews) return
                    await archive(
                      (await reviews.state()).filter((one) => one.source.id === record.id)
                    )
                    await reviews.forgetSource(record.id)
                  }
                )
                await reconcileGeneration(state, generation ?? undefined)
              }
              return response
            },
          })
          const head = await client.state()
          await fenceRestoredJournal(state, head.head_seq, ordinary, undefined, client)
          await ordinary.fenceRecovery(state, head.head_seq)
        })
      await stage('Recovering local files', () => ordinary.recover())
      // Validate retained recovery bytes here. recoverExternalState below owns the
      // single full projection inspection, including configuration/control files.
      await stage(
        'Checking retained recovery bytes',
        () =>
          requireExternalLifecycleSafety(
            connectionApp,
            factoryOf(this.deps),
            undefined,
            true,
            undefined,
            assertActive,
            inspection,
            false,
            false,
            false,
            true
          ),
        true
      )
      await stage(
        'Checking saved sync state',
        async () => {
          const scopedInspection: import('./external/pluginSafety').ProjectionInspection = {
            ...inspection,
          }
          if (!(record.scope.kind === 'folder' && record.scope.path === '/')) {
            scopedInspection.roots = record.scope.kind === 'folder' ? [localRoot] : []
            const paths: string[] = []
            if (record.scope.kind === 'group')
              for await (const entry of state.all()) paths.push(entry.path)
            scopedInspection.paths = paths
            // Runtime discovery also incorporates server-named group members.
            if (record.scope.kind === 'group') scopedInspection.inventory = undefined
          }
          return recoverExternalState(
            connectionApp,
            state,
            record.ledgerId,
            record.ledgerId,
            binding,
            fence,
            factoryOf(this.deps),
            scopedInspection
          )
        },
        true
      )
      assertActive()
      this.ui.publish(record.id, { inspection: undefined })
      {
        assertActive()
        fence.activate()
        await ordinary.discardPrivateDownloads()
        const manager = tokenOffloadsOf(this.app.vault, pathCoordinatorOf(this.app.vault))
        const offloads = await stage('Preparing file access', () =>
          tokenOffloadConnection({
            app: connectionApp,
            factory: factoryOf(this.deps),
            state,
            ledgerId: record.ledgerId,
            binding,
            fence,
            // The filesystem filters before representation reads candidate prefixes.
            fs: ordinary,
            placement: externalPlacement,
            manager,
            scriptsFolder: () => this.scriptsFolder,
            client: () => runtime.client,
            available: () => runtime?.available ?? true,
            sync: () => runtime.sync(),
            includes: (path) =>
              runtime
                ? runtime.covers(path)
                : record.scope.kind === 'folder' &&
                  (record.scope.path === '/' || withinSyncPath(path, localRoot)),
            capture: (paths, fingerprint) =>
              editCopiesOf(this.app.vault).capture(ordinary, paths, fingerprint),
            rememberIdentity: (path) => this.localFiles.remember(path),
            hydratedIdentity: (path) => this.localFiles.hydrated(path),
          })
        )
        this.offloadPorts.set(record.id, offloads)
        assertActive()
        const fs = coordinatedFileSystem(
          offloads.fs,
          pathCoordinatorOf(this.app.vault),
          () => fence.assertReady(),
          async (paths) => {
            const capture = async () => {
              // placementFiles includes existing targets and descendants. An absent
              // path has no edit to archive; publication still rechecks it under the lease.
              const affected = new Set<string>()
              for await (const info of ordinary.placementFiles(paths)) affected.add(info.path)
              await editCopiesOf(this.app.vault).capture(ordinary, [...affected])
            }
            if (runtime) await runtime.trace.run('preserve local edit copies', capture, true)
            else await capture()
          }
        )
        if (!this.ui.reviews) throw new Error('Device reviews are not available')
        const current = this.ui.registry.records().find((one) => one.id === record.id)
        fence.assertReady()
        runtime = new TokenEngineRuntime({
          transferBudget: transferBudgetOf(this.app.vault),
          mobile: Platform.isMobile,
          id: record.id,
          localRoot,
          comparing: (comparison) => this.ui.publish(record.id, { comparison }),
          progress: (transfer) => this.ui.publish(record.id, { transfer, comparison: undefined }),
          event: (text) => this.ui.recordEvent(record.id, text),
          encoded: this.ui.itemSets.encoded(record),
          item: this.ui.itemSets.store.forRecord(record.id)?.item.id,
          retainedChanged: (items) => this.ui.itemSets.retainedChanged(record.id, items),
          uploadAllowed: (path) => {
            const physical = externalPlacement?.toLocal(path) ?? path
            return this.ui.itemSets.mayUpload(record.id, physical, (id, candidate) => {
              return id === record.id
                ? (runtime?.covers(candidate) ?? false)
                : !!this.live.get(id)?.covers(candidate)
            })
          },
          discoveryCandidates: (paths) => {
            for (const path of paths) groupCandidates.add(path.normalize('NFC'))
          },
          discoveryLocalCandidates: (paths) => {
            localCandidates = new Set(paths)
          },
          discoveryScope: (scope) => {
            this.ui.registry.setScopePath(record.id, scope.path)
            discoveryScope = scope
            if (externalPlacement) {
              externalPlacement.server = scope.path
              externalPlacement.local = localRoot
            }
            // VaultDirectories retains this array; update its roots before the
            // client's prepare/scan proceeds under the new authoritative path.
            discoveryRoots.splice(
              0,
              discoveryRoots.length,
              ...(scope.kind === 'folder' ? [localRoot] : [])
            )
          },
          fs,
          followRecoveredRoot: (from, to) => ordinary.followRecoveredRoot(from, to),
          localRootChanged: (path) => {
            this.ui.registry.setLocalRoot(record.id, path)
            localRoot = path
            if (externalPlacement) externalPlacement.local = path
            discoveryRoots.splice(0, discoveryRoots.length, path)
          },
          inspectRoot: (path) => inspectFolder(vaultDisk(this.app.vault), path),
          verifyRootFileSystem: (root) =>
            new ObsidianFileSystem(this.app, {
              adapter: connectionAdapter(
                vaultDisk(this.app.vault),
                root,
                connectionPrivateRoot(record.id)
              ),
              fileScope: root,
              connectionId: record.id,
              journalOwner: record.id,
              runtimeFence: fence,
            }),
          state,
          engineState: offloads.state,
          engineClient: offloads.client,
          preparePlacement: (paths) => manager.prepareIncoming(record.ledgerId, paths),
          recoverPlacement: () => ordinary.recover(),
          retirePlacement: (generation, archive) => ordinary.retireGeneration(generation, archive),
          fencePlacement: (head) => ordinary.fenceRecovery(state, head),
          scopeInput: async (selective) => {
            const text = await readIgnore(connectionApp)
            return {
              localCandidates:
                record.scope.kind === 'group'
                  ? localGroupCandidates(
                      discoveryScope.path,
                      this.app.vault.getMarkdownFiles().map((file) => ({
                        path: file.path,
                        groups: this.app.metadataCache.getFileCache(file)?.frontmatter?.groups,
                      }))
                    )
                  : record.scope.kind === 'file'
                    ? [discoveryScope.path]
                    : undefined,
              key: await scopeKey(selective, text),
              ignore: ignoreFor(this.app.vault.configDir, text),
            }
          },
          reviews: this.ui.reviews,
          fetch: transportOf(this.deps),
          WebSocket: socketOf(this.deps),
          paths: { scriptsFolder: this.scriptsFolder, configRoots: [this.app.vault.configDir] },
          paused: current.paused,
          rootIssue: current.rootIssue,
          serverRoot: current.serverRoot,
          serverRootChanged: (path) => this.ui.registry.setServerRoot(record.id, path),
          rootExists:
            record.scope.kind === 'folder' && record.scope.path !== '/'
              ? async () => (await vaultDisk(this.app.vault).stat(localRoot))?.type === 'folder'
              : undefined,
          watchRoot:
            record.scope.kind === 'folder'
              ? (notice) => {
                  const saved = this.ui.registry
                    .records()
                    .find((row) => row.id === record.id)?.rootIssue
                  return watchScopeRoot(
                    this.app,
                    saved?.kind === 'moved' ? saved.path : localRoot,
                    notice
                  )
                }
              : undefined,
          rootChanged: (issue) => {
            this.ui.registry.setRootIssue(record.id, issue)
            this.ui.publish(record.id, { inspection: undefined, comparison: undefined })
          },
          selective: current.selective,
          fallbackMs: fallbackMsOf(this.deps),
          expectedSource: reviewSourceOf(record),
          localFiles: this.localFiles,
          ownSettingsPath:
            this.ownSettings?.path ?? `${this.app.vault.configDir}/plugins/abele/data.json`,
          assertHeld: () => fence.assertReady(),
          publicationChanged: () => {
            if (runtime)
              void this.changed(record.id, runtime.engine.status).catch((error) =>
                this.failed(record.id, error)
              )
          },
          changed: (status, report) => {
            manager.changed()
            if (report) own.settle()
            void this.changed(record.id, status, report).catch((error) =>
              this.failed(record.id, error)
            )
          },
          failed: (error) => {
            own.settle()
            this.failed(record.id, error)
          },
          covers: async (path) =>
            [...this.live].some(([id, one]) => id !== record.id && one.covers(path)),
        })
        const copies = await stage('Opening edit history', () =>
          registerConnectionEditCopies(
            factoryOf(this.deps),
            editCopiesOf(this.app.vault),
            record.id,
            JSON.stringify([record.address, record.spaceId, record.tokenId, record.ledgerId]),
            externalPlacement?.localState(state) ?? state,
            (path, size) => runtime.acceptsLocal(path, size),
            () => fence.assertReady()
          )
        )
        closeCopies = copies.close
        assertActive()
        this.live.set(record.id, runtime)
        this.pending.delete(record.id)
        unbind = this.ui.bind(record.id, {
          scanSnapshot: () => runtime.trace.snapshot(),
          assertCurrent: () => fence.assertReady(),
          sync: () => runtime.sync(),
          reconcile: () => runtime.reconcile(),
          restoreRoot: () => runtime.restoreRoot(),
          followRoot: () => runtime.followRoot(),
          followServerRoot: () => runtime.followServerRoot(),
          removeRetainedCopy: (id) => runtime.removeRetainedCopy(id),
          pause: (paused) => runtime.pause(paused),
          updateSelective: (selective) => runtime.updateSelective(selective),
          opened: (path) => runtime.opened(path),
          resolve: (id) => runtime.resolve(id),
          publishAttachment: (id) => runtime.publishAttachment(id),
          historyClient: runtime.historyClient(),
          acceptsLocal: (path, size) => runtime.acceptsLocal(path, size),
          localPath: (path) => runtime.localPath(path),
          entryFor: (path) => runtime.entryFor(path),
          heldDeletes: () => runtime.heldDeletes(),
          decideDeletes: (kind, ids) => runtime.decideDeletes(kind, ids),
          deferred: () => runtime.deferred(),
          applyDeferred: (ids) => runtime.applyDeferred(ids),
          keepLocal: (paths, ids) => runtime.keepLocal(paths, ids),
          apply: (candidate, assertAllowed) => runtime.apply(candidate, assertAllowed),
          disconnect: async () => {
            active = false
            fence?.release()
            await runtime.disconnect()
            this.live.delete(record.id)
            unbind?.()
            closeCopies?.()
            closeStore?.()
            offloads.close()
            this.offloadPorts.delete(record.id)
            this.refreshDestinations()
          },
        })
        await stage('Starting file exchange', () => runtime.start())
      }
      this.startupCancels.delete(record.id)
    }
    const begin = () => {
      // Retry callbacks can outlive a deletion timeout or wait across its durable marker.
      // Check at the actual start boundary, before replacing any owned runtime or fence.
      const state = this.ui.registry.records().find((one) => one.id === record.id)?.state
      if (
        state?.['abele-sync-token-state:server-delete'] ||
        state?.['abele-sync-token-state:scope-deleted']
      )
        throw new Error('Server deletion is awaiting confirmation; this connection cannot restart.')
      active = true
      fence = undefined
      stateHandle = undefined
      runtime = undefined
      closeStore = undefined
      closeCopies = undefined
      unbind = undefined
      startup = new AbortController()
      this.startupCancels.set(record.id, cancel)
      this.ui.registry.setStatus(record.id, 'joining')
      this.ui.publish(record.id, {
        inspection: { completed: 0, total: 0 },
        error: undefined,
        failure: undefined,
      })
      draining = start().catch(async (error) => {
        const cancelled = startup.signal.aborted
        const failure = cancelled ? startup.signal.reason : error
        this.failed(record.id, failure)
        cancel()
        this.startupCancels.delete(record.id)
        await runtime?.disconnect()
        this.pending.delete(record.id)
        this.live.delete(record.id)
        this.refreshDestinations()
        unbind?.()
        closeCopies?.()
        closeStore?.()
        this.offloadPorts.get(record.id)?.close()
        this.offloadPorts.delete(record.id)
        throw failure
      })
      starting = draining
      return starting
    }
    this.retries.set(record.id, async (assertCurrent) => {
      if (this.ui.runtimes.has(record.id)) return
      assertCurrent()
      this.ui.startupStage(record.id, 'Waiting to retry sync')
      this.ui.publish(record.id, { error: undefined, failure: undefined })
      let barrierError: unknown
      try {
        await connectStage(
          'retry opening sync',
          'Could not finish starting sync. Try Sync now again.',
          async (assertRetry) => {
            await draining?.catch(() => {})
            try {
              await beforeOpening.ready
            } catch (error) {
              assertRetry()
              barrierError = error
              throw error
            }
            assertRetry()
          }
        )
        this.ui.finishStartup(record.id, 'complete')
      } catch (error) {
        const failure = barrierError ?? error
        this.failed(record.id, failure)
        throw failure
      }
      assertCurrent()
      if (this.closed) return
      // A Sync now pressed during startup joins that attempt; it must not replace the
      // runtime that finished while we awaited draining and its recovery barrier.
      if (this.ui.runtimes.has(record.id)) return
      await begin()
    })
    return {
      start: begin,
      invalidate: () => {
        cancel()
        this.startupCancels.delete(record.id)
        this.retries.delete(record.id)
      },
      close: async () => {
        await starting?.catch(() => {})
        await draining?.catch(() => {})
        await opening?.catch(() => {})
        await runtime?.close()
        this.pending.delete(record.id)
        this.live.delete(record.id)
        this.refreshDestinations()
        unbind?.()
        closeCopies?.()
        closeStore?.()
        this.offloadPorts.get(record.id)?.close()
        this.offloadPorts.delete(record.id)
        fence?.release()
      },
    }
  }
  private refreshDestinations(): void {
    editCopiesOf(this.app.vault).expect([...this.pending, ...this.live.keys()])
  }
  evict(id: string, path: string) {
    if (this.devicePins().some((pin) => caseKey(pin) === caseKey(path)))
      return Promise.resolve({ status: 'pinned' as const, reclaimedBytes: 0 })
    const port = this.offloadPorts.get(id)
    if (!port) throw new Error('Connection is unavailable')
    return port.evict(path)
  }
  private offloadPort(path: string, connection?: string) {
    const candidates = [...this.offloadPorts].filter(
      ([id, port]) => (!connection || id === connection) && port.includes(path)
    )
    // Prefer the narrowest live scope. Each port still verifies its own retained identity
    // and authority; a refusal never retries deletion through another connection.
    candidates.sort(([a], [b]) => {
      const depth = (id: string) =>
        this.ui.registry.records().find((row) => row.id === id)?.scope?.path.length ?? 0
      return depth(b) - depth(a) || a.localeCompare(b)
    })
    const selected = candidates[0]
    if (!selected) throw new Error('No available connection holds this file')
    return selected[1]
  }
  actions(connection?: string): ExternalFileActions {
    const selected = new Map<string, Awaited<ReturnType<typeof tokenOffloadConnection>>>()
    const portFor = (path: string) => {
      let port = selected.get(path)
      if (!port) selected.set(path, (port = this.offloadPort(path, connection)))
      return port
    }
    return new ExternalFileActions({
      inspect: async (path) => {
        const chosen = portFor(path)
        const result = await chosen.inspect(path)
        if (this.devicePins().some((pin) => caseKey(pin) === caseKey(path))) result.pinned = true
        for (const port of this.offloadPorts.values())
          if (port !== chosen && port.includes(path) && (await port.pinned(path)))
            result.pinned = true
        for (const activity of Object.values(this.ui.activity.value))
          if (activity.refused?.some((item) => item.path === path)) result.blocked = 'refused'
        this.app.workspace.iterateAllLeaves((leaf) => {
          const view = leaf.view as typeof leaf.view & { file?: { path: string } }
          if (view.file?.path === path || view.getState?.()?.file === path) result.blocked = 'busy'
        })
        return result
      },
      evict: (path, version) => portFor(path).evict(path, version),
    })
  }
  async pin(path: string, pinned: boolean): Promise<void> {
    if (pinned) this.saveDevicePins([...new Set([...this.devicePins(), path])])
    const ports = [...this.offloadPorts.values()].filter((port) => port.includes(path))
    if (!ports.length) throw new Error('No available connection holds this file')
    for (const port of ports) {
      const result = await port.setPinned(path, pinned)
      if (result.status !== 'complete') throw new Error(result.status)
    }
    if (!pinned)
      this.saveDevicePins(this.devicePins().filter((pin) => caseKey(pin) !== caseKey(path)))
  }
  private devicePins(): string[] {
    return devicePins(this.app)
  }
  private saveDevicePins(paths: string[]): void {
    this.app.saveLocalStorage('abele-external-pins-v1', paths)
    if (JSON.stringify(this.devicePins()) !== JSON.stringify(paths))
      throw new Error('Device pin preference was not saved')
  }
  async hydrate(path: string): Promise<void> {
    const manager = tokenOffloadsOf(this.app.vault, pathCoordinatorOf(this.app.vault))
    const original = manager.originalPath(path)
    if (original === path && path.endsWith('.abele-ref')) throw new Error('unavailable')
    await manager.prepare([original])
    if (!(await vaultDisk(this.app.vault).exists(original))) throw new Error('unavailable')
  }
  private async changed(id: string, status: EngineStatus, report?: SyncReport): Promise<void> {
    if (this.closed || !this.ui.registry.records().some((one) => one.id === id)) return
    if (report)
      void this.ui.itemSets.refreshAll().then((changed) => {
        if (changed && !this.closed) this.start()
      })
    tokenOffloadsOf(this.app.vault, pathCoordinatorOf(this.app.vault)).changed()
    if (this.ui.registry.records().find((one) => one.id === id)?.rootIssue) return
    if (
      this.ui.registry.records().find((one) => one.id === id)?.state[
        'abele-sync-token-state:scope-deleted'
      ]
    )
      return
    if (
      this.ui.registry.records().find((one) => one.id === id)?.state[
        'abele-sync-token-state:server-delete'
      ]
    )
      return
    const epoch = (this.activityEpoch.get(id) ?? 0) + 1
    this.activityEpoch.set(id, epoch)
    const reportEpoch = (this.activityReports.get(id) ?? 0) + (report ? 1 : 0)
    this.activityReports.set(id, reportEpoch)
    const runtime = this.live.get(id)
    const failureReason = this.ui.activity.value[id]?.error ?? connectionError({ code: 'offline' })
    if (this.ui.registry.records().find((one) => one.id === id)?.status !== 'needs-token')
      this.ui.registry.setStatus(id, status.state)
    const activity: Parameters<TokenUi['publish']>[1] = {
      pending: status.pending,
      heldDeletes: status.heldDeletes ?? 0,
      deferred: status.deferred ?? 0,
      reconciliation: status.reconciliation,
    }
    const unsent = status.state === 'offline' ? await runtime?.pendingLocalDetails() : undefined
    if (unsent) activity.pending = unsent.count
    const publications = this.live.get(id)?.publications() ?? []
    activity.pending = (activity.pending ?? 0) + publications.length
    activity.refused = publications.map((one) => ({ path: one.path, reason: one.reason }))
    // Starting another attempt is not evidence that previously unsent bytes arrived.
    if (status.state === 'syncing' && !report) {
      const previous = this.ui.activity.value[id]?.refused ?? []
      activity.refused.push(
        ...previous.filter((one) => !activity.refused.some((item) => item.path === one.path))
      )
      activity.pending = Math.max(activity.pending, this.ui.activity.value[id]?.pending ?? 0)
    }
    if (unsent)
      activity.refused.push(
        ...unsent.paths.map((path) => ({
          path,
          reason: failureReason,
        }))
      )
    if (status.lastSyncAt) activity.lastSync = Date.parse(status.lastSyncAt)
    if (report) {
      activity.error = undefined
      activity.startup = undefined
      activity.completed = report.pull.applied + (report.secondPull?.applied ?? 0)
      activity.total = activity.completed + status.pending
      const results = report.push.committed?.results ?? []
      const refused = await Promise.all(
        report.push.rejected.map(async (one) => ({
          path:
            'path' in one.op
              ? one.op.path
              : 'to_path' in one.op
                ? one.op.to_path
                : ((await this.live
                    .get(id)
                    ?.pathFor(one.op.file_id)
                    .catch((): null => null)) ?? 'A file'),
          reason: connectionError({ code: one.code }),
        }))
      )
      activity.refused = [...activity.refused, ...refused]
      const points = (path: string) =>
        Array.from(path)
          .map((char) => 'U+' + char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'))
          .join(' ')
      for (const collision of report.collisions) {
        const kind =
          collision.path.normalize('NFC') === collision.with.normalize('NFC')
            ? 'Normalization'
            : 'Case'
        activity.refused.push({
          path: collision.path,
          reason: `${kind} collision: ${collision.path} (${points(collision.path)}); ${collision.with} (${points(collision.with)})`,
        })
      }
      activity.pending += report.collisions.length
      activity.total += report.collisions.length
      activity.conflicts = results.flatMap((one) =>
        one.status === 'conflict' ? [one.conflict_path] : []
      )
    }
    if (this.activityEpoch.get(id) !== epoch) {
      // A slow pending scan may finish during the next attempt. Keep its evidence,
      // but never replace a later successful report or a replacement runtime.
      if (
        unsent &&
        !this.closed &&
        this.live.get(id) === runtime &&
        this.activityReports.get(id) === reportEpoch &&
        this.ui.registry.records().some((one) => one.id === id)
      ) {
        const current = this.ui.activity.value[id]
        const refused = [...(current?.refused ?? [])]
        for (const path of unsent.paths)
          if (!refused.some((one) => one.path === path))
            refused.push({ path, reason: failureReason })
        this.ui.publish(id, { refused, pending: Math.max(current?.pending ?? 0, unsent.count) })
      }
      return
    }
    if (!this.closed && this.ui.registry.records().some((one) => one.id === id))
      this.ui.publish(id, activity)
    if (!this.closed && this.ui.registry.records().some((one) => one.id === id))
      await TokenSettingsPort.forConnection(this.ui, id, this.app).noticed(status, report)
  }
  /** Explicit reset/unload cancellation; does not forget records or bypass departure checks. */
  private async detachedCopies(
    id: string,
    remove: boolean
  ): Promise<{ files: number; edited: number; kept: number }> {
    const binding = this.ui.itemSets.store.forRecord(id)
    if (!binding?.item.detached) throw new Error('Only an item no longer shared may lose its copy')
    const record = this.ui.registry.records().find((one) => one.id === id)
    if (!record?.scope) throw new Error('Connection is unavailable')
    await this.ui.connectionChangeGuard(id)
    await this.engines.remove(id)
    let active = true
    const fence = new RuntimeFence(
      this.app,
      record.ledgerId,
      () => active && !!this.ui.itemSets.store.forRecord(id)?.item.detached
    )
    let store: IndexedDbStateStore | undefined
    try {
      store = await openTokenLedger(factoryOf(this.deps), this.ui.registry, record, () =>
        fence.assertOwned()
      )
      fence.activate()
      const raw = new ObsidianFileSystem(this.app, { runtimeFence: fence, journalOwner: id })
      const fs =
        record.scope.kind === 'folder' && record.scope.path !== '/'
          ? new LocalFolderPlacement(
              record.scope.path,
              record.localRoot ?? record.scope.path
            ).fileSystem(raw)
          : raw
      const placement =
        record.scope.kind === 'folder' && record.scope.path !== '/'
          ? new LocalFolderPlacement(record.scope.path, record.localRoot ?? record.scope.path)
          : null
      const covered = (path: string) =>
        [...this.live.values()].some((runtime) => runtime.covers(placement?.toLocal(path) ?? path))
      const retained = new RetainedShareCopies(store)
      const copies = new Proxy(store, {
        get(target, key) {
          if (key === 'all')
            return async function* () {
              const seen = new Set<string>()
              for await (const entry of target.all()) {
                seen.add(entry.path)
                yield entry
              }
              for (const entry of await retained.read()) if (!seen.has(entry.path)) yield entry
            }
          if (key === 'delete')
            return async (path: string) => {
              for (const entry of await retained.read())
                if (entry.path === path) await retained.forget(entry.fileId)
              await target.delete(path)
            }
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      if (remove)
        await removeDetachedCopies({
          fs,
          state: copies,
          detached: () => !!this.ui.itemSets.store.forRecord(id)?.item.detached,
          covered,
          localPath: (path) => placement?.toLocal(path) ?? path,
          lease: (path, work) =>
            pathCoordinatorOf(this.app.vault).run([path], work, () => fence.assertReady()),
        })
      let files = 0,
        edited = 0,
        kept = 0
      for await (const entry of copies.all()) {
        if (!(await fs.stat(entry.path))) continue
        files++
        const fingerprint = await fingerprintFile(fs, entry.path, sha256)
        if (fingerprint.sha !== entry.sha || fingerprint.size !== entry.size) edited++
        else if (covered(entry.path)) kept++
      }
      return { files, edited, kept }
    } finally {
      store?.close()
      active = false
      fence.release()
    }
  }
  cancelStartup(): void {
    for (const cancel of this.startupCancels.values()) cancel()
  }
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    const prior = pendingTeardown(this.app)
    this.closed = true
    this.ui.itemSets.uninstall()
    if (externalActionsOf.get(this.app.vault) === this) externalActionsOf.delete(this.app.vault)
    this.cancelStartup()
    this.app.vault.offref(this.renameEvent)
    this.ui.connectionsChanged = async () => {}
    this.ui.connectionForgotten = async () => {}
    this.closing = this.engines.close()
    recordTeardown(this.app, Promise.all([prior, this.closing]))
    return this.closing
  }
}
