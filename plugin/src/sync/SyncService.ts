import { Platform, type App } from 'obsidian'
import { ref, toRaw, type Ref } from 'vue'
import type {
  DeferredKept,
  DeleteDecision,
  HeldDelete,
  StateEntry,
  VaultClient,
} from '@abele/sync-core'
import {
  serverUrlProblem,
  type ChangeItem,
  type DeviceInfo,
  type JoinPrefer,
  type VaultInfo,
} from '@abele/sync-protocol'
import type AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { DeviceConnection } from './connection'
import { ConnectionKeeper } from './connectionKeeper'
import { Enrolment, type ConnectionEdit, type VaultChoice } from './enrolment'
import type { SharedSelective, Sibling, TransferredConnection } from '@/transfer/connection'
import { EngineRunner } from './engineRunner'
import { finishJoin, joinOf, tellJoinWaiting } from './joinState'
import { HeldDeletesPrompt } from './heldDeletes'
import { StagedSettingsPrompt, type AppliedSettings } from './stagedSettings'
import { obsidianReloader } from './reload'
import { watchTheFront } from './phone'
import { ownSettingsPath, settingsArrived, settingsMeaning } from './ownSettings'
import { askJoin, type JoinQuestion } from './join'
import { factoryOf, transportOf, type SyncServiceDeps } from './environment'
import { noop, SerialQueue } from './queue'
import { DISCONNECTED_STATUS, type SyncStatus } from './status'
import { StatusBoard } from './statusBoard'

export { isWireConfigDir } from './scope'
export type { ConnectionEdit, ConnectionPatch, VaultChoice } from './enrolment'
export { PLAIN_HTTP_CONNECTION } from './engineRunner'
export type { SyncServiceDeps } from './environment'

/**
 * One engine per plugin, and everything Obsidian has to know about it.
 *
 * The engine itself is the sibling repo's, unchanged and unaware of Obsidian: it is handed a
 * filesystem, a state store, a client and a set of selective settings, and it syncs. What is
 * here is the half a host owes it — reading the settings, opening the state database, minting
 * and keeping the device token, deciding what a phone does differently from a laptop, and
 * turning the engine's status into the one word the status bar shows.
 *
 * ## The state machine
 *
 * The engine has five states (`idle`, `syncing`, `offline`, `paused`, `error`) and the plugin
 * adds `disconnected` above them for a vault nobody has set up. Building, keeping and taking
 * down the engine is `engineRunner.ts`; what the status says and the log are `statusBoard.ts`;
 * the connection record is `connectionKeeper.ts`. `connect` and `chooseVault` build one,
 * `disconnect` takes it away — those verbs are in `enrolment.ts`, since none of them is the
 * engine's business — and `updateConnection` and `onSettingsSaved` build another when what the
 * running one was built on has changed. This class is the facade the screens and the agent see.
 *
 * ## The phone
 *
 * A phone runs the engine the way a desktop does, less the socket (`phone.ts`): the operating
 * system suspends the app the moment it leaves the screen, and a socket it will not let live is
 * a socket that only reconnects. The vault's own events send an edit a moment after it is made,
 * a clock asks the server every minute while the app is in front, and the app coming back to
 * the front or leaving it syncs at once — the one to read what arrived, the other to get the
 * last edit out before the system freezes the app.
 *
 * ## Secrets
 *
 * The device token is in Obsidian's keychain under a generated id, and only that id is in the
 * connection record — which lives in local storage, since a vault is precisely what gets
 * copied to another machine. It is read and written through `secrets().device`, which is the
 * keychain alone: the synced secret store carries keys to every device, and this one token is
 * minted for this device only. The account password is used for one login and never stored; the
 * account token it returns lives in memory for the length of the connect flow. Nothing here
 * writes a token or a password to the log.
 */

export class SyncService {
  private static instance: SyncService | null = null

  /**
   * The teardown of the instance before this one.
   *
   * `onunload` cannot await, so a plugin reload can start a new instance while the old one is
   * still stopping an engine and closing its database. The next `init` waits on this before it
   * opens anything, which is what stops two engines running on one vault.
   */
  private static lastTeardown: Promise<unknown> = Promise.resolve()

  static getInstance(): SyncService {
    SyncService.instance ??= new SyncService()
    return SyncService.instance
  }

