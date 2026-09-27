import { Platform, type App } from 'obsidian'
import { toRaw } from 'vue'
import {
  SyncClient,
  SyncEngine,
  type StateEntry,
  type VaultClient,
} from '@abele/sync-core'
import { caseKey, PLAIN_HTTP_REFUSED, serverUrlProblem } from '@abele/sync-protocol'
import { AbeleConfig } from '@/services/AbeleConfig'
import { IndexedDbStateStore, stateDatabaseName } from './IndexedDbStateStore'
import { ObsidianFileSystem } from './ObsidianFileSystem'
import { selectiveFrom, type DeviceConnection, type JoinState } from './connection'
import { JOIN_SCOPE, joinLine, joinOf } from './joinState'
import { enrolledElsewhere } from './enrolment'
import {
  factoryOf,
  fallbackMsOf,
  pollMsOf,
  socketOf,
  transportOf,
  type SyncServiceDeps,
} from './environment'
import { newStateId } from './ids'
import { readLedgerId, writeLedgerId, type LedgerId } from './ledgerId'
import { messageOf, summarise } from './messages'
import { OwnSettingsWatch } from './ownSettings'
import { noop } from './queue'
import {
  IGNORE_FILE,
  SCOPE_KEY,
  configLine,
  ignoreFor,
  ignoreLine,
  isWireConfigDir,
  readIgnore,
  scopeKey,
} from './scope'
import { DISCONNECTED_STATUS, JOINING_LINE, statusOf } from './status'
import type { StatusBoard } from './statusBoard'
import { USER_AGENT } from './transport'

/**
 * The engine's lifecycle: building one on the connection, keeping it in step, and taking it
 * down again.
 *
 * There is an engine exactly when the connection names a server, a vault and a device token
 * the keychain really holds; with none the status is `disconnected` and every verb is a no-op
 * that says so in the log. `reconcile` is the one road to a build: whoever changed what the
 * engine stands on — a verb, a settings save, the ignore file — queues one, and it builds
 * another only when something the running engine was built on has moved.
 *
 * ## The scope rule
 *
 * What this device syncs — the selective settings and the vault's `.abele-sync-ignore` — is
 * hashed into a *scope key* and filed in the state under `scope`, exactly as the daemon files
 * it. When the stored key is not the current one, the feed has moved past files this device
 * passed over and now wants, so the first run is a `rescan()`, which walks the manifest again,
 * rather than a `sync()`, which only follows the feed. The key is recorded once the run got
 * through, so a rescan that failed is done again next time.
 */

/** What Sync now and Rescan say while the device is paused, after which verb was refused. */
const PAUSED_REFUSAL = 'sync is paused; nothing moves until Resume'

/**
 * Why a saved connection to plain http on another machine builds nothing. Said differently from
 * the sign-in refusal: this device was set up before the rule, and what it needs is a new sign-in.
 */
export const PLAIN_HTTP_CONNECTION =
  'this connection uses plain http to another machine; connect again with an https address'

/** What the runner is handed by the service that owns the connection. */
export interface EngineHost {
  /** The app the service was started with, or null before `init` and after `destroy`. */
  app(): App | null
  /** The plugin's id, whose own `data.json` a pull may write (`OwnSettingsWatch`). */
  pluginId(): string
  deps(): SyncServiceDeps
  connection(): DeviceConnection
  /** The device token, or null when the keychain holds none for the connection. */
  token(): string | null
  /** What was wrong with the record as it was read, or null (`ConnectionKeeper.damage`). */
  damage(): string | null
  /** Runs after everything already asked of the engine (`SyncService.serialise`). */
  serialise<T>(fn: () => Promise<T>): Promise<T>
  /**
   * A run wrote the plugin's own `data.json`: the plugin reloads its settings. `replaced` is
   * what the file said before, when the write was the vault's copy taking the place of this
   * device's at a first contact (`OwnSettingsWatch`), and null otherwise.
   */
  settingsArrived(replaced: string | null): void
  /** What the plugin's settings file says now, as canonical JSON: what `replaced` holds. */
  settingsMeaning(): Promise<string>
  /**
   * A run of the engine built with this join got through: the host forgets the
   * choice, so no later engine is built with it, and says so.
   */
  joined(join: JoinState): void
}

