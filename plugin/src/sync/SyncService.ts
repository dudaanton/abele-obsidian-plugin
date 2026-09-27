import { Platform, type App } from 'obsidian'
import { ref, type Ref } from 'vue'
import type { StateEntry, VaultClient } from '@abele/sync-core'
import { serverUrlProblem, type VaultInfo } from '@abele/sync-protocol'
import type AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { DeviceConnection } from './connection'
import { ConnectionKeeper } from './connectionKeeper'
import { Enrolment, type ConnectionEdit, type VaultChoice } from './enrolment'
import type { SharedSelective, Sibling, TransferredConnection } from '@/transfer/connection'
import { EngineRunner } from './engineRunner'
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
      pluginId: () => this.plugin?.manifest.id ?? 'abele',
      deps: () => this.deps,
      connection: () => this.connection.value,
      token: () => this.keeper.token(),
      damage: () => this.keeper.damage(),
      serialise: <T>(fn: () => Promise<T>) => this.serialise(fn),
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

  /** Whether the phone's visibility listener has been registered; it is registered once. */
  private watchingVisibility = false
  /** Drops the settings-saved subscription. */
  private unhookSettings: (() => void) | null = null

  private constructor() {}

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
      this.board.publish({
        ...DISCONNECTED_STATUS,
        state: connection.paused ? 'paused' : 'syncing',
      })
    }
  }

  /** Read this device's connection, moving it out of `data.json`: see `ConnectionKeeper.open`. */
  openConnection(app: App): Promise<void> {
    return this.keeper.open(app)
  }

  /**
   * Change this device's connection, and put the engine in step with it. Checked first, by the
   * rules `ConnectionKeeper.check` holds every change from outside to; nothing is written when
   * it throws.
   */
  async updateConnection(patch: ConnectionEdit): Promise<void> {
    this.keeper.check(patch)
    this.keeper.save(patch)
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

  /** Enrol this device on a vault and start syncing: see `Enrolment.chooseVault`. */
  chooseVault(choice: VaultChoice, deviceName: string): Promise<void> {
    return this.enrolment.chooseVault(choice, deviceName)
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
   * The config folder is not walked here. It used to be, on the idea that a save wrote a file
   * worth noticing at once — but the one file an Abele save writes is its own `data.json`, which
   * never syncs, so every save paid a `stat` per config file to find nothing. What Obsidian
   * writes there is found by the poll, as ever.
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

  /**
   * A phone syncs when its user looks at it, and as they put it away.
   *
   * Coming back, because the clock was frozen while the app was away and whatever other devices
   * did since is what the user is about to read. Going away, because the system is about to
   * freeze the app, and an edit whose push is still waiting on the watcher's pause would sit
   * here until the app is next opened; the system gives a moment, and a small push fits in it.
   *
   * Registered through the plugin so Obsidian takes the listener away when the plugin unloads,
   * and registered once — `init` may run again in a session whose settings were replaced.
   */
  private hookVisibility(): void {
    const plugin = this.plugin
    if (!Platform.isMobile || plugin === null || this.watchingVisibility) return
    this.watchingVisibility = true
    plugin.registerDomEvent(document, 'visibilitychange', () => {
      if (!this.runner.isRunning() || this.connection.value.paused) return
      const visible = document.visibilityState === 'visible'
      this.note(visible ? 'the app came back to the front' : 'the app left the front')
      void this.syncNow()
    })
  }

  /** Runs the work after everything asked for before it, whether that succeeded or not. */
  private serialise<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.run(fn)
  }
}
