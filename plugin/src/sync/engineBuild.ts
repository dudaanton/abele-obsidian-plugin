import { Platform, type App } from 'obsidian'
import { toRaw } from 'vue'
import { SyncClient, SyncEngine, joinFinished, type VaultClient } from '@abele/sync-core'
import type { CommitOp, CommitOpResult } from '@abele/sync-protocol'
import { AbeleConfig } from '@/services/AbeleConfig'
import { IndexedDbStateStore, stateDatabaseName } from './IndexedDbStateStore'
import { ObsidianFileSystem } from './ObsidianFileSystem'
import { selectiveFrom, type DeviceConnection, type JoinState } from './connection'
import type { EngineHost } from './engineRunner'
import { factoryOf, fallbackMsOf, pollMsOf, socketOf, transportOf } from './environment'
import { newStateId } from './ids'
import { readLedgerId, writeLedgerId, type LedgerId } from './ledgerId'
import { summarise } from './messages'
import { OwnSettingsWatch, ownSettingsPath } from './ownSettings'
import { noop } from './queue'
import { SCOPE_KEY, ignoreFor, settingsDeferred } from './scope'
import type { StatusBoard } from './statusBoard'
import { USER_AGENT } from './transport'

/**
 * The parts one engine runs on, made from the connection — the filesystem, the ledger, the
 * client and the engine itself — and its first run. `EngineRunner` decides when to build one and
 * keeps it; this is the building.
 */

/** What `buildEngine` is handed. */
export interface EngineRecipe {
  app: App
  host: EngineHost
  board: StatusBoard
  connection: DeviceConnection
  token: string
  ignoreText: string | null
  /**
   * The join in progress, or null. While there is one the engine is told the side the person
   * chose, and leaves this device's own `data.json` alone: every create of a join carries that
   * side, and "this device wins" would make a fresh device's defaults the vault's settings
   * whatever their age. Once the join is done the next engine takes the file up the way a first
   * contact does — the vault's copy wins, and this one goes to the file's history.
   */
  join: JoinState | null
  /** Every batch the watcher hands the engine, for the runner to look at (`noticed`). */
  noticed(paths: string[]): void
  /** Actual disk-write receipts, even if recording the result later fails. */
  written?(path: string): void
  /** Acknowledged wire outcomes, including all batches and idempotent replays. */
  committed?(vault: VaultClient, ops: CommitOp[], results: CommitOpResult[]): void
  /** The ledger's connection was closed by another window (`closedUnderEngine`). */
  closedElsewhere(store: IndexedDbStateStore): void
}

/** An engine, and the ledger and client it was built on. */
export interface BuiltEngine {
  engine: SyncEngine
  store: IndexedDbStateStore
  vault: VaultClient
}

/**
 * The ledger the engine is about to be built on, minted when this vault has none for the vault
 * the connection names.
 *
 * `chooseVault` mints one as it enrols. This is for a connection that arrived some other way —
 * a transfer, a move out of `data.json` — which names a server vault and carries no ledger id at
 * all: a fresh one is what makes the first run a walk of the manifest rather than a delete of
 * everything this disk does not hold.
 */
function ledgerFor(app: App, vaultId: string, board: StatusBoard): LedgerId {
  const held = readLedgerId(app)
  if (held.stateId !== '' && held.vaultId === vaultId) return held
  const minted = { stateId: newStateId(), vaultId }
  writeLedgerId(app, minted)
  board.note('a fresh ledger for this vault: the first sync walks the whole manifest')
  return minted
}