export class EngineRunner {
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

  constructor(
    private readonly host: EngineHost,
    private readonly board: StatusBoard
  ) {}

  /* -- What the service reads ------------------------------------------- */

  /** Whether an engine is running at all. */
  isRunning(): boolean {
    return this.engine !== null
  }

  /** The vault client of the running engine, or null. */
  client(): VaultClient | null {
    return this.vault
  }

  /** What the running engine's ledger holds for one path (`SyncService.entryFor`). */
  async entryFor(path: string): Promise<StateEntry | null> {
    const store = this.store
    if (store === null || this.engine === null) return null
    return store.get(path)
  }

  /* -- The verbs -------------------------------------------------------- */

  /** See `SyncService.syncNow`. */
  async syncNow(): Promise<void> {
    const engine = this.engine
    if (engine === null) {
      // The token is not read here: a keychain that throws is `reconcile`'s to report.
      const connection = this.host.connection()
      if (connection.serverUrl === '' || connection.vaultId === '') {
        this.board.note('nothing to sync: this device is not connected to a server')
        return
      }
      this.board.note('sync now: nothing is running, so trying to start again')
      await this.host.serialise(() => this.reconcile())
      return
    }
    // The engine would run a sync it is asked for outright, paused or not; the switch says
    // nothing moves until Resume, and that is what the person who pressed it was told.
    if (this.host.connection().paused) {
      this.board.note(`sync now: ${PAUSED_REFUSAL}`)
      return
    }
    try {
      await engine.sync()
    } catch {
      // `onFail` has set the status and the engine has written the reason to the log.
    }
  }

