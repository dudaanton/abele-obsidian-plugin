import { Platform, requestUrl, type App } from 'obsidian'
import { ref, type Ref } from 'vue'
import {
  IgnoreRules,
  SyncClient,
  SyncEngine,
  encodeText,
  settingsCategory,
  sha256,
  type PathMatcher,
  type SelectiveSettings,
  type StateEntry,
  type SyncFailure,
  type SyncReport,
  type VaultClient,
} from '@abele/sync-core'
import { caseKey, type VaultInfo } from '@abele/sync-protocol'
import type AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEVICE_SECRET_PREFIX, isDeviceSecretId, secrets } from '@/secrets/SecretStore'
import { IndexedDbStateStore, stateDatabaseName } from './IndexedDbStateStore'
import { ObsidianFileSystem } from './ObsidianFileSystem'
import { NO_LEDGER, migrateLedgerId, readLedgerId, writeLedgerId, type LedgerId } from './ledgerId'
import type { SyncSettings } from './settings'
import { DISCONNECTED_STATUS, statusOf, type SyncStatus } from './status'
import { fetchViaRequestUrl, wsFor } from './transport'

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
 * when the settings name a server, a vault and a device token the keychain really holds; with
 * no engine the status is `disconnected` and every verb is a no-op that says so in the log.
 * `connect` and `chooseVault` build one, `disconnect` takes it away, and `onSettingsSaved`
 * builds another when what the running one was built on has changed.
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
 * The device token is in Obsidian's keychain under a generated id, and only that id is in
 * `data.json` — which is itself kept out of the sync, since a vault is precisely what gets
 * copied to another machine. It is read and written through `secrets().device`, which is the
 * keychain alone: the synced secret store carries keys to every device, and this one token is
 * minted for this device only. The account password is used for one login and never stored; the
 * account token it returns lives in memory for the length of the connect flow. Nothing here
 * writes a token or a password to the log.
 */

/** How many lines the log keeps. Older ones fall off the front. */
const LOG_LINES = 500

/** The meta key the scope is filed under, the same one the daemon uses. */
const SCOPE_KEY = 'scope'

/** The vault's ignore file, read from its root. */
const IGNORE_FILE = '.abele-sync-ignore'

/**
 * Whether this vault's config folder is the one the wire knows.
 *
 * Core's settings switches recognise a single name for it, and core is what is asked rather
 * than the name being spelled out here: a device whose config folder is called something else
 * keeps it out of the sync altogether (`isHidden`).
 */
export function isWireConfigDir(configDir: string): boolean {
  return settingsCategory(`${configDir}/app.json`) !== null
}

/**
 * What the user has to do about a token the server no longer takes. The client's own message
 * says the request was refused, which is true and no help at all.
 */
const REVOKED_HINT =
  'this device was revoked or its token is no longer taken; connect again from the Sync settings'

/** What this plugin calls itself to a sync server. */
const USER_AGENT = 'abele-obsidian-plugin'

const noop = (): void => undefined

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

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