/** Makes the engine's parts and the engine; nothing is left holding the ledger if it throws. */
export async function buildEngine(recipe: EngineRecipe): Promise<BuiltEngine> {
  const { app, host, board, connection, token, ignoreText, join } = recipe
  const deps = host.deps()
  const pollMs = pollMsOf(deps)
  const fallbackMs = fallbackMsOf(deps)
  const ownSettings = ownSettingsPath(app.vault.configDir, host.manifest())
  // Settings changes from other devices wait for the person (`stagedSettings.ts`).
  const defer = settingsDeferred(app.vault.configDir, ownSettings)
  const settings = new OwnSettingsWatch(
    ownSettings,
    (replaced) => host.settingsArrived(replaced),
    () => host.settingsMeaning()
  )
  const store = await IndexedDbStateStore.open(
    factoryOf(deps),
    stateDatabaseName(ledgerFor(app, connection.vaultId, board).stateId)
  )
  store.onClosedElsewhere(() => recipe.closedElsewhere(store))
  settings.useLedger(store)
  try {
    const fs = new ObsidianFileSystem(app, {
      ledger: store,
      ...(pollMs === undefined ? {} : { pollMs }),
      onWatch: (paths) => recipe.noticed(paths),
      onEngineWrite: (path) => {
        settings.noteWrite(path)
        recipe.written?.(path)
      },
      yieldsToServer: (path) => settings.yields(path),
    })
    const vault = new SyncClient({
      baseUrl: connection.serverUrl,
      fetch: transportOf(deps),
      WebSocket: socketOf(deps),
      token,
      userAgent: USER_AGENT,
    }).forVault(connection.vaultId)
    if (recipe.committed !== undefined) {
      const commit = vault.commitRaw.bind(vault)
      vault.commitRaw = async (ops, key) => {
        const outcome = await commit(ops, key)
        recipe.committed?.(vault, ops, outcome.body.results)
        return outcome
      }
    }
    const scriptsFolder = AbeleConfig.getInstance().ai.scriptsFolder
    const engine = new SyncEngine({
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
      ...(defer === null ? {} : { defer }),
      onSync: (report) => {
        board.note(summarise(report))
        settings.settle()
        // Only the run the engine says finished the join ends it: the one whose push, with the
        // side chosen on every create, was answered. A run that got through without that — a
        // restart after a pull whose scan failed moved the cursor past 0 — leaves the choice for
        // the run that does (pi review #5). The engine keeps the join open across restarts by a
        // mark in the ledger, so a push cut off after a walk that held nothing no longer leaves
        // it open for ever (task-8 review, #1).
        if (join !== null && joinFinished(report)) host.joined(join)
        host.synced(report)
      },
      // A run that failed after its pull still wrote what it pulled.
      onFail: (error, kind) => {
        board.failed(error, kind)
        settings.settle()
      },
      log: (line) => board.note(line),
    })
    return { engine, store, vault }
  } catch (error) {
    // Nothing may be left holding the database when no engine got built to close it.
    store.close()
    throw error
  }
}

/**
 * The first run, and what keeps the engine going after it.
 *
 * The rescan is asked for *before* `start`, so it is the first run and the one `start` prompts
 * queues behind it; the scope is filed only once the run got through, so a rescan that failed is
 * done again on the next start. A phone is started too: its socket refuses to open
 * (`phone.ts`), and the watcher and the clock are what it syncs on.
 *
 * `scope` is the key the engine was built on, read by the caller before anything is awaited.
 */
export async function firstRun(
  engine: SyncEngine,
  store: IndexedDbStateStore,
  scope: string,
  paused: boolean,
  board: StatusBoard
): Promise<void> {
  const stored = await store.getMeta(SCOPE_KEY)
  // A state that never recorded a key has never finished a sync, and its first one walks the
  // manifest anyway.
  const due = stored !== null && stored !== scope
  if (paused) engine.pause()

  if (paused) {
    board.note('sync is paused; nothing will move until it is resumed')
  } else if (due) {
    board.note('rescan: what this device syncs changed since the last sync')
    void engine
      .rescan()
      .then(() => store.setMeta(SCOPE_KEY, scope))
      .catch(noop)
  } else {
    await store.setMeta(SCOPE_KEY, scope)
  }

  engine.start()
}
