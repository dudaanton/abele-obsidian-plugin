import type { App, EventRef } from 'obsidian'
import { encodeAccessToken } from '@abele/sync-protocol'
import type { EngineStatus, SyncReport } from '@abele/sync-core'
import { ConnectionEngines, type ConnectionRuntime } from './connectionEngines'
import { TokenEngineRuntime } from './tokenEngineRuntime'
import type { TokenConnectionRecord } from './tokenConnectionRegistry'
import { TokenUi, connectionError } from './tokenUi'
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
import { requireExternalLifecycleSafety } from './external/pluginSafety'
import { TokenAttachmentHost } from './tokenAttachmentHost'
import { OwnSettingsWatch } from './ownSettings'

/** One native host, independent durable engines, and one vault-wide placement coordinator. */
export class TokenEngines {
  private readonly engines = new ConnectionEngines()
  private readonly live = new Map<string, TokenEngineRuntime>()
  private readonly pending = new Set<string>()
  private closed = false
  private closing: Promise<void> | undefined
  private readonly localFiles: TokenAttachmentHost
  private readonly renameEvent: EventRef
  constructor(
    private readonly app: App,
    private readonly ui: TokenUi,
    private readonly key: (reference: string) => string | null,
    private readonly deps: SyncServiceDeps = {},
    private readonly scriptsFolder = 'Scripts',
    private readonly ownSettings?: { path: string; arrived(): void }
  ) {
    this.localFiles = new TokenAttachmentHost(app)
    this.renameEvent = app.vault.on('rename', (file, from) =>
      this.localFiles.renamed(from, file.path)
    )
    ui.connectionsChanged = async () => {
      this.start()
      await this.engines.settled()
    }
    ui.connectionChangeGuard = () => requireExternalLifecycleSafety(this.app, factoryOf(this.deps))
  }
  start(): void {
    if (this.closed) return
    const beforeOpening = pendingTeardown(this.app)
    const records = this.ui.registry
      .records()
      .filter((one) => one.secretReference && one.scope && !one.pending)
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
    this.ui.registry.setStatus(
      id,
      code === 'scope_updating' || code === 'scope_unavailable'
        ? code
        : code === 'offline' || code === 'unreachable'
          ? 'offline'
          : 'error'
    )
    this.ui.publish(id, { error: connectionError(error) })
  }
  private create(record: TokenConnectionRecord, beforeOpening: Promise<void>): ConnectionRuntime {
    let active = true,
      runtime: TokenEngineRuntime | undefined
    let closeStore: (() => void) | undefined,
      closeCopies: (() => void) | undefined,
      unbind: (() => void) | undefined
    let fence: RuntimeFence | undefined
    const claim = () =>
      new RuntimeFence(
        this.app,
        record.ledgerId,
        () =>
          active &&
          !this.closed &&
          this.ui.registry
            .records()
            .some(
              (one) =>
                one.id === record.id &&
                one.ledgerId === record.ledgerId &&
                one.secretReference === record.secretReference
            )
      )
    let starting: Promise<void> | undefined
    const start = async () => {
      await beforeOpening
      if (!active || this.closed) return
      fence = claim()
      this.pending.add(record.id)
      this.refreshDestinations()
      const key = this.key(record.secretReference)
      if (!key || !record.scope) throw new Error('Connection needs its token')
      const state = await openTokenLedger(factoryOf(this.deps), this.ui.registry, record, () =>
        fence.assertOwned()
      )
      closeStore = () => state.close()
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
      const ordinary = new ObsidianFileSystem(this.app, {
        runtimeFence: fence,
        ledger: state,
        preserveEmptyDirectories: true,
        pollMs: pollMsOf(this.deps),
        onEngineWrite: (path) => own.noteWrite(path),
      })
      await ordinary.recover()
      fence.activate()
      const fs = coordinatedFileSystem(
        ordinary,
        pathCoordinatorOf(this.app.vault),
        () => fence.assertReady(),
        async (paths) => {
          const affected = new Set(paths)
          for await (const info of ordinary.list())
            if (paths.some((path) => info.path.startsWith(path + '/'))) affected.add(info.path)
          await editCopiesOf(this.app.vault).capture(ordinary, [...affected])
        }
      )
      if (!this.ui.reviews) throw new Error('Device reviews are not available')
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
        reviews: this.ui.reviews,
        fetch: transportOf(this.deps),
        WebSocket: socketOf(this.deps),
        paths: { scriptsFolder: this.scriptsFolder, configRoots: [this.app.vault.configDir] },
        paused: record.paused,
        selective: record.selective,
        fallbackMs: fallbackMsOf(this.deps),
        expectedSource: reviewSourceOf(record),
        localFiles: this.localFiles,
        ownSettingsPath:
          this.ownSettings?.path ?? `${this.app.vault.configDir}/plugins/abele/data.json`,
        assertHeld: () => fence.assertReady(),
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
        (path) => runtime.covers(path),
        () => fence.assertReady()
      )
      closeCopies = copies.close
      this.live.set(record.id, runtime)
      this.pending.delete(record.id)
      unbind = this.ui.bind(record.id, {
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
          this.refreshDestinations()
        },
      })
      await runtime.start()
    }
    return {
      start: () => {
        starting = start().catch(async (error) => {
          active = false
          fence?.release()
          await runtime?.disconnect()
          this.pending.delete(record.id)
          this.live.delete(record.id)
          this.refreshDestinations()
          unbind?.()
          closeCopies?.()
          closeStore?.()
          throw error
        })
        return starting
      },
      invalidate: () => {
        active = false
        runtime?.invalidate()
        fence?.release()
      },
      close: async () => {
        await starting?.catch(() => {})
        await runtime?.close()
        this.pending.delete(record.id)
        this.live.delete(record.id)
        this.refreshDestinations()
        unbind?.()
        closeCopies?.()
        closeStore?.()
        fence?.release()
      },
    }
  }
  private refreshDestinations(): void {
    editCopiesOf(this.app.vault).expect([...this.pending, ...this.live.keys()])
  }
  private async changed(id: string, status: EngineStatus, report?: SyncReport): Promise<void> {
    if (this.closed || !this.ui.registry.records().some((one) => one.id === id)) return
    this.ui.registry.setStatus(id, status.state)
    const activity: Parameters<TokenUi['publish']>[1] = { pending: status.pending }
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
      activity.refused = refused
      activity.conflicts = results.flatMap((one) =>
        one.status === 'conflict' ? [one.conflict_path] : []
      )
    }
    if (!this.closed && this.ui.registry.records().some((one) => one.id === id))
      this.ui.publish(id, activity)
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