/** Which vault `chooseVault` was asked for: one that exists, or one to make. */
export type VaultChoice = string | { create: string }

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

  private app: App | null = null
  private plugin: AbelePlugin | null = null
  private deps: SyncServiceDeps = {}

  private engine: SyncEngine | null = null
  private store: IndexedDbStateStore | null = null
  private vault: VaultClient | null = null
  private unwatchStatus: (() => void) | null = null

  /** The account client of a connect flow, on a token that is never written down. */
  private account: SyncClient | null = null
  /** The server that account signed in to, so `chooseVault` files the one it enrolled against. */
  private accountUrl = ''

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
   * Read the settings and, if this device is set up, start syncing.
   *
   * Called from `onLayoutReady` rather than `onload`: the first thing the engine does is list
   * the vault, and Obsidian's file index is not complete until the layout is.
   */
  init(app: App, plugin: AbelePlugin, deps: SyncServiceDeps = {}): void {
    this.app = app
    this.plugin = plugin
    this.deps = deps
    // Once per vault: a ledger id an older version left in `data.json` moves to local storage.
    const config = AbeleConfig.getInstance()
    migrateLedgerId(app, config.legacyLedger)
    config.legacyLedger = null
    // A settings save is the one road every change to what this device syncs takes.
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
   * Say a pull is coming, before anything is opened: `syncing` (or `paused`) when the settings
   * name a server, a vault and a device token the keychain holds, and nothing otherwise.
   *
   * Called from `onload` as soon as the settings and the keychain are read, and again by
   * `init`. `runAfterSync` can be asked before the layout is ready — an `abele://` link that
   * opened the app cold — and a device that is set up is about to pull: `disconnected` in that
   * gap would let a script run over a vault the first pull is about to rewrite.
   */
  announce(): void {
    const settings = this.settings
    if (settings.serverUrl !== '' && settings.vaultId !== '' && this.token() !== null) {
      this.publish({ ...DISCONNECTED_STATUS, state: settings.paused ? 'paused' : 'syncing' })
    }
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
    this.account = null
    this.accountUrl = ''
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

  /** Sync now, whatever the triggers are doing. A failure is already in the status and the log. */
  async syncNow(): Promise<void> {
    const engine = this.engine
    if (engine === null) {
      this.note('nothing to sync: this device is not connected to a server')
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

  /** Stop syncing until `resume`. Remembered in the settings, so it survives a restart. */
  pause(): void {
    this.settings.paused = true
    void this.saveSettings()
    this.engine?.pause()
    this.note('paused')
  }

  /** Sync again, and forget a token failure so the triggers are taken back. */
  resume(): void {
    this.settings.paused = false
    void this.saveSettings()
    this.engine?.resume()
    this.note('resumed')
  }

  /* -- Setting the device up -------------------------------------------- */

  /**
   * Sign in and list the vaults this account can enrol a device on.
   *
   * The password is used for this one request and kept nowhere; the account token it answers
   * with is held in memory until `chooseVault` has enrolled. Neither is ever written to the
   * log or to `data.json`.
   */
  async connect(serverUrl: string, email: string, password: string): Promise<VaultInfo[]> {
    const baseUrl = serverUrl.trim().replace(/\/+$/, '')
    if (baseUrl === '') throw new Error('a server address is needed to connect')
    this.note(`connecting to ${baseUrl}`)
    const { account_token } = await SyncClient.login(baseUrl, this.transport(), email, password)
    const account = new SyncClient({
      baseUrl,
      fetch: this.transport(),
      token: account_token,
      userAgent: USER_AGENT,
    })
    const vaults = await account.listVaults()
    this.account = account
    this.accountUrl = baseUrl
    this.note(`signed in; the account has ${vaults.length} vault(s)`)
    return vaults
  }

  /**
   * Enrol this device on a vault — an existing one, or one made for it — and start syncing.
   *
   * The device token the server answers with goes straight into Obsidian's keychain; only the
   * id it is filed under is saved with the settings. Enrolling again over an existing setup
   * reuses that id, so the keychain never fills with tokens no device holds any more.
   *
   * The ledger id is minted here, once, and again whenever the chosen vault is not the one the
   * ledger describes — which is why the ledger's own vault is asked and not `vaultId`: a
   * disconnect empties the latter, so a device that left vault A and joined vault B would
   * otherwise open A's ledger, find every entry accounted for, and send deletes carrying A's
   * file ids. The ledger left behind is deleted once the old engine has let go of it. The account client is
   * dropped on the way out either way: it is on a token this flow has no further use for.
   */
  async chooseVault(choice: VaultChoice, deviceName: string): Promise<void> {
    const account = this.account
    const app = this.app
    if (account === null) throw new Error('sign in to the server before choosing a vault')
    if (app === null) throw new Error('the sync service has not been started yet')
    const name = deviceName.trim()
    if (name === '') throw new Error('this device needs a name to enrol under')

    /** The ledger this enrolment replaces, to be deleted once nothing is holding it. */
    let dropped: string | null = null
    try {
      const vaultId =
        typeof choice === 'string' ? choice : (await account.createVault(choice.create)).id
      const enrolled = await account.enrolDevice(
        vaultId,
        name,
        Platform.isMobile ? 'mobile' : 'desktop'
      )

      const settings = this.settings
      const tokenId = isDeviceSecretId(settings.deviceTokenId)
        ? settings.deviceTokenId
        : newSecretId()
      secrets().device.set(tokenId, enrolled.device_token)
      const ledger = this.ledger(app)
      if (ledger.stateId === '' || ledger.vaultId !== vaultId) {
        dropped = ledger.stateId === '' ? null : ledger.stateId
        writeLedgerId(app, { stateId: newStateId(), vaultId })
      }
      settings.serverUrl = this.accountUrl
      settings.vaultId = vaultId
      settings.deviceId = enrolled.device_id
      settings.deviceTokenId = tokenId
      settings.deviceName = name
      settings.paused = false
      await this.saveSettings()
      this.note(`enrolled as ${name} on vault ${vaultId}`)
    } finally {
      this.account = null
    }

    // `reconcile` sees the new token even behind an unchanged keychain id, so it builds another
    // engine of its own accord; the save above has already queued one, and this is what waits
    // for it. Only once that has stopped the old engine is the ledger it held free to delete.
    await this.serialise(() => this.reconcile())
    if (dropped !== null) await this.dropLedger(dropped)
  }

  /**
   * Deletes a ledger this device has no further use for.
   *
   * Never fatal. A ledger is a cache of what the server already holds, so the worst a database
   * that will not go is a little storage left behind — and refusing a connect over it would be
   * far worse than saying so in the log.
   */
  private async dropLedger(stateId: string): Promise<void> {
    try {
      await IndexedDbStateStore.delete(this.factory(), stateDatabaseName(stateId))
      this.note('dropped the ledger of the vault this device used to sync')
    } catch (error) {
      this.note(`the ledger of the previous vault could not be dropped: ${messageOf(error)}`)
    }
  }

  /**
   * Stop syncing and forget how to reach the server.
   *
   * The device token is cleared from the keychain and the identity fields from the settings.
   * What is kept is everything that is not a credential: the selective settings and the key
   * signature, which are the user's preferences and should not have to be given twice; the
   * `deviceTokenId`, which is a keychain *name* and whose reuse is what stops that keychain
   * filling with an entry per connect; and the state database, so reconnecting the same vault
   * costs a scan rather than a download of everything. `forget` is what throws those away.
   */
  async disconnect(): Promise<void> {
    await this.serialise(async () => {
      await this.teardown()
      const settings = this.settings
      // The secret goes and the id stays: `token()` reads a missing secret as no device, which
      // is exactly the truth.
      const tokenId = settings.deviceTokenId
      if (tokenId !== '') secrets().device.remove(tokenId)
      settings.serverUrl = ''
      settings.vaultId = ''
      settings.deviceId = ''
      settings.deviceName = ''
      settings.paused = false
      await this.saveSettings()
      this.account = null
      this.accountUrl = ''
      this.note('disconnected; the device token is forgotten')
    })
  }

  /** Disconnect and throw away what this device remembered: the ledger and the keychain name. */
  async forget(): Promise<void> {
    const app = this.app
    const stateId = app === null ? '' : this.ledger(app).stateId
    await this.disconnect()
    const settings = this.settings
    if (settings.deviceTokenId !== '') {
      secrets().device.remove(settings.deviceTokenId)
      settings.deviceTokenId = ''
    }
    if (app !== null) writeLedgerId(app, NO_LEDGER)
    await this.saveSettings()
    if (stateId === '') return
    await IndexedDbStateStore.delete(this.factory(), stateDatabaseName(stateId))
    this.note("forgot this device's ledger; the next connect starts from the manifest")
  }

  /**
   * The settings were saved: put the engine back in step with what was saved.
   *
   * The config folder is not walked here. It used to be, on the idea that a save wrote a file
   * worth noticing at once — but the one file an Abele save writes is its own `data.json`, which
   * never syncs, so every save paid a `stat` per config file to find nothing. What Obsidian
   * writes there is found by the poll, as ever.
   *
   * Subscribed to `AbeleConfig` at `init`, so every screen that saves reaches it — this
   * service's own saves included — and so does a `data.json` reloaded from disk. Nothing
   * filters them: `reconcile` compares what the engine was built on against what the settings
   * now say and does nothing when they agree, which costs one file `stat` and one hash. A filter
   * would have to guess which save was whose, and would drop somebody else's save that happened
   * to land inside the window.
   */
  onSettingsSaved(): void {
    void this.serialise(() => this.reconcile())
  }

  /* -- Building the engine ---------------------------------------------- */

  /** The settings as they stand. Mutated in place, the way the rest of the plugin does. */
  private get settings(): SyncSettings {
    return AbeleConfig.getInstance().sync
  }

  private async saveSettings(): Promise<void> {
    await AbeleConfig.getInstance().saveSettings()
  }

  /** The ledger this local vault syncs on, from its own local storage (`ledgerId.ts`). */
  private ledger(app: App): LedgerId {
    return readLedgerId(app) ?? NO_LEDGER
  }

  /**
   * The ledger the engine is about to be built on, minted when this vault has none for the
   * vault the settings name.
   *
   * `chooseVault` mints one as it enrols. This is for settings that arrived some other way — a
   * transfer, a copied or synced `data.json` — which name a server vault and carry no ledger
   * id at all: a fresh one is what makes the first run a walk of the manifest rather than a
   * delete of everything this disk does not hold.
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
   * The device token, or null when the settings name one the keychain does not hold — or name
   * an id this plugin never mints, which is never read: pointed at a provider's key, it would
   * send that key to the server as a bearer token.
   */
  private token(): string | null {
    const id = this.settings.deviceTokenId
    if (!isDeviceSecretId(id)) return null
    const secret = secrets().device.get(id)
    return secret === '' ? null : secret
  }

  /**
   * Bring the engine in line with the settings.
   *
   * Everything the engine was built on is in one string, beside the token: change any of it and
   * another engine is built, because the selective settings and the ignore rules are read once,
   * when the scan filter is made. A settings save that moved neither only flips the pause
   * switch — which is what makes it safe for every save in the plugin to come through here.
   *
   * The whole body is guarded, not only the build: reading the ignore file, hashing the scope
   * and stopping the previous engine can all throw, and `init` has already published `syncing`
   * — a throw that escaped would pin the status there with nothing running behind it.
   */
  private async reconcile(): Promise<void> {
    const app = this.app
    if (app === null) return
    try {
      const settings = this.settings
      const token = this.token()
      if (settings.serverUrl === '' || settings.vaultId === '' || token === null) {
        if (this.engine !== null) {
          this.note('not connected: the settings name no vault to sync with')
        }
        await this.teardown()
        return
      }

      const ignoreText = await readIgnore(app)
      const scope = await scopeKey(settings.selective, ignoreText)
      // The scripts folder too: the engine's filter reads it once, when it is built.
      const scriptsFolder = AbeleConfig.getInstance().ai.scriptsFolder
      const built = [
        settings.serverUrl,
        settings.vaultId,
        settings.deviceTokenId,
        scope,
        scriptsFolder,
      ].join(' ')
      if (this.engine !== null && built === this.built && token === this.builtToken) {
        this.applyPause(settings.paused)
        return
      }

      await this.teardown()
      this.built = built
      this.builtToken = token
      this.scope = scope
      await this.build(settings, token, ignoreText)
    } catch (error) {
      // A state database that would not open, a ledger that would not be read, a client the
      // settings will not build. Nothing is running and nothing will retry, so it has to be
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

  /** Pause or resume an engine already running, to match what the settings now say. */
  private applyPause(paused: boolean): void {
    const engine = this.engine
    if (engine === null) return
    const running = engine.status.state !== 'paused'
    if (paused && running) engine.pause()
    if (!paused && !running) engine.resume()
  }

  private async build(
    settings: SyncSettings,
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
      stateDatabaseName(this.ledgerFor(app, settings.vaultId).stateId)
    )
    let engine: SyncEngine
    let vault: VaultClient
    try {
      vault = new SyncClient({
        baseUrl: settings.serverUrl,
        fetch: this.transport(),
        WebSocket: this.socket(),
        token,
        userAgent: USER_AGENT,
      }).forVault(settings.vaultId)
      const scriptsFolder = AbeleConfig.getInstance().ai.scriptsFolder
      engine = new SyncEngine({
        client: vault,
        fs,
        state: store,
        selective: settings.selective,
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
    this.publish({ ...statusOf(engine.status), state: settings.paused ? 'paused' : 'syncing' })
    this.note(`syncing vault ${settings.vaultId} with ${settings.serverUrl}`)
    this.note(ignoreLine(ignoreText))
    if (!isWireConfigDir(app.vault.configDir)) this.note(configLine(app.vault.configDir))
    await this.first(engine, store, settings)
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
    settings: SyncSettings
  ): Promise<void> {
    // Read before the awaits: a teardown while the rescan runs sets `this.scope` back to
    // nothing, and writing that to the old store would tell the next start any scope will do.
    const scope = this.scope
    const stored = await store.getMeta(SCOPE_KEY)
    // A state that never recorded a key has never finished a sync, and its first one walks the
    // manifest anyway.
    const due = stored !== null && stored !== scope
    if (settings.paused) engine.pause()

    if (settings.paused) {
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
      if (!settings.paused && !due) void engine.sync().catch(noop)
      return
    }
    engine.start()
  }

  /** Stop the engine, close the state database, and go back to saying nothing is connected. */
  private async teardown(): Promise<void> {
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
    this.publish({ ...DISCONNECTED_STATUS })
  }

  /* -- The pieces the engine is given ----------------------------------- */

  /**
   * What this device will not sync whatever the selective settings say.
   *
   * The vault's `.abele-sync-ignore` is one half, parsed by the core's own gitignore reader so
   * that the plugin and the daemon read one file the same way. The other half is this plugin's
   * own `data.json`, which holds the vault id, the device id and the id of the keychain entry
   * the device token sits in: a vault is what a sync copies to another machine, and that file
   * describes *this* machine. Selective sync cannot say it — its exclusions are folders and
   * categories, and the category here (`pluginSettings`) covers every plugin at once — so it
   * is ignored by name. Case-folded, because a case-insensitive disk hands the same file back
   * under any spelling.
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
      if (this.engine === null || this.settings.paused) return
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

/** A keychain id: lowercase letters, digits and dashes, which is all Obsidian accepts. */
function newSecretId(): string {
  return `${DEVICE_SECRET_PREFIX}${randomStem()}`
}

/** The name this device's ledger is filed under. Local to this vault and shown to nobody. */
function newStateId(): string {
  return `${randomStem()}${randomStem()}`
}

function randomStem(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0')
}

/**
 * Whether a wire path is one this device leaves alone because Obsidian cannot see it: any path
 * with a segment that starts with a dot, except the config folder when it is the one the wire
 * knows. Inside that folder the engine's own settings switches decide.
 */
function isHidden(wirePath: string, configDir: string): boolean {
  if (!wirePath.split('/').some((segment) => segment.startsWith('.'))) return false
  return !(isWireConfigDir(configDir) && wirePath.startsWith(`${configDir}/`))
}

/** What the log says on a device whose config folder the sync does not carry. */
function configLine(configDir: string): string {
  return (
    `the config folder here is ${configDir}, which sync does not know: ` +
    'Obsidian settings do not sync on this device, and nothing in either folder is touched'
  )
}

/** What the log says about the rules the engine was just built on. */
function ignoreLine(ignoreText: string | null): string {
  if (ignoreText === null) return `no ${IGNORE_FILE} in this vault`
  const rules = ignoreText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#')).length
  return `${IGNORE_FILE}: ${rules} rule(s) in force`
}

/**
 * What this device syncs, as one short string: the selective settings and the ignore file
 * together, since a pattern dropped from `.abele-sync-ignore` widens the scope exactly as a
 * type switched on does. The daemon's key, computed the same way — through WebCrypto rather
 * than Node's, because this runs in a WebView.
 */
async function scopeKey(selective: SelectiveSettings, ignoreText: string | null): Promise<string> {
  return sha256(encodeText(JSON.stringify({ selective, ignore: ignoreText })))
}

/**
 * The vault's `.abele-sync-ignore` as it reads, or null when it has none.
 *
 * Through the adapter and as bytes: the file is at the vault root, but Obsidian's file index
 * hides a leading dot, so `vault.read` would never find it.
 *
 * Null only when the file is not there. One that is there and will not be read — locked, an
 * iCloud placeholder, a permissions slip — throws: syncing as if it were absent would upload
 * exactly what it keeps off the server, and `reconcile` turns the throw into an error status
 * with nothing running.
 */
async function readIgnore(app: App): Promise<string | null> {
  try {
    if (!(await app.vault.adapter.exists(IGNORE_FILE))) return null
    return new TextDecoder().decode(await app.vault.adapter.readBinary(IGNORE_FILE))
  } catch (error) {
    console.debug('[abele-sync] cannot read the ignore file', error)
    throw new Error(`${IGNORE_FILE} is there but could not be read: ${messageOf(error)}`)
  }
}

/** What one sync did, in the line the log keeps — the same one the daemon writes. */
function summarise(report: SyncReport): string {
  const pulled = report.pull.applied + (report.secondPull?.applied ?? 0)
  const held = (report.secondPull ?? report.pull).held.length
  return (
    `sync: done (pulled ${pulled}, pushed ${report.push.applied}, ` +
    `merged ${report.push.merged}, conflicts ${report.push.conflicts}, ` +
    `rejected ${report.push.rejected.length}, held ${held})`
  )
}
