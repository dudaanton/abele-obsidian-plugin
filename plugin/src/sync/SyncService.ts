import { Platform, requestUrl, type App } from 'obsidian'
import { ref, type Ref } from 'vue'
import {
  IgnoreRules,
  SyncClient,
  SyncEngine,
  type PathMatcher,
  type StateEntry,
  type SyncFailure,
  type VaultClient,
} from '@abele/sync-core'
import { caseKey, PLAIN_HTTP_REFUSED, serverUrlProblem, type VaultInfo } from '@abele/sync-protocol'
import type AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import { isDeviceSecretId, secrets } from '@/secrets/SecretStore'
import { IndexedDbStateStore, stateDatabaseName } from './IndexedDbStateStore'
import { ObsidianFileSystem } from './ObsidianFileSystem'
import {
  connectionProblem,
  emptyConnection,
  MIGRATION_LINE,
  migrateConnection,
  readConnection,
  writeConnection,
  type DeviceConnection,
} from './connection'
import { Enrolment, type ConnectionPatch, type VaultChoice } from './enrolment'
import { readLedgerId, writeLedgerId, type LedgerId, type LocalStorage } from './ledgerId'
import {
  IGNORE_FILE,
  SCOPE_KEY,
  USER_AGENT,
  configLine,
  ignoreLine,
  isHidden,
  isWireConfigDir,
  messageOf,
  newStateId,
  noop,
  readIgnore,
  scopeKey,
  summarise,
} from './pieces'
import { DISCONNECTED_STATUS, statusOf, type SyncStatus } from './status'
import { fetchViaRequestUrl, wsFor } from './transport'

export { isWireConfigDir } from './pieces'
export type { ConnectionPatch, VaultChoice } from './enrolment'

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
 * adds `disconnected` above them for a vault nobody has set up. There is an engine exactly
 * when the connection names a server, a vault and a device token the keychain really holds;
 * with no engine the status is `disconnected` and every verb is a no-op that says so in the log.
 * `connect` and `chooseVault` build one, `disconnect` takes it away — those verbs are in
 * `enrolment.ts`, since none of them is the engine's business — and `updateConnection` and
 * `onSettingsSaved` build another when what the running one was built on has changed.
 *
 * ## The connection
 *
 * Where this device syncs and what it takes is not a setting: it is a record in the vault's
 * local storage (`connection.ts`), which no copy of the vault and no transfer carries. It is
 * read into {@link SyncService.connection} and written only through here, so the address rule
 * and the keychain-name check hold for every writer — a screen, the agent, a transfer.
 *
 * ## The scope rule
 *
 * What this device syncs — the selective settings and the vault's `.abele-sync-ignore` — is
 * hashed into a *scope key* and filed in the state under `scope`, exactly as the daemon files
 * it. When the stored key is not the current one, the feed has moved past files this device
 * passed over and now wants, so the first run is a `rescan()`, which walks the manifest again,
 * rather than a `sync()`, which only follows the feed. The key is recorded once the run got
 * through, so a rescan that failed is done again next time.
 *
 * ## The phone
 *
 * On mobile there is no socket, no file watcher and no background timer: the operating system
 * suspends the app the moment it leaves the screen, and a socket it will not let live is a
 * socket that only reconnects. A phone syncs once when the plugin starts and again every time
 * the app comes back to the front, which is exactly when its user is about to read something.
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

/** How many lines the log keeps. Older ones fall off the front. */
const LOG_LINES = 500

/**
 * What the user has to do about a token the server no longer takes. The client's own message
 * says the request was refused, which is true and no help at all.
 */
const REVOKED_HINT =
  'this device was revoked or its token is no longer taken; connect again from the Sync settings'

/**
 * Why a saved connection to plain http on another machine builds nothing. Said differently from
 * the sign-in refusal: this device was set up before the rule, and what it needs is a new sign-in.
 */
export const PLAIN_HTTP_CONNECTION =
  'this connection uses plain http to another machine; connect again with an https address'

