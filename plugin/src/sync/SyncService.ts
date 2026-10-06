import { Notice, Platform, type App } from 'obsidian'
import { ref, type Ref } from 'vue'
import type { DeleteDecision, HeldDelete, StateEntry, VaultClient } from '@abele/sync-core'
import type { ChangeItem, DeviceInfo, JoinPrefer, VaultInfo } from '@abele/sync-protocol'
import type AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { DeviceConnection } from './connection'
import { ConnectionKeeper } from './connectionKeeper'
import type { ConnectionEdit, VaultChoice } from './enrolment'
import type { SharedSelective, Sibling, TransferredConnection } from '@/transfer/connection'
import { tellJoinWaiting } from './joinState'
import type { AppliedSettings, KeptSettings } from './stagedSettings'
import { listDevices, revokeDevice } from './devices'
import { watchTheFront } from './phone'
import type { JoinQuestion } from './join'
import type { SyncServiceDeps } from './environment'
import { SerialQueue } from './queue'
import { pendingTeardown, recordTeardown } from './teardownBarrier'
import { wireParts, type ServiceParts } from './serviceParts'
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
 * running one was built on has changed. `serviceParts.ts` makes those parts and wires them to one
 * another; this class is the facade the screens and the agent see.
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
  private previousTeardown: Promise<void> = Promise.resolve()

  /** The runner, the enrolment verbs and the two prompts, wired together (`serviceParts.ts`). */
  private readonly parts: ServiceParts = wireParts({
    app: () => this.app,
    plugin: () => this.plugin,
    deps: () => this.deps,
    keeper: this.keeper,
    board: this.board,
    connection: () => this.connection.value,
    note: (text) => this.note(text),
    serialise: <T>(fn: () => Promise<T>) => this.serialise(fn),
    telling: (line) => {
      this.telling.value = line
    },
  })

  /** The engine itself: building, keeping in step, taking down (`engineRunner.ts`). */
  private readonly runner = this.parts.runner

  /** Setting this device up and taking it down again (`enrolment.ts`). */
  private readonly enrolment = this.parts.enrolment

  /** Many files deleted at once, and the question about them (`heldDeletes.ts`). */
  readonly heldPrompt = this.parts.heldPrompt

  /** Existing-private questions are separate from the personal upload lane. */
  readonly publicationPrompt = this.parts.publicationPrompt

  /** Obsidian settings staged from another device, and the question about them. */
  readonly settingsPrompt = this.parts.settingsPrompt

  /** Other plugins' code requires a separate, explicit confirmation. */
  readonly codePrompt = this.parts.codePrompt

  /** Whether the visibility listener has been registered; it is registered once. */
  private watchingVisibility = false
  /** Drops the settings-saved subscription. */
  private unhookSettings: (() => void) | null = null

  private constructor() {
    this.board.onStatusChange((status) => {
      void this.heldPrompt.noticed(status)
      void this.settingsPrompt.noticed(status)
      void this.codePrompt.noticed(status)
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
    // own teardown in the App barrier, and waiting for that from behind it in the queue is a
    // deadlock — the teardown cannot start until this item lets go.
    const pending = pendingTeardown(app)
    this.previousTeardown = pending
    void this.serialise(async () => {
      // Whatever instance a plugin reload left stopping goes first.
      await pending
      this.settingsPrompt.restoreAppliedWaiting()
      await this.runner.reconcile()
    }).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      const message = `the previous sync could not be stopped (${reason}); restart Obsidian before syncing again`
      this.note(message)
      this.board.publish({ ...DISCONNECTED_STATUS, state: 'error', lastError: message })
    })
    void this.retryPendingRevokes()
    tellJoinWaiting(this.connection.value)
  }

  /**
   * Say a pull is coming, before anything is opened (`ConnectionKeeper.announced`), and nothing
   * when none is.
   *
   * Called from `onload` as soon as the connection and the keychain are read, and again by
   * `init`. `runAfterSync` can be asked before the layout is ready — an `abele://` link that
   * opened the app cold — and a device that is set up is about to pull: `disconnected` in that
   * gap would let a script run over a vault the first pull is about to rewrite.
   */
  announce(): void {
    const state = this.keeper.announced()
    if (state !== null) this.board.publish({ ...DISCONNECTED_STATUS, state })
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
    await this.previousTeardown
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
    const stopping = this.queue.run(() => this.runner.teardown())
    if (this.app !== null) recordTeardown(this.app, Promise.all([this.previousTeardown, stopping]))
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
  decideDeletes(
    kind: DeleteDecision['kind'],
    fileIds: readonly string[]
  ): Promise<{ decided: number; applied: boolean; completed?: number } | null> {
    return this.heldPrompt.decide(kind, fileIds)
  }

  /** The settings changes from other devices the engine holds staged, oldest first. */
  stagedSettings(): Promise<ChangeItem[]> {
    return this.runner.deferred()
  }

  /**
   * Reload now, for the staged versions shown: see `StagedSettingsPrompt.applyAndReload`. Null
   * with no engine.
   */
  applySettingsAndReload(versionIds: readonly string[]): Promise<AppliedSettings | null> {
    return this.settingsPrompt.applyAndReload(versionIds)
  }

  applyPluginCodeAndReload(versionIds: readonly string[]): Promise<AppliedSettings | null> {
    return this.codePrompt.applyAndReload(versionIds)
  }

  keepLocalPluginCode(versionIds: readonly string[]): Promise<KeptSettings | null> {
    return this.codePrompt.keepLocal(undefined, versionIds)
  }

  async reloadAppliedSettings(): Promise<boolean> {
    return this.settingsPrompt.reloadApplied()
  }

  /**
   * Keep this device's, for the staged versions shown: see `StagedSettingsPrompt.keepLocal`.
   * Null with no engine.
   */
  keepLocalSettings(
    paths: string[] | undefined,
    versionIds: readonly string[]
  ): Promise<KeptSettings | null> {
    return this.settingsPrompt.keepLocal(paths, versionIds)
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
    this.setPaused(true)
  }

  /** Sync again, and forget a token failure so the triggers are taken back. */
  resume(): void {
    this.setPaused(false)
  }

  /** A switch local storage would not keep changes nothing, and says so (pi review #6). */
  private setPaused(paused: boolean): void {
    try {
      this.keeper.save({ paused })
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error))
      return
    }
    if (paused) this.runner.pause()
    else this.runner.resume()
    this.note(paused ? 'paused' : 'resumed')
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
  joinQuestion(vault?: VaultInfo): Promise<JoinQuestion> {
    return this.parts.joinQuestion(vault)
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

  /** The devices on this vault, from the server: see `devices.ts`. Null with no engine. */
  listDevices(): Promise<DeviceInfo[] | null> {
    return listDevices(this.runner.client())
  }

  /** Revoke another device on this vault, never this one: see `devices.ts`. */
  async revokeDevice(deviceId: string): Promise<void> {
    await revokeDevice(this.runner.client(), this.connection.value.deviceId, deviceId)
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
        this.codePrompt.foreground()
        this.publicationPrompt.foreground()
      },
      sync: (visible) => {
        if (!this.runner.isRunning() || this.connection.value.paused) return
        this.note(visible ? 'the app came back to the front' : 'the app left the front')
        void this.syncNow()
      },
    })
  }

  /** Runs the work after everything asked for before it, whether that succeeded or not. */
  private serialise<T>(fn: () => Promise<T>): Promise<T> {
    const before = this.previousTeardown
    return this.queue.run(async () => {
      await before
      return fn()
    })
  }
}