  /** What sync says: the status, its listeners and the log (`statusBoard.ts`). */
  private readonly board = new StatusBoard()

  /** The status, for the status bar and the settings screens. */
  readonly status: Ref<SyncStatus> = this.board.status

  /** The last lines of the log, oldest first. Every one of them is a `console.debug` too. */
  readonly log: Ref<string[]> = this.board.log

  /** The connection record, read, checked and written (`connectionKeeper.ts`). */
  private readonly keeper = new ConnectionKeeper((text) => this.note(text))

  /**
   * This device's connection as local storage holds it, for the Sync tab to show. Written only
   * through {@link SyncService.updateConnection} and the verbs, never by assigning to it.
   */
  readonly connection: Ref<DeviceConnection> = this.keeper.connection

  /**
   * Who a sign-in is telling that a device left, while it waits on that before enrolling —
   * "Telling https://… that Laptop left…" — or null. The sign-in card shows it.
   */
  readonly telling: Ref<string | null> = ref(null)

  private app: App | null = null
  private plugin: AbelePlugin | null = null
  private deps: SyncServiceDeps = {}

  /** Everything that touches the engine, one at a time (`queue.ts`). */
  private readonly queue = new SerialQueue()

  /** The engine itself: building, keeping in step, taking down (`engineRunner.ts`). */
  private readonly runner = new EngineRunner(
    {
      app: () => this.app,
      manifest: () => this.plugin?.manifest ?? { id: 'abele' },
      deps: () => this.deps,
      connection: () => this.connection.value,
      token: () => this.keeper.token(),
      damage: () => this.keeper.damage(),
      serialise: <T>(fn: () => Promise<T>) => this.serialise(fn),
      settingsArrived: (replaced) =>
        settingsArrived({ plugin: this.plugin, note: (text) => this.note(text) }, replaced),
      settingsMeaning: () => settingsMeaning(this.plugin),
      joined: (join) =>
        finishJoin(
          {
            connection: () => this.connection.value,
            save: (patch) => this.keeper.save(patch),
            note: (text) => this.note(text),
            reconcile: () => void this.serialise(() => this.runner.reconcile()),
          },
          join
        ),
      synced: (report) => void this.settingsPrompt.reported(report),
    },
    this.board
  )

  /** Setting this device up and taking it down again (`enrolment.ts`). */
  private readonly enrolment = new Enrolment({
    app: () => this.app,
    transport: () => transportOf(this.deps),
    factory: () => factoryOf(this.deps),
    note: (text) => this.note(text),
    connection: () => this.connection.value,
    saveConnection: (patch) => this.keeper.save(patch),
    serialise: <T>(fn: () => Promise<T>) => this.serialise(fn),
    teardown: () => this.runner.teardown(),
    reconcile: () => this.runner.reconcile(),
    telling: (line) => {
      this.telling.value = line
    },
  })

  /**
   * Many files deleted at once, held back by the engine, and the question about them
   * (`heldDeletes.ts`). Told of every status; the dialog and the Sync tab read it.
   */
  readonly heldPrompt = new HeldDeletesPrompt({
    list: () => this.runner.heldDeletes(),
    visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  })

  /**
   * Obsidian settings changed on another device, staged by the engine until the person says
   * what to do with them, and the question about them (`stagedSettings.ts`). Its `reloader` is
   * the seam a test replaces so that "Reload now" reloads nothing.
   */
  readonly settingsPrompt = new StagedSettingsPrompt(
    {
      list: () => this.runner.deferred(),
      visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
      names: (ids) => this.pluginNames(ids),
    },
    obsidianReloader(() => this.app)
  )

  /** Whether the visibility listener has been registered; it is registered once. */
  private watchingVisibility = false
  /** Drops the settings-saved subscription. */
  private unhookSettings: (() => void) | null = null

  private constructor() {
    this.board.onStatusChange((status) => {
      void this.heldPrompt.noticed(status)
      void this.settingsPrompt.noticed(status)
    })
  }

  /* -- Starting and stopping -------------------------------------------- */