/**
 * What a test replaces to run the service against a server in its own process.
 *
 * Production passes none of it: the transport is Obsidian's `requestUrl`, the socket is the
 * WebView's own, and the database is the window's IndexedDB. A test hands over a `fetch` into
 * the running server, a `WebSocket` bound to its port, and an `IDBFactory` of its own so that
 * no two tests share a database.
 */
export interface SyncServiceDeps {
  fetch?: typeof fetch
  WebSocket?: typeof WebSocket
  indexedDB?: IDBFactory
  /** How often the engine syncs with nothing prompting it. */
  fallbackMs?: number
  /** How often the configuration folder is walked. */
  pollMs?: number
}

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

  /** The status, for the status bar and the settings screens. */
  readonly status: Ref<SyncStatus> = ref({ ...DISCONNECTED_STATUS })

  /** The last {@link LOG_LINES} lines, oldest first. Every one of them is a `console.debug` too. */
  readonly log: Ref<string[]> = ref([])

  /**
   * This device's connection as local storage holds it, for the Sync tab to show. Written only
   * through {@link SyncService.updateConnection} and the verbs, never by assigning to it.
   */
  readonly connection: Ref<DeviceConnection> = ref(emptyConnection(Platform.isMobile))

  /** Where the connection is filed: the vault's local storage, from `openConnection` or `init`. */
  private storage: LocalStorage | null = null

  private app: App | null = null
  private plugin: AbelePlugin | null = null
  private deps: SyncServiceDeps = {}

  private engine: SyncEngine | null = null
  private store: IndexedDbStateStore | null = null
  private vault: VaultClient | null = null
  private unwatchStatus: (() => void) | null = null

  /** What the running engine was built on; a change to any of it means building another. */
  private built = ''
  /**
   * The device token the running engine's client holds. Kept apart from `built` rather than
   * joined into it, so no field that reads like an identity ever carries a secret — and kept at
   * all because re-enrolling puts a *new* token behind the same keychain id.
   */
  private builtToken = ''
  /** The scope key the running engine's settings and ignore file hash to. */
  private scope = ''

  /** Setting this device up and taking it down again (`enrolment.ts`). */
  private readonly enrolment = new Enrolment({
    app: () => this.app,
    transport: () => this.transport(),
    factory: () => this.factory(),
    note: (text) => this.note(text),
    connection: () => this.connection.value,
    saveConnection: (patch) => this.saveConnection(patch),
    serialise: <T>(fn: () => Promise<T>) => this.serialise(fn),
    teardown: () => this.teardown(),
    reconcile: () => this.reconcile(),
  })

  private readonly listeners = new Set<(status: SyncStatus) => void>()
  /** Whether the phone's visibility listener has been registered; it is registered once. */
  private watchingVisibility = false
  /** Drops the settings-saved subscription. */
  private unhookSettings: (() => void) | null = null
  /** What the last failure was, which is how `publish` knows to say what to do about it. */
  private lastFailure: SyncFailure | null = null

  /**
   * Everything that touches the engine goes through here, in the order it was asked for.
   *
   * `init`, a settings save, `chooseVault` and `disconnect` can all arrive while the previous
   * one is still opening a database or stopping an engine, and two of them interleaved would
   * leave a store closed under a running engine.
   */
  private queue: Promise<unknown> = Promise.resolve()

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
    this.storage = app
    this.connection.value = readConnection(app, Platform.isMobile)
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
      await this.reconcile()
    })
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
      this.token() !== null
    ) {
      this.publish({ ...DISCONNECTED_STATUS, state: connection.paused ? 'paused' : 'syncing' })
    }
  }

  /**
   * Read this device's connection out of the vault's local storage, moving it out of `data.json`
   * the first time a build that keeps it there has run on this device (`migrateConnection`).
   *
   * Called from `onload` as soon as the keychain is reachable — the move asks it whether the
   * token the file names is this device's — and before `announce`, which reads the result. The
   * `sync` block is the one `loadSettings` read off disk: by now the settings in memory have
   * already dropped the fields being moved. A file that still holds them is written again
   * without them, so the move happens once and the file stops naming this device.
   */
  async openConnection(app: App): Promise<void> {
    this.storage = app
    const config = AbeleConfig.getInstance()
    const migration = migrateConnection(
      app,
      config.takeLoadedSync(),
      (id) => secrets().device.get(id) !== '',
      Platform.isMobile
    )
    this.connection.value = readConnection(app, Platform.isMobile)
    if (migration === null) return
    this.note(MIGRATION_LINE[migration.outcome])
    if (migration.rewrite) await config.rewrite()
  }

  /**
   * Change this device's connection, and put the engine in step with it.
   *
   * Only the fields named are checked, by the rules a sign-in holds them to: a server address
   * the https rule refuses, and a keychain name this plugin never mints, are thrown back before
   * anything is written. What is already saved is not re-judged — a connection made before the
   * https rule can still have its switches changed, and `reconcile` says why it builds nothing.
   */
  async updateConnection(patch: ConnectionPatch): Promise<void> {
    const problem = connectionProblem({
      ...emptyConnection(),
      serverUrl: patch.serverUrl ?? '',
      deviceTokenId: patch.deviceTokenId ?? '',
    })
    if (problem !== null) throw new Error(problem)
    this.saveConnection(patch)
    await this.serialise(() => this.reconcile())
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
    const stopping = this.serialise(() => this.teardown())
    SyncService.lastTeardown = stopping.then(noop, noop)
    await stopping
    this.listeners.clear()
    this.app = null
    this.plugin = null
    this.enrolment.endConnect()
  }

  /* -- What the screens and the status bar read ------------------------- */

  /** Whether an engine is running at all — that is, whether this device is set up. */
  isConnected(): boolean {
    return this.engine !== null
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
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** The vault client the history, trash, usage and settings screens ask through. */
  client(): VaultClient | null {
    return this.vault
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
  async entryFor(path: string): Promise<StateEntry | null> {
    const store = this.store
    if (store === null || this.engine === null) return null
    return store.get(path)
  }

  /**
   * Adds a line to the log the way the engine's own lines are added.
   *
   * The service writes what happens around the engine through it — connecting, enrolling,
   * disconnecting — and so may a screen that does something worth recording.
   */
  note(text: string): void {
    console.debug(`[abele-sync] ${text}`)
    const lines = this.log.value
    lines.push(`${new Date().toISOString()} ${text}`)
    // In place rather than as a new array: a sync writes dozens of lines, and copying five
    // hundred of them each time is work for nothing. Vue tracks the mutation either way.
    if (lines.length > LOG_LINES) lines.splice(0, lines.length - LOG_LINES)
  }

  /* -- The verbs -------------------------------------------------------- */

  /**
   * Sync now, whatever the triggers are doing. A failure is already in the status and the log.
   *
   * A device that is set up but has no engine was stopped by an error — an ignore file that
   * would not read, a ledger another window closed — and nothing else will try again: the
   * watcher that would notice went with the engine. So this is the retry, and the first run of
   * the engine it builds is the sync that was asked for.
   */
  async syncNow(): Promise<void> {
    const engine = this.engine
    if (engine === null) {
      // The token is not read here: a keychain that throws is `reconcile`'s to report.
      const connection = this.connection.value
      if (connection.serverUrl === '' || connection.vaultId === '') {
        this.note('nothing to sync: this device is not connected to a server')
        return
      }
      this.note('sync now: nothing is running, so trying to start again')
      await this.serialise(() => this.reconcile())
      return
    }
    try {
      await engine.sync()
    } catch {
      // `onFail` has set the status and the engine has written the reason to the log.
    }
  }

  /** Walk the whole manifest again and then sync: for when this device widened what it takes. */
  async rescan(): Promise<void> {
    const engine = this.engine
    const store = this.store
    if (engine === null || store === null) {
      this.note('nothing to rescan: this device is not connected to a server')
      return
    }
    // Read before the await: a teardown while this runs sets `this.scope` back to nothing, and
    // writing that to the old store would tell the next start that any scope will do.
    const scope = this.scope
    try {
      await engine.rescan()
      await store.setMeta(SCOPE_KEY, scope)
    } catch {
      // The scope stays as it was, so the next start walks the manifest again.
    }
  }

  /**
   * Stop syncing until `resume`. Remembered in the connection, so it survives a restart — and
   * stays this device's: pausing a phone does not pause the laptop.
   */
  pause(): void {
    this.saveConnection({ paused: true })
    this.engine?.pause()
    this.note('paused')
  }

  /** Sync again, and forget a token failure so the triggers are taken back. */
  resume(): void {
    this.saveConnection({ paused: false })
    this.engine?.resume()
    this.note('resumed')
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
    void this.serialise(() => this.reconcile())
  }

  /* -- Building the engine ---------------------------------------------- */

  /**
   * Writes the connection with these fields changed, and shows it. Unchecked: the verbs that
   * call it write only what a server answered or what they empty, and `updateConnection` is the
   * road for anything else.
   *
   * Always marked as moved: a record this service wrote is the device's own, and the one-time
   * move out of `data.json` must never run over it.
   */
  private saveConnection(patch: ConnectionPatch): void {
    const next: DeviceConnection = { ...this.connection.value, ...patch, migrated: true }
    if (this.storage !== null) writeConnection(this.storage, next)
    else console.debug('[abele-sync] the connection changed before local storage was read')
    this.connection.value = next
  }

  /** The ledger this local vault syncs on, from its own local storage (`ledgerId.ts`). */
  private ledger(app: App): LedgerId {
    return readLedgerId(app)
  }

  /**
   * The ledger the engine is about to be built on, minted when this vault has none for the
   * vault the connection names.
   *
   * `chooseVault` mints one as it enrols. This is for a connection that arrived some other way —
   * a transfer, a move out of `data.json` — which names a server vault and carries no ledger id
   * at all: a fresh one is what makes the first run a walk of the manifest rather than a delete
   * of everything this disk does not hold.
   */
  private ledgerFor(app: App, vaultId: string): LedgerId {
    const held = this.ledger(app)
    if (held.stateId !== '' && held.vaultId === vaultId) return held
    const minted = { stateId: newStateId(), vaultId }
    writeLedgerId(app, minted)
    this.note('a fresh ledger for this vault: the first sync walks the whole manifest')
    return minted
  }

  /**
   * The device token, or null when the connection names one the keychain does not hold — or
   * names an id this plugin never mints, which is never read: pointed at a provider's key, it
   * would send that key to the server as a bearer token.
   */
  private token(): string | null {
    const id = this.connection.value.deviceTokenId
    if (!isDeviceSecretId(id)) return null
    const secret = secrets().device.get(id)
    return secret === '' ? null : secret
  }

  /**
   * Bring the engine in line with the connection and the settings.
   *
   * Everything the engine was built on is in one string, beside the token: change any of it and
   * another engine is built, because the selective settings and the ignore rules are read once,
   * when the scan filter is made. A change that moved neither only flips the pause switch —
   * which is what makes it safe for every save in the plugin to come through here.
   *
   * The whole body is guarded, not only the build: reading the ignore file, hashing the scope
   * and stopping the previous engine can all throw, and `init` has already published `syncing`
   * — a throw that escaped would pin the status there with nothing running behind it.
   */
  private async reconcile(): Promise<void> {
    const app = this.app
    if (app === null) return
    try {
      const connection = this.connection.value
      const token = this.token()
      if (connection.serverUrl === '' || connection.vaultId === '' || token === null) {
        if (this.engine !== null) {
          this.note('not connected: the connection names no vault to sync with')
        }
        await this.teardown()
        return
      }
      // Refused, not forgotten: the Sync tab still shows the connection and offers Disconnect.
      const problem = serverUrlProblem(connection.serverUrl)
      if (problem !== null) {
        throw new Error(problem === PLAIN_HTTP_REFUSED ? PLAIN_HTTP_CONNECTION : problem)
      }

      const ignoreText = await readIgnore(app)
      const scope = await scopeKey(connection.selective, ignoreText)
      // The scripts folder too: the engine's filter reads it once, when it is built.
      const scriptsFolder = AbeleConfig.getInstance().ai.scriptsFolder
      const built = [
        connection.serverUrl,
        connection.vaultId,
        connection.deviceTokenId,
        scope,
        scriptsFolder,
      ].join(' ')
      if (this.engine !== null && built === this.built && token === this.builtToken) {
        this.applyPause(connection.paused)
        return
      }

      // Quietly: the build says `syncing` next, and `disconnected` in between would swap the
      // Sync tab for the sign-in card under whoever just ticked a switch there.
      await this.teardown({ publish: false })
      this.built = built
      this.builtToken = token
      this.scope = scope
      await this.build(connection, token, ignoreText)
    } catch (error) {
      // A state database that would not open, a ledger that would not be read, a client the
      // connection will not build. Nothing is running and nothing will retry, so it has to be
      // said out loud: `disconnected` would hide the status bar and read as a device nobody
      // ever set up.
      //
      // The teardown goes first even though it publishes `disconnected` of its own — a build
      // that failed half way leaves an engine, a store and a client assigned, and `forget`
      // cannot delete a database something still holds. The error is published after it, so
      // that is the status that stands.
      const message = messageOf(error)
      await this.teardown()
      this.note(`sync could not start: ${message}`)
      this.publish({ ...DISCONNECTED_STATUS, state: 'error', lastError: message })
    }
  }

  /** Pause or resume an engine already running, to match what the connection now says. */
  private applyPause(paused: boolean): void {
    const engine = this.engine
    if (engine === null) return
    const running = engine.status.state !== 'paused'
    if (paused && running) engine.pause()
    if (!paused && !running) engine.resume()
  }

  private async build(
    connection: DeviceConnection,
    token: string,
    ignoreText: string | null
  ): Promise<void> {
    const app = this.app
    if (app === null) return
    const fs = new ObsidianFileSystem(app, {
      ...(this.deps.pollMs === undefined ? {} : { pollMs: this.deps.pollMs }),
      onWatch: (paths) => this.noticed(paths),
    })
    const store = await IndexedDbStateStore.open(
      this.factory(),
      stateDatabaseName(this.ledgerFor(app, connection.vaultId).stateId)
    )
    store.onClosedElsewhere(() => this.closedUnderEngine(store))
    let engine: SyncEngine
    let vault: VaultClient
    try {
      vault = new SyncClient({
        baseUrl: connection.serverUrl,
        fetch: this.transport(),
        WebSocket: this.socket(),
        token,
        userAgent: USER_AGENT,
      }).forVault(connection.vaultId)
      const scriptsFolder = AbeleConfig.getInstance().ai.scriptsFolder
      engine = new SyncEngine({
        client: vault,
        fs,
        state: store,
        selective: connection.selective,
        ignore: this.ignore(app, ignoreText),
        ...(scriptsFolder === '' ? {} : { scriptsFolder }),
        ...(this.deps.fallbackMs === undefined ? {} : { fallbackMs: this.deps.fallbackMs }),
        onSync: (report) => this.note(summarise(report)),
        onFail: (error, kind) => this.failed(error, kind),
        log: (line) => this.note(line),
      })
    } catch (error) {
      // Nothing may be left holding the database when no engine got built to close it.
      store.close()
      throw error
    }

    this.store = store
    this.vault = vault
    this.engine = engine
    this.unwatchStatus = engine.onStatus((engineStatus) => this.publish(statusOf(engineStatus)))
    // Not the engine's own status, which is `idle` before its first run has begun: `idle` means
    // *settled*, and `runAfterSync` would take it at its word in the gap before the first sync.
    this.publish({ ...statusOf(engine.status), state: connection.paused ? 'paused' : 'syncing' })
    this.note(`syncing vault ${connection.vaultId} with ${connection.serverUrl}`)
    this.note(ignoreLine(ignoreText))
    if (!isWireConfigDir(app.vault.configDir)) this.note(configLine(app.vault.configDir))
    await this.first(engine, store, connection.paused)
  }

  /**
   * The first run, and what keeps the engine going after it.
   *
   * The rescan is asked for *before* `start`, so it is the first run and the one `start`
   * prompts queues behind it; the scope is filed only once the run got through, so a rescan
   * that failed is done again on the next start. A phone gets no `start` at all — no watcher,
   * no socket, no clock — just this one sync, and another whenever the app comes back.
   */
  private async first(
    engine: SyncEngine,
    store: IndexedDbStateStore,
    paused: boolean
  ): Promise<void> {
    // Read before the awaits: a teardown while the rescan runs sets `this.scope` back to
    // nothing, and writing that to the old store would tell the next start any scope will do.
    const scope = this.scope
    const stored = await store.getMeta(SCOPE_KEY)
    // A state that never recorded a key has never finished a sync, and its first one walks the
    // manifest anyway.
    const due = stored !== null && stored !== scope
    if (paused) engine.pause()

    if (paused) {
      this.note('sync is paused; nothing will move until it is resumed')
    } else if (due) {
      this.note('rescan: what this device syncs changed since the last sync')
      void engine
        .rescan()
        .then(() => store.setMeta(SCOPE_KEY, scope))
        .catch(noop)
    } else {
      await store.setMeta(SCOPE_KEY, scope)
    }

    if (Platform.isMobile) {
      this.note('mobile: no socket and no background timers; syncing when the app is in front')
      if (!paused && !due) void engine.sync().catch(noop)
      return
    }
    engine.start()
  }

  /**
   * Another window of the app deleted or upgraded the ledger, and its connection closed under
   * the running engine. Every transaction after this would fail with IndexedDB's own message,
   * so the engine is stopped and the status says what happened and what to do.
   */
  private closedUnderEngine(store: IndexedDbStateStore): void {
    void this.serialise(async () => {
      if (this.store !== store) return
      await this.teardown()
      const message =
        'another window of this app closed the sync ledger; reload Obsidian to sync again'
      this.note(message)
      this.publish({ ...DISCONNECTED_STATUS, state: 'error', lastError: message })
    })
  }

  /**
   * Stop the engine, close the state database, and go back to saying nothing is connected —
   * unless `publish` is false, for a stop that a build follows at once: the status the old
   * engine left stands until the new one says `syncing`.
   */
  private async teardown({ publish = true }: { publish?: boolean } = {}): Promise<void> {
    const engine = this.engine
    const store = this.store
    this.unwatchStatus?.()
    this.unwatchStatus = null
    this.engine = null
    this.store = null
    this.vault = null
    this.built = ''
    this.builtToken = ''
    this.scope = ''
    // The engine that failed is gone; its failure must not colour the next one's message.
    this.lastFailure = null
    await engine?.stop()
    try {
      store?.close()
    } catch (error) {
      // The fields are already let go, so the caller is in a good state whatever the database
      // says; a throw from here would escape into whichever verb asked for the teardown.
      console.debug('[abele-sync] the state database would not close', error)
    }
    if (publish) this.publish({ ...DISCONNECTED_STATUS })
  }

  /* -- The pieces the engine is given ----------------------------------- */

  /**
   * What this device will not sync whatever the selective settings say.
   *
   * The vault's `.abele-sync-ignore` is one half, parsed by the core's own gitignore reader so
   * that the plugin and the daemon read one file the same way. The other half is this plugin's
   * own `data.json`. It no longer names this device — the connection is in local storage — but
   * it is still kept to this device for now: an older build elsewhere on the vault still writes
   * its connection into it, and taking another device's settings file is a change of its own.
   * Selective sync cannot say it — its exclusions are folders and categories, and the category
   * here (`pluginSettings`) covers every plugin at once — so it is ignored by name. Case-folded,
   * because a case-insensitive disk hands the same file back under any spelling.
   *
   * And every hidden path but the config folder. Obsidian indexes nothing with a dot-segment,
   * so a `.git/HEAD` or a `.DS_Store` this device pulled would be missing from the very next
   * scan, and a missing file the ledger knows is a delete — a daemon on a git or Syncthing
   * folder would lose them. Ignored here, they are neither taken nor deleted.
   */
  private ignore(app: App, ignoreText: string | null): PathMatcher {
    const rules = ignoreText === null ? null : IgnoreRules.parse(ignoreText)
    const id = this.plugin?.manifest.id ?? 'abele'
    const own = caseKey(`${app.vault.configDir}/plugins/${id}/data.json`)
    const configDir = app.vault.configDir
    return {
      ignores: (wirePath) =>
        isHidden(wirePath, configDir) ||
        caseKey(wirePath) === own ||
        (rules?.ignores(wirePath) ?? false),
    }
  }

  /** The engine's `fetch`: Obsidian's `requestUrl`, which no CORS rule and no phone refuses. */
  private transport(): typeof fetch {
    return this.deps.fetch ?? fetchViaRequestUrl(requestUrl)
  }

  private socket(): typeof WebSocket {
    return this.deps.WebSocket ?? wsFor()
  }

  private factory(): IDBFactory {
    return this.deps.indexedDB ?? window.indexedDB
  }

  /* -- Wiring ----------------------------------------------------------- */

  /**
   * A phone syncs when its user looks at it.
   *
   * Registered through the plugin so Obsidian takes the listener away when the plugin unloads,
   * and registered once — `init` may run again in a session whose settings were replaced.
   */
  private hookVisibility(): void {
    const plugin = this.plugin
    if (!Platform.isMobile || plugin === null || this.watchingVisibility) return
    this.watchingVisibility = true
    plugin.registerDomEvent(document, 'visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      if (this.engine === null || this.connection.value.paused) return
      this.note('the app came back to the front')
      void this.syncNow()
    })
  }

  /**
   * The batch the watcher handed the engine, looked at for one path of the host's own.
   *
   * `.abele-sync-ignore` is part of the scope key, so an edit to it means the engine has to be
   * built again on the new rules and the manifest walked. Nothing else in a batch is the
   * service's business — the engine has already taken it in.
   *
   * A phone never gets here: it runs no watcher at all, so an edit to the ignore file is picked
   * up at the next launch or the next settings save, both of which reconcile anyway.
   */
  private noticed(paths: string[]): void {
    if (!paths.some((path) => caseKey(path) === caseKey(IGNORE_FILE))) return
    this.note('the vault ignore file changed; reading it again')
    void this.serialise(() => this.reconcile())
  }

  private publish(raw: SyncStatus): void {
    const status = this.explain(raw)
    // A settings save that changed nothing about sync still reaches here, and a status that has
    // not moved must not repaint the status bar or wake `runAfterSync`.
    const held = this.status.value
    const same = (Object.keys(status) as Array<keyof SyncStatus>).every(
      (key) => held[key] === status[key]
    )
    if (same) return
    this.status.value = status
    for (const listener of [...this.listeners]) {
      try {
        listener(status)
      } catch (error) {
        console.debug('[abele-sync] a status listener threw', error)
      }
    }
  }

  /**
   * A failure the engine has already logged and turned into a status. Only a refused token
   * needs anything more said: no retry will change it, and the user has to enrol again.
   *
   * The kind is remembered rather than acted on here, because the engine writes its own
   * `lastError` *after* this hook returns; `explain` is where the message is replaced.
   */
  private failed(error: unknown, kind: SyncFailure): void {
    this.lastFailure = kind
    if (kind !== 'unauthorized') return
    this.note(`${REVOKED_HINT} (the server said: ${messageOf(error)})`)
  }

  /**
   * The status as a person can act on it.
   *
   * A refused token comes off the wire as "the request was refused", which is true and no help;
   * the tooltip and the settings screen get the sentence that says what to do instead. Anything
   * that is not an error clears the memory of the last failure.
   */
  private explain(status: SyncStatus): SyncStatus {
    if (status.state !== 'error') {
      this.lastFailure = null
      return status
    }
    if (this.lastFailure !== 'unauthorized') return status
    return { ...status, lastError: REVOKED_HINT }
  }

  /** Runs the work after everything asked for before it, whether that succeeded or not. */
  private serialise<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.then(noop, noop)
    return next
  }
}
