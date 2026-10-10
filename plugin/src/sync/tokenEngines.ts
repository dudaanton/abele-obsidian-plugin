import { Platform, type App, type EventRef } from 'obsidian'
import { encodeAccessToken } from '@abele/sync-protocol'
import type { EngineStatus, SyncReport } from '@abele/sync-core'
import { ConnectionEngines, type ConnectionRuntime } from './connectionEngines'
import { TokenEngineRuntime } from './tokenEngineRuntime'
import type { TokenConnectionRecord } from './tokenConnectionRegistry'
import { TokenUi, connectionError, connectStage } from './tokenUi'
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
import { readIgnore, ignoreFor, scopeKey } from './scope'
import { OwnSettingsWatch } from './ownSettings'

/** One native host, independent durable engines, and one vault-wide placement coordinator. */
export class TokenEngines {
  private readonly engines = new ConnectionEngines()
  private readonly live = new Map<string, TokenEngineRuntime>()
  private readonly pending = new Set<string>()
  private readonly retries = new Map<string, (assertCurrent: () => void) => Promise<void>>()
  private readonly startupCancels = new Map<string, () => void>()
  private readonly activityEpoch = new Map<string, number>()
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
    this.localFiles = new TokenAttachmentHost(app, (path) =>
      tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault)).isOffloaded(path)
    )
    this.renameEvent = app.vault.on('rename', (file, from) =>
      this.localFiles.renamed(from, file.path)
    )
    ui.connectionsChanged = async (assertCurrent = () => {}) => {
      assertCurrent()
      this.start()
    }
    ui.retryConnection = async (id, assertCurrent) => {
      assertCurrent()
      const retry = this.retries.get(id)
      if (retry) await retry(assertCurrent)
      else await ui.connectionsChanged(assertCurrent)
    }
    ui.connectionChangeGuard = async (id, assertCurrent = () => {}) => {
      assertCurrent()
      if (this.closed) throw new Error('Connection host closed; recovery required')
      if (!id) {
        requireExternalEnrollmentSafety(this.app)
        await requireExternalLifecycleSafety(
          this.app,
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
      const inspecting = this.startupCancels.has(id) && !ui.runtimes.has(id)
      if (inspecting) this.startupCancels.get(id)?.()
      if (id) await this.offloadPorts.get(id)?.prepareDisconnect()
      await requireExternalLifecycleSafety(
        this.app,
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
        record.status !== 'needs-token'
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
    const beforeOpening = pendingTeardown(this.app).then(async () => {
      const manager = tokenOffloadsOf(this.app.vault, pathCoordinatorOf(this.app.vault))
      for (const document of await activeExternalDocuments(this.app, factoryOf(this.deps))) {
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
    const records = this.ui.registry
      .records()
      .filter(
        (one) => one.secretReference && one.scope && !one.pending && one.status !== 'needs-token'
      )
    this.engines.start(
      records.map((one) => one.id),
      (id) =>
        this.create(
          records.find((one) => one.id === id),
          beforeOpening
        ),
      (id, error) => this.failed(id, error)
    )
    this.refreshDestinations()
  }
  private failed(id: string, error: unknown): void {
    if (this.closed || !this.ui.registry.records().some((one) => one.id === id)) return
    const code = (error as { code?: string })?.code
    if (code === 'startup-cancelled') return
    this.ui.registry.setStatus(
      id,
      code === 'unauthorized' || code === 'forbidden'
        ? 'needs-token'
        : code === 'scope_updating' || code === 'scope_unavailable'
          ? code
          : code === 'offline' || code === 'unreachable'
            ? 'offline'
            : 'error'
    )
    this.ui.publish(id, { error: connectionError(error), inspection: undefined })
  }
  private create(record: TokenConnectionRecord, beforeOpening: Promise<void>): ConnectionRuntime {
    let active = true,
      runtime: TokenEngineRuntime | undefined
    let closeStore: (() => void) | undefined,
      closeCopies: (() => void) | undefined,
      unbind: (() => void) | undefined
    let stateHandle: IndexedDbStateStore | undefined
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
    const start = async () => {
      await connectStage(
        'opening sync',
        'Could not finish starting sync. Try Sync now again.',
        async () => {
          await beforeOpening
          assertActive()
        },
        startup.signal
      )
      if (!active || this.closed) return
      fence = claim()
      this.pending.add(record.id)
      this.refreshDestinations()
      const key = this.key(record.secretReference)
      if (!key || !record.scope) throw new Error('Connection needs its token')
      const inspection = {
        signal: startup.signal,
        progress: (completed: number, total: number) => {
          assertActive()
          this.ui.inspectionProgress(record.id, completed, total)
        },
      }
      await requireExternalLifecycleSafety(
        this.app,
        factoryOf(this.deps),
        undefined,
        true,
        undefined,
        assertActive,
        inspection
      )
      assertActive()
      const state = await openTokenLedger(factoryOf(this.deps), this.ui.registry, record, () =>
        fence.assertOwned()
      )
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
      const binding = await tokenExternalBinding(record, key)
      assertActive()
      await recoverExternalState(
        this.app,
        state,
        record.ledgerId,
        record.ledgerId,
        binding,
        fence,
        factoryOf(this.deps),
        inspection
      )
      assertActive()
      this.ui.publish(record.id, { inspection: undefined })
      await connectStage(
        'starting sync',
        'Could not finish starting sync. Try Sync now again.',
        async () => {
          assertActive()
          const ordinary = new ObsidianFileSystem(this.app, {
            runtimeFence: fence,
            ledger: state,
            preserveEmptyDirectories: true,
            pollMs: pollMsOf(this.deps),
            onEngineWrite: (path) => {
              own.noteWrite(path)
              runtime?.written(path)
            },
          })
          await ordinary.recover()
          assertActive()
          fence.activate()
          const manager = tokenOffloadsOf(this.app.vault, pathCoordinatorOf(this.app.vault))
          const offloads = await tokenOffloadConnection({
            app: this.app,
            factory: factoryOf(this.deps),
            state,
            ledgerId: record.ledgerId,
            binding,
            fence,
            fs: ordinary,
            manager,
            scriptsFolder: () => this.scriptsFolder,
            client: () => runtime.client,
            sync: () => runtime.sync(),
            includes: (path) =>
              runtime
                ? runtime.covers(path)
                : record.scope.kind === 'folder' &&
                  (record.scope.path === '/' ||
                    path === record.scope.path ||
                    path.startsWith(record.scope.path + '/')),
            capture: (paths) => editCopiesOf(this.app.vault).capture(ordinary, paths),
            rememberIdentity: (path) => this.localFiles.remember(path),
            hydratedIdentity: (path) => this.localFiles.hydrated(path),
          })
          this.offloadPorts.set(record.id, offloads)
          assertActive()
          const fs = coordinatedFileSystem(
            offloads.fs,
            pathCoordinatorOf(this.app.vault),
            () => fence.assertReady(),
            async (paths) => {
              const affected = new Set(paths)
              for await (const info of ordinary.placementFiles(paths)) affected.add(info.path)
              await editCopiesOf(this.app.vault).capture(ordinary, [...affected])
            }
          )
          if (!this.ui.reviews) throw new Error('Device reviews are not available')
          const current = this.ui.registry.records().find((one) => one.id === record.id)
          fence.assertReady()
          runtime = new TokenEngineRuntime({
            id: record.id,
            encoded: encodeAccessToken({
              v: 1,
              address: record.address,
              key,
              scope: record.scope,
            }),
            fs,
            state,
            engineState: offloads.state,
            engineClient: offloads.client,
            preparePlacement: (paths) => manager.prepare(paths),
            recoverPlacement: () => ordinary.recover(),
            scopeInput: async (selective) => {
              const text = await readIgnore(this.app)
              return {
                key: await scopeKey(selective, text),
                ignore: ignoreFor(this.app.vault.configDir, text),
              }
            },
            reviews: this.ui.reviews,
            fetch: transportOf(this.deps),
            WebSocket: socketOf(this.deps),
            paths: { scriptsFolder: this.scriptsFolder, configRoots: [this.app.vault.configDir] },
            paused: current.paused,
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
          const copies = await registerConnectionEditCopies(
            factoryOf(this.deps),
            editCopiesOf(this.app.vault),
            record.id,
            JSON.stringify([record.address, record.spaceId, record.tokenId, record.ledgerId]),
            state,
            (path, size) => runtime.acceptsLocal(path, size),
            () => fence.assertReady()
          )
          closeCopies = copies.close
          assertActive()
          this.live.set(record.id, runtime)
          this.pending.delete(record.id)
          unbind = this.ui.bind(record.id, {
            assertCurrent: () => fence.assertReady(),
            sync: () => runtime.sync(),
            pause: (paused) => runtime.pause(paused),
            updateSelective: (selective) => runtime.updateSelective(selective),
            opened: (path) => runtime.opened(path),
            resolve: (id) => runtime.resolve(id),
            publishAttachment: (id) => runtime.publishAttachment(id),
            historyClient: runtime.client,
            entryFor: (path) => runtime.entryFor(path),
            heldDeletes: () => runtime.heldDeletes(),
            decideDeletes: (kind, ids) => runtime.decideDeletes(kind, ids),
            deferred: () => runtime.deferred(),
            applyDeferred: (ids) => runtime.applyDeferred(ids),
            keepLocal: (paths, ids) => runtime.keepLocal(paths, ids),
            apply: (candidate) => runtime.apply(candidate),
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
          await runtime.start()
        },
        startup.signal
      )
      this.startupCancels.delete(record.id)
    }
    const begin = () => {
      active = true
      startup = new AbortController()
      this.startupCancels.set(record.id, cancel)
      this.ui.registry.setStatus(record.id, 'joining')
      this.ui.publish(record.id, { inspection: { completed: 0, total: 0 }, error: undefined })
      draining = start().catch(async (error) => {
        const cancelled = startup.signal.aborted
        const failure = cancelled ? startup.signal.reason : error
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
      await draining?.catch(() => {})
      if (this.ui.runtimes.has(record.id)) return
      await connectStage(
        'retry opening sync',
        'Could not finish starting sync. Try Sync now again.',
        async (assertRetry) => {
          await beforeOpening
          assertRetry()
        }
      )
      assertCurrent()
      if (this.closed) return
      await begin().catch((error) => {
        this.failed(record.id, error)
      })
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
    const port = this.offloadPorts.get(id)
    if (!port) throw new Error('Connection is unavailable')
    return port.evict(path)
  }
  hydrate(path: string): Promise<void> {
    const manager = tokenOffloadsOf(this.app.vault, pathCoordinatorOf(this.app.vault))
    return manager.prepare([manager.originalPath(path)])
  }
  private async changed(id: string, status: EngineStatus, report?: SyncReport): Promise<void> {
    if (this.closed || !this.ui.registry.records().some((one) => one.id === id)) return
    const epoch = (this.activityEpoch.get(id) ?? 0) + 1
    this.activityEpoch.set(id, epoch)
    if (this.ui.registry.records().find((one) => one.id === id)?.status !== 'needs-token')
      this.ui.registry.setStatus(id, status.state)
    const activity: Parameters<TokenUi['publish']>[1] = {
      pending: status.pending,
      heldDeletes: status.heldDeletes ?? 0,
      deferred: status.deferred ?? 0,
    }
    if (status.state === 'offline')
      activity.pending = (await this.live.get(id)?.pendingLocal()) ?? status.pending
    const publications = this.live.get(id)?.publications() ?? []
    activity.pending = (activity.pending ?? 0) + publications.length
    activity.refused = publications.map((one) => ({ path: one.path, reason: one.reason }))
    if (status.lastSyncAt) activity.lastSync = Date.parse(status.lastSyncAt)
    if (report) {
      activity.error = undefined
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
      activity.conflicts = results.flatMap((one) =>
        one.status === 'conflict' ? [one.conflict_path] : []
      )
    }
    if (this.activityEpoch.get(id) !== epoch) return
    if (!this.closed && this.ui.registry.records().some((one) => one.id === id))
      this.ui.publish(id, activity)
    if (!this.closed && this.ui.registry.records().some((one) => one.id === id))
      await TokenSettingsPort.forConnection(this.ui, id, this.app).noticed(status, report)
  }
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    const prior = pendingTeardown(this.app)
    this.closed = true
    this.app.vault.offref(this.renameEvent)
    this.ui.connectionsChanged = async () => {}
    this.closing = this.engines.close()
    recordTeardown(this.app, Promise.all([prior, this.closing]))
    return this.closing
  }
}