  /**
   * Read the connection and, if this device is set up, start syncing.
   *
   * Called from `onLayoutReady` rather than `onload`: the first thing the engine does is list
   * the vault, and Obsidian's file index is not complete until the layout is.
   */
  init(app: App, plugin: AbelePlugin, deps: SyncServiceDeps = {}): void {
    this.app = app
    this.plugin = plugin
    this.deps = deps
    this.keeper.read(app)
    // A settings save moves the scripts folder, which the engine is built on too.
    this.unhookSettings?.()
    this.unhookSettings = AbeleConfig.getInstance().onSaved(() => this.onSettingsSaved())
    this.hookVisibility()
    // Said again here, for an instance `onload` did not announce — a plugin reload's.
    this.announce()
    // Read here and not inside the queued work: a `destroy()` in this same tick would file its
    // own teardown as `lastTeardown`, and waiting for that from behind it in the queue is a
    // deadlock — the teardown cannot start until this item lets go.
    const pending = SyncService.lastTeardown
    void this.serialise(async () => {
      // Whatever instance a plugin reload left stopping goes first.
      await pending
      await this.runner.reconcile()
    })
    void this.retryPendingRevokes()
    tellJoinWaiting(this.connection.value)
  }

  /**
   * Say a pull is coming, before anything is opened: `syncing` (or `paused`) when the connection
   * names a server the address rule allows, a vault and a device token the keychain holds, and
   * nothing otherwise — a refused address pulls nothing, and `reconcile` says why.
   *
   * Called from `onload` as soon as the connection and the keychain are read, and again by
   * `init`. `runAfterSync` can be asked before the layout is ready — an `abele://` link that
   * opened the app cold — and a device that is set up is about to pull: `disconnected` in that
   * gap would let a script run over a vault the first pull is about to rewrite.
   */
  announce(): void {
    const connection = this.connection.value
    if (
      connection.serverUrl !== '' &&
      connection.vaultId !== '' &&
      serverUrlProblem(connection.serverUrl) === null &&
      this.keeper.token() !== null
    ) {
      // A join still to be answered pulls nothing: no engine is built until it is.
      const state = joinOf(connection)?.ask ? 'joining' : connection.paused ? 'paused' : 'syncing'
      this.board.publish({ ...DISCONNECTED_STATUS, state })
    }
  }

  /** Read this device's connection, moving it out of `data.json`: see `ConnectionKeeper.open`. */
  openConnection(app: App): Promise<void> {
    return this.keeper.open(app)
  }

  /**
   * Change this device's connection, and put the engine in step with it. Checked first, by the
   * rules `ConnectionKeeper.check` holds every change from outside to; nothing is written when
   * it throws, and what is written is the change as `check` answers it — the address normalised.
   */
  async updateConnection(patch: ConnectionEdit): Promise<void> {
    this.keeper.save(this.keeper.check(patch))
    await this.serialise(() => this.runner.reconcile())
  }

  /** Stop everything and let the singleton go; the next `getInstance` builds a fresh one. */
  async destroy(): Promise<void> {
    // Detached first and synchronously. `onunload` cannot await, so the reload that follows it
    // reaches `getInstance()` while this teardown is still running — and would otherwise be
    // handed this very instance, queue a build behind the teardown, and then have its `app`
    // and `plugin` taken away underneath the engine it had just started.
    if (SyncService.instance === this) SyncService.instance = null
    this.unhookSettings?.()
    this.unhookSettings = null
    const stopping = this.serialise(() => this.runner.teardown())
    SyncService.lastTeardown = stopping.then(noop, noop)
    await stopping
    this.board.clearListeners()
    this.app = null
    this.plugin = null
    this.enrolment.endConnect()
  }

  /* -- What the screens and the status bar read ------------------------- */

  /** Whether an engine is running at all — that is, whether this device is set up. */
  isConnected(): boolean {
    return this.runner.isRunning()
  }

  /**
   * Whether there is nothing left to wait for.
   *
   * Not quite the same as *fully synced*: a device that is offline, paused or in error is not
   * going to settle by being waited on, and `runAfterSync` would hold a script for ever. Only
   * a sync actually in flight is worth waiting for.
   */
  isFullySynced(): boolean {
    return this.status.value.state !== 'syncing'
  }

  /** Called with the status whenever it changes. The returned function unsubscribes. */
  onStatusChange(cb: (status: SyncStatus) => void): () => void {
    return this.board.onStatusChange(cb)
  }

  /** The vault client the history, trash, usage and settings screens ask through. */
  client(): VaultClient | null {
    return this.runner.client()
  }