  /** See `SyncService.rescan`. */
  async rescan(): Promise<void> {
    const engine = this.engine
    const store = this.store
    if (engine === null || store === null) {
      this.board.note('nothing to rescan: this device is not connected to a server')
      return
    }
    // The scope stays unrecorded, so the walk still happens: at the next start, or at Resume
    // when what this device takes has widened (the engine settles that itself).
    if (this.host.connection().paused) {
      this.board.note(`rescan: ${PAUSED_REFUSAL}`)
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

  /** Pause the running engine, if there is one. */
  pause(): void {
    this.engine?.pause()
  }

  /** Resume the running engine, if there is one. */
  resume(): void {
    this.engine?.resume()
  }

  /* -- Building the engine ---------------------------------------------- */

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
    const held = readLedgerId(app)
    if (held.stateId !== '' && held.vaultId === vaultId) return held
    const minted = { stateId: newStateId(), vaultId }
    writeLedgerId(app, minted)
    this.board.note('a fresh ledger for this vault: the first sync walks the whole manifest')
    return minted
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
  async reconcile(): Promise<void> {
    const app = this.host.app()
    if (app === null) return
    try {
      const connection = this.host.connection()
      const token = this.host.token()
      const damage = this.host.damage()
      // A record that lost its token id reads as a device nobody set up; said as an error
      // instead, so the Sync tab shows why and offers Disconnect rather than the sign-in card.
      if (damage !== null && token === null) throw new Error(damage)
      if (connection.serverUrl === '' || connection.vaultId === '' || token === null) {
        if (this.engine !== null) {
          this.board.note('not connected: the connection names no vault to sync with')
        }
        await this.teardown()
        return
      }
      // Refused, not forgotten: the Sync tab still shows the connection and offers Disconnect.
      const problem = serverUrlProblem(connection.serverUrl)
      if (problem !== null) {
        throw new Error(problem === PLAIN_HTTP_REFUSED ? PLAIN_HTTP_CONNECTION : problem)
      }
      // The token goes to the server that minted it and nowhere else: an address changed since
      // (by hand, by an older build) is refused, and Disconnect still tells the right server.
      const elsewhere = enrolledElsewhere(connection.serverUrl, connection.enrolledUrl)
      if (elsewhere !== null) throw new Error(elsewhere)

      // A connection a transfer brought, onto a vault that has files, into one that has files
      // too: which side wins is asked first, and nothing moves until it is answered.
      const join = joinOf(connection)
      if (join?.ask === true) {
        await this.awaitJoin()
        return
      }

      const ignoreText = await readIgnore(app)
      const scope =
        (await scopeKey(connection.selective, ignoreText)) + (join === null ? '' : JOIN_SCOPE)
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
      await this.build(connection, token, ignoreText, join)
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
      this.board.note(`sync could not start: ${message}`)
      this.board.publish({ ...DISCONNECTED_STATUS, state: 'error', lastError: message })
    }
  }

  /**
   * No engine while the join question is open: whatever is running stops, and the status says a
   * choice is waiting — said once in the log, not at every reconcile a settings save queues.
   */
  private async awaitJoin(): Promise<void> {
    const waiting = this.engine === null && this.board.status.value.state === 'joining'
    await this.teardown({ publish: false })
    if (!waiting) this.board.note(`not syncing yet: ${JOINING_LINE}`)
    this.board.publish({ ...DISCONNECTED_STATUS, state: 'joining' })
  }

  /** Pause or resume an engine already running, to match what the connection now says. */
  private applyPause(paused: boolean): void {
    const engine = this.engine
    if (engine === null) return
    const running = engine.status.state !== 'paused'
    if (paused && running) engine.pause()
    if (!paused && !running) engine.resume()
  }

  /**
   * `join` is the join in progress, or null. While there is one the engine is told the side the
   * person chose, and leaves this device's own `data.json` alone: every create of a join carries
   * that side, and "this device wins" would make a fresh device's defaults the vault's settings
   * whatever their age. Once the join is done the next engine takes the file up the way a first
   * contact does — the vault's copy wins, and this one goes to the file's history.
   */
  private async build(
    connection: DeviceConnection,
    token: string,
    ignoreText: string | null,
    join: JoinState | null
  ): Promise<void> {
    const app = this.host.app()
    if (app === null) return
    const deps = this.host.deps()
    const pollMs = pollMsOf(deps)
    const fallbackMs = fallbackMsOf(deps)
    const ownSettings = `${app.vault.configDir}/plugins/${this.host.pluginId()}/data.json`
    const settings = new OwnSettingsWatch(
      ownSettings,
      (replaced) => this.host.settingsArrived(replaced),
      () => this.host.settingsMeaning()
    )
    const fs = new ObsidianFileSystem(app, {
      ...(pollMs === undefined ? {} : { pollMs }),
      onWatch: (paths) => this.noticed(paths),
      onEngineWrite: (path) => settings.noteWrite(path),
      yieldsToServer: (path) => settings.yields(path),
    })
    const store = await IndexedDbStateStore.open(
      factoryOf(deps),
      stateDatabaseName(this.ledgerFor(app, connection.vaultId).stateId)
    )
    store.onClosedElsewhere(() => this.closedUnderEngine(store))
    settings.useLedger(store)
    let engine: SyncEngine
    let vault: VaultClient
    try {
      vault = new SyncClient({
        baseUrl: connection.serverUrl,
        fetch: transportOf(deps),
        WebSocket: socketOf(deps),
        token,
        userAgent: USER_AGENT,
      }).forVault(connection.vaultId)
      const scriptsFolder = AbeleConfig.getInstance().ai.scriptsFolder
      engine = new SyncEngine({
        client: vault,
        fs,
        state: store,
        // A plain copy, never the ref's own: the engine files it in the state database with the
        // scope its marks were taken under, and IndexedDB cannot clone a reactive proxy.
        selective: selectiveFrom(toRaw(connection.selective), Platform.isMobile),
        // The ignore file and the hidden paths (`ignoreFor`), and while a join is in progress
        // this device's own `data.json`. Not that file otherwise: it names no device, so it
        // follows the Plugin settings switch like any other plugin's (`OwnSettingsWatch`).
        ignore: ignoreFor(app.vault.configDir, ignoreText, join === null ? null : ownSettings),
        // Filed with the scope, so a later engine can tell what this ignore file left out.
        ignoreText,
        ...(scriptsFolder === '' ? {} : { scriptsFolder }),
        ...(fallbackMs === undefined ? {} : { fallbackMs }),
        ...(join?.prefer ? { joinPrefer: join.prefer } : {}),
        onSync: (report) => {
          this.board.note(summarise(report))
          settings.settle()
          // Any run that got through ends the join. One that started at the feed's start walked
          // the vault and so did the join; one that started past it sent no side (the engine
          // sends one only from 0) — a join whose walk held nothing moved past 0 before its push,
          // and a push cut off there would otherwise leave the join open for ever (task-8
          // review, #1).
          if (join !== null) this.host.joined(join)
        },
        // A run that failed after its pull still wrote what it pulled.
        onFail: (error, kind) => {
          this.board.failed(error, kind)
          settings.settle()
        },
        log: (line) => this.board.note(line),
      })
    } catch (error) {
      // Nothing may be left holding the database when no engine got built to close it.
      store.close()
      throw error
    }

    this.store = store
    this.vault = vault
    this.engine = engine
    this.unwatchStatus = engine.onStatus((engineStatus) =>
      this.board.publish(statusOf(engineStatus))
    )
    // Not the engine's own status, which is `idle` before its first run has begun: `idle` means
    // *settled*, and `runAfterSync` would take it at its word in the gap before the first sync.
    this.board.publish({
      ...statusOf(engine.status),
      state: connection.paused ? 'paused' : 'syncing',
    })
    this.board.note(`syncing vault ${connection.vaultId} with ${connection.serverUrl}`)
    if (join !== null) this.board.note(joinLine(join))
    this.board.note(ignoreLine(ignoreText))
    if (!isWireConfigDir(app.vault.configDir)) this.board.note(configLine(app.vault.configDir))
    await this.first(engine, store, connection.paused)
  }

  /**
   * The first run, and what keeps the engine going after it.
   *
   * The rescan is asked for *before* `start`, so it is the first run and the one `start`
   * prompts queues behind it; the scope is filed only once the run got through, so a rescan
   * that failed is done again on the next start. A phone is started too: its socket refuses to
   * open (`phone.ts`), and the watcher and the clock are what it syncs on.
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
      this.board.note('sync is paused; nothing will move until it is resumed')
    } else if (due) {
      this.board.note('rescan: what this device syncs changed since the last sync')
      void engine
        .rescan()
        .then(() => store.setMeta(SCOPE_KEY, scope))
        .catch(noop)
    } else {
      await store.setMeta(SCOPE_KEY, scope)
    }

    engine.start()
  }

  /**
   * Another window of the app deleted or upgraded the ledger, and its connection closed under
   * the running engine. Every transaction after this would fail with IndexedDB's own message,
   * so the engine is stopped and the status says what happened and what to do.
   */
  private closedUnderEngine(store: IndexedDbStateStore): void {
    void this.host.serialise(async () => {
      if (this.store !== store) return
      await this.teardown()
      const message =
        'another window of this app closed the sync ledger; reload Obsidian to sync again'
      this.board.note(message)
      this.board.publish({ ...DISCONNECTED_STATUS, state: 'error', lastError: message })
    })
  }

  /**
   * Stop the engine, close the state database, and go back to saying nothing is connected —
   * unless `publish` is false, for a stop that a build follows at once: the status the old
   * engine left stands until the new one says `syncing`.
   */
  async teardown({ publish = true }: { publish?: boolean } = {}): Promise<void> {
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
    this.board.forgetFailure()
    await engine?.stop()
    try {
      store?.close()
    } catch (error) {
      // The fields are already let go, so the caller is in a good state whatever the database
      // says; a throw from here would escape into whichever verb asked for the teardown.
      console.debug('[abele-sync] the state database would not close', error)
    }
    if (publish) this.board.publish({ ...DISCONNECTED_STATUS })
  }

  /* -- The pieces the engine is given ----------------------------------- */

  /**
   * The batch the watcher handed the engine, looked at for one path of the host's own.
   *
   * `.abele-sync-ignore` is part of the scope key, so an edit to it means the engine has to be
   * built again on the new rules and the manifest walked. Nothing else in a batch is the
   * service's business — the engine has already taken it in.
   *
   * A phone gets here too: it runs the same watcher, polling the ignore file with its config
   * folder every minute.
   */
  private noticed(paths: string[]): void {
    if (!paths.some((path) => caseKey(path) === caseKey(IGNORE_FILE))) return
    this.board.note('the vault ignore file changed; reading it again')
    void this.host.serialise(() => this.reconcile())
  }
}