  /**
   * What this device remembers about one path: its file id on the server, the version it last
   * agreed with, and the sha of those bytes. Null when this device is not connected, and null
   * for a file the engine has not synced yet.
   *
   * The version history and the trash are addressed by file id rather than by path — a file
   * that was moved kept its id and changed its name — and this ledger is the only place a host
   * holds the two together. Read from the store rather than cached: a path's id changes when a
   * file is deleted and a new one is made at the same name, and a screen holding the old one
   * would offer somebody another file's history.
   */
  entryFor(path: string): Promise<StateEntry | null> {
    return this.runner.entryFor(path)
  }

  /**
   * Adds a line to the log the way the engine's own lines are added.
   *
   * The service writes what happens around the engine through it — connecting, enrolling,
   * disconnecting — and so may a screen that does something worth recording.
   */
  note(text: string): void {
    this.board.note(text)
  }

  /* -- The verbs -------------------------------------------------------- */

  /**
   * Sync now, whatever the triggers are doing — unless sync is paused, which the log says and
   * nothing moves. A failure is already in the status and the log.
   *
   * A device that is set up but has no engine was stopped by an error — an ignore file that
   * would not read, a ledger another window closed — and nothing else will try again: the
   * watcher that would notice went with the engine. So this is the retry, and the first run of
   * the engine it builds is the sync that was asked for.
   */
  syncNow(): Promise<void> {
    return this.runner.syncNow()
  }

  /** The deletes the engine holds back until they are decided: the path and file id of each. */
  heldDeletes(): Promise<HeldDelete[]> {
    return this.runner.heldDeletes()
  }

  /**
   * Decide about the held deletes the person was shown, named by `fileIds`: `confirm` sends
   * them to the server's trash, `restore` brings the files back from the server. Only those are
   * decided; a delete held since they were shown stays held, and is asked about next. Answers
   * how many were decided and whether a sync carried them out — not while sync is paused, when
   * they are carried out once it resumes — or null with no engine to decide.
   */
  async decideDeletes(
    kind: DeleteDecision['kind'],
    fileIds: readonly string[]
  ): Promise<{ decided: number; applied: boolean } | null> {
    this.note(
      `${kind === 'confirm' ? 'deleting everywhere' : 'putting back'} ${fileIds.length} held file(s)`
    )
    const result = await this.runner.decideDeletes(kind, fileIds)
    await this.heldPrompt.refresh()
    return result
  }

  /** The settings changes from other devices the engine holds staged, oldest first. */
  stagedSettings(): Promise<ChangeItem[]> {
    return this.runner.deferred()
  }

  /**
   * Reload now: write every staged settings change — but a file changed here since, which is
   * this device's edit and goes out as one — and then reload Obsidian, which reads its settings
   * only when a vault opens. Where Obsidian has no reload command, or nothing was written, it is
   * not reloaded, and the answer says so. Null with no engine to apply them.
   */
  async applySettingsAndReload(): Promise<AppliedSettings | null> {
    const result = await this.runner.applyDeferred()
    // Closed first: what the read finds that nobody was shown is asked about afresh.
    this.settingsPrompt.later()
    await this.settingsPrompt.refresh()
    if (result === null) return null
    this.note(
      `applied ${result.applied.length} staged settings file(s)` +
        (result.skipped.length > 0 ? `; ${result.skipped.length} changed here since` : '')
    )
    const reloader = this.settingsPrompt.reloader
    let reloaded = false
    if (result.applied.length > 0 && reloader.available()) {
      this.note('reloading Obsidian to read the settings that were applied')
      reloaded = reloader.reload()
    }
    return { applied: result.applied, skipped: result.skipped, reloaded }
  }

  /**
   * Keep this device's: this device's settings files go out over the staged changes — those at
   * `paths`, or all of them — as edits on the server's head, so every other device is asked
   * about them in turn. A file only the other device has is left there; nothing is deleted on
   * any device. Null with no engine.
   */
  async keepLocalSettings(paths?: string[]): Promise<DeferredKept | null> {
    const kept = await this.runner.keepLocal(paths)
    // Closed first: what the read finds that nobody was shown is asked about afresh.
    this.settingsPrompt.later()
    await this.settingsPrompt.refresh()
    if (kept !== null) {
      this.note(
        `keeping this device's settings: ${kept.kept.length} file(s) go out` +
          (kept.left.length > 0 ? `, ${kept.left.length} exist only elsewhere and stay there` : '')
      )
    }
    return kept
  }

  /** Walk the whole manifest again and then sync: for when this device widened what it takes. */
  rescan(): Promise<void> {
    return this.runner.rescan()
  }

  /**
   * Stop syncing until `resume`. Remembered in the connection, so it survives a restart — and
   * stays this device's: pausing a phone does not pause the laptop.
   *
   * The running engine is paused at once, and a reconcile is queued as well: pressed while an
   * engine is being built — at startup, or after a change to what this device syncs — there is
   * no engine yet to pause, and the one being built read the switch before it was pressed. The
   * reconcile runs after that build and puts the engine where the tab says it is.
   */
  pause(): void {
    this.keeper.save({ paused: true })
    this.runner.pause()
    this.note('paused')
    void this.serialise(() => this.runner.reconcile())
  }

  /** Sync again, and forget a token failure so the triggers are taken back. */
  resume(): void {
    this.keeper.save({ paused: false })
    this.runner.resume()
    this.note('resumed')
    void this.serialise(() => this.runner.reconcile())
  }

  /* -- Setting the device up -------------------------------------------- */

  /** Sign in and list the vaults this account can enrol a device on: see `Enrolment.connect`. */
  connect(serverUrl: string, email: string, password: string): Promise<VaultInfo[]> {
    return this.enrolment.connect(serverUrl, email, password)
  }

  /** Let a connect flow go without finishing it: see `Enrolment.endConnect`. */
  endConnect(): void {
    this.enrolment.endConnect()
  }

  /**
   * Enrol this device on a vault and start syncing, with the answer to the join question if it
   * was asked: see `Enrolment.chooseVault`.
   */
  chooseVault(choice: VaultChoice, deviceName: string, prefer?: JoinPrefer | null): Promise<void> {
    return this.enrolment.chooseVault(choice, deviceName, prefer)
  }

  /**
   * What the join dialog asks before this device syncs `vault` (`join.ts`): how many files each
   * side holds, and whether that makes it a question of which side wins, a confirmation, or a
   * reconnect. Asked of the vault a sign-in listed, or — with no vault — of the one this device
   * is connected to with the question still open, which a transfer leaves. Nothing is enrolled
   * or written; the server is asked only for its count, and a server that does not answer is
   * counted as unknown, which asks the question rather than skipping it.
   */
  async joinQuestion(vault?: VaultInfo): Promise<JoinQuestion> {
    const app = this.app
    if (app === null) throw new Error('the sync service has not been started yet')
    return askJoin({
      app,
      factory: factoryOf(this.deps),
      connection: toRaw(this.connection.value),
      token: this.keeper.token(),
      transport: transportOf(this.deps),
      timeoutMs: this.enrolment.revoker.timeoutMs,
      scriptsFolder: AbeleConfig.getInstance().ai.scriptsFolder,
      ownSettings: ownSettingsPath(app.vault.configDir, this.plugin?.manifest ?? { id: 'abele' }),
      note: (text) => this.note(text),
      vault,
    })
  }

  /** Answer the join question a transfer left open: see `Enrolment.answerJoin`. */
  answerJoin(prefer?: JoinPrefer | null): Promise<void> {
    return this.enrolment.answerJoin(prefer)
  }

  /** Stop syncing and forget how to reach the server: see `Enrolment.disconnect`. */
  disconnect(): Promise<void> {
    return this.enrolment.disconnect()
  }

  /** Disconnect and throw away the ledger and the keychain name: see `Enrolment.forget`. */
  forget(): Promise<void> {
    return this.enrolment.forget()
  }

  /** Tell the servers of devices this one left offline, now: see `Revoker.retry`. */
  retryPendingRevokes(): Promise<void> {
    return this.enrolment.revoker.retry()
  }

  /** Stop waiting to tell a server that a device left: see `Revoker.forget`. */
  forgetPendingRevoke(tokenId: string): void {
    this.enrolment.revoker.forget(tokenId)
  }

  /**
   * The live devices of this account on this vault, this one included, oldest first — asked of
   * the server with this device's own token, so no password is needed. Null on a device with no
   * engine running, which has no server to ask.
   */
  async listDevices(): Promise<DeviceInfo[] | null> {
    const client = this.runner.client()
    if (client === null) return null
    return client.listVaultDevices()
  }

  /**
   * Revoke another device of this account on this vault: the server stops accepting its token at
   * once, and its files stay where they are. Never this device, which leaves by Disconnect — that
   * forgets its token too, where a revoke from the list would leave it holding one nobody takes.
   * A device already gone is not an error: the list is read again either way.
   */
  async revokeDevice(deviceId: string): Promise<void> {
    if (deviceId === this.connection.value.deviceId) {
      throw new Error('this device leaves by Disconnect, not from the device list')
    }
    const client = this.runner.client()
    if (client === null) throw new Error('this device is not connected to a server')
    await client.revokeVaultDevice(deviceId)
    this.note(`revoked device ${deviceId}; the server no longer accepts it`)
  }

  /** Have the server make a device for a transfer to hand over: see `Enrolment.enrolSibling`. */
  enrolSibling(name: string): Promise<Sibling> {
    return this.enrolment.enrolSibling(name)
  }

  /** Take the connection a transfer brought: see `Enrolment.adoptTransferred`. */
  adoptTransferred(
    arrived: TransferredConnection,
    token: string,
    selective: SharedSelective
  ): Promise<void> {
    return this.enrolment.adoptTransferred(arrived, token, selective)
  }

  /** Tell the server a device made for a transfer is not needed: see `Enrolment`. */
  revokeTransferred(arrived: TransferredConnection, token: string): Promise<void> {
    return this.enrolment.revokeTransferred(arrived, token)
  }

  /**
   * The settings were saved: put the engine back in step with what was saved.
   *
   * What the running engine reads from the settings is the scripts folder; the rest of what it
   * was built on is the connection, which `updateConnection` reconciles itself.
   *
   * The config folder is not walked here. The one file an Abele save writes is its own
   * `data.json`, which syncs now, and the poll finds it the way it finds what Obsidian writes
   * there: within one poll, rather than a `stat` per config file on every save — screens save
   * as they are typed in. A setting that reaches another device half a minute later loses nothing.
   *
   * Subscribed to `AbeleConfig` at `init`, so every screen that saves reaches it, and so does a
   * `data.json` reloaded from disk — which, whatever another device wrote into it, names no
   * connection this one reads. Nothing filters them: `reconcile` compares what the engine was
   * built on against what is now in force and does nothing when they agree, which costs one
   * file `stat` and one hash. A filter
   * would have to guess which save was whose, and would drop somebody else's save that happened
   * to land inside the window.
   */
  onSettingsSaved(): void {
    void this.serialise(() => this.runner.reconcile())
  }

  /* -- Wiring ----------------------------------------------------------- */

  /** See `watchTheFront`: registered once, since `init` may run again in one session. */
  private hookVisibility(): void {
    const plugin = this.plugin
    if (plugin === null || this.watchingVisibility) return
    this.watchingVisibility = true
    watchTheFront(plugin, Platform.isMobile, {
      held: () => {
        this.heldPrompt.foreground()
        this.settingsPrompt.foreground()
      },
      sync: (visible) => {
        if (!this.runner.isRunning() || this.connection.value.paused) return
        this.note(visible ? 'the app came back to the front' : 'the app left the front')
        void this.syncNow()
      },
    })
  }

  /**
   * The names of the plugins in these config-folder folders, from each one's `manifest.json` on
   * this device; a plugin this device does not have, or whose manifest will not read, is left
   * out, and the dialog shows its folder instead.
   */
  private async pluginNames(ids: string[]): Promise<Record<string, string>> {
    const app = this.app
    const names: Record<string, string> = {}
    if (app === null) return names
    for (const id of ids) {
      try {
        const bytes = await app.vault.adapter.readBinary(
          `${app.vault.configDir}/plugins/${id}/manifest.json`
        )
        const manifest: unknown = JSON.parse(new TextDecoder().decode(bytes))
        const name = (manifest as { name?: unknown } | null)?.name
        if (typeof name === 'string' && name.trim() !== '') names[id] = name.trim()
      } catch {
        // Not here, or not JSON: the folder stands for it.
      }
    }
    return names
  }

  /** Runs the work after everything asked for before it, whether that succeeded or not. */
  private serialise<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.run(fn)
  }
}
