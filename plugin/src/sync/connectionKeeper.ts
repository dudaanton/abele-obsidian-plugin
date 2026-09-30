import { Platform, type App } from 'obsidian'
import { ref, type Ref } from 'vue'
import { normalizeServerUrl, serverUrlProblem } from '@abele/sync-protocol'
import { AbeleConfig } from '@/services/AbeleConfig'
import { isDeviceSecretId, secrets } from '@/secrets/SecretStore'
import {
  CONNECTION_KEY,
  connectionProblem,
  emptyConnection,
  inspectConnection,
  MIGRATION_LINE,
  MIGRATION_UNSTORED,
  migrateConnection,
  selectiveFrom,
  selectiveProblem,
  writeConnection,
  type DeviceConnection,
} from './connection'
import {
  KEPT_FIELDS,
  enrolledElsewhere,
  type ConnectionEdit,
  type ConnectionPatch,
} from './enrolment'
import { joinOf } from './joinState'
import type { LocalStorage } from './ledgerId'
import type { SyncState } from './status'

/**
 * This device's connection as the service holds it: read out of the vault's local storage,
 * checked before a change from outside is written, written back, and the device token it names.
 *
 * Where this device syncs and what it takes is not a setting: it is a record in the vault's
 * local storage (`connection.ts`), which no copy of the vault and no transfer carries. It is
 * read into {@link ConnectionKeeper.connection} and written only through here, so the address
 * rule and the keychain-name check hold for every writer — a screen, the agent, a transfer.
 */
export class ConnectionKeeper {
  /**
   * This device's connection as local storage holds it, for the Sync tab to show. Written only
   * through {@link ConnectionKeeper.save}, never by assigning to it.
   */
  readonly connection: Ref<DeviceConnection> = ref(emptyConnection(Platform.isMobile))

  /** Where the connection is filed: the vault's local storage, from `open` or `read`. */
  private storage: LocalStorage | null = null

  /**
   * What was wrong with the record as it was read, or null. Said once in the log when it is
   * read, and as the error status while it leaves the device with no token to sync with — the
   * Sync tab would otherwise show only the sign-in card, and say nothing of why. Cleared by the
   * next write, which replaces the record whole.
   */
  private damaged: string | null = null

  constructor(private readonly note: (text: string) => void) {}

  /** What was wrong with the record as it was read, or null. */
  damage(): string | null {
    return this.damaged
  }

  /**
   * Read this device's connection out of the vault's local storage, moving it out of `data.json`
   * the first time a build that keeps it there has run on this device (`migrateConnection`).
   *
   * Called from `onload` as soon as the keychain is reachable — the move asks it whether the
   * token the file names is here — and before `announce`, which reads the result. The `sync`
   * block is the one `loadSettings` read off disk: by now the settings in memory have already
   * dropped the fields being moved. A file that still holds them is written again without them,
   * so the move happens once and the file stops naming this device.
   *
   * Nothing is moved, and nothing recorded, when there was no file to read: a `data.json` that
   * is missing for now or would not parse may still name the connection, and a record written
   * off it would say the move was made and drop that connection at the next launch that reads it.
   */
  async open(app: App): Promise<void> {
    this.storage = app
    const config = AbeleConfig.getInstance()
    const loaded = config.takeLoadedSync()
    const migration =
      loaded === null
        ? null
        : migrateConnection(
            app,
            loaded.sync,
            (id) => secrets().device.get(id) !== '',
            Platform.isMobile
          )
    this.load(app)
    if (loaded === null) {
      if (app.loadLocalStorage(CONNECTION_KEY) === null) {
        this.note(
          'data.json could not be read, or is not there yet; a connection it names is moved at ' +
            'the next launch that reads it'
        )
      }
      return
    }
    if (migration === null) {
      // A durable record already exists. A previous interrupted rewrite, or a legacy file
      // arriving again, must not leave all future settings saves waiting for an already-done move.
      const deferred = config.acknowledgeSyncMigration()
      if (deferred) await config.rewrite()
      return
    }
    if (!migration.stored) {
      this.note(MIGRATION_UNSTORED)
      return
    }
    this.note(MIGRATION_LINE[migration.outcome])
    config.acknowledgeSyncMigration()
    if (migration.rewrite) await config.rewrite()
  }

  /** File the connection in this storage from now on, and read it from there. */
  read(storage: LocalStorage): void {
    this.storage = storage
    this.load(storage)
  }

  /**
   * The record, into {@link ConnectionKeeper.connection}, saying once in the log what of it was
   * damaged — and keeping why, for `reconcile` to show instead of the sign-in card.
   */
  private load(storage: LocalStorage): void {
    const { connection, damaged } = inspectConnection(storage, Platform.isMobile)
    this.connection.value = connection
    const damage =
      damaged.length === 0
        ? null
        : `the saved connection is damaged (${damaged.join(', ')} could not be read); ` +
          'disconnect and connect again'
    if (damage !== null && damage !== this.damaged) this.note(damage)
    this.damaged = damage
  }

  /**
   * Throws why this change from outside may not be written, before anything is; otherwise
   * answers with the change as it is to be written.
   *
   * Only the fields named are checked, by the rules a sign-in holds them to: a server address
   * the https rule refuses, and a keychain name this plugin never mints or keeps for a waiting
   * revoke, are thrown back, and selective settings are held to the Sync tab's rules
   * (`selectiveProblem`). What is already saved is not re-judged — a connection made before
   * the https rule can still have its switches changed, and `reconcile` says why it builds
   * nothing.
   *
   * What is written is what a sign-in would write: the address the way `normalizeServerUrl`
   * spells it, so the host that was judged is the host every request goes to. A new vault id
   * drops the vault name that went with the old one, unless the change names one of its own.
   *
   * Where the token goes is not a field to edit: while a token is held, the address must stay
   * the one it was minted on, and the fields that record that and the waiting revokes are the
   * bookkeeping's alone — refused here, whatever the caller's types said.
   */
  check(patch: ConnectionEdit): ConnectionEdit {
    const kept = KEPT_FIELDS.filter((field) => field in patch)
    if (kept.length > 0) throw new Error(`${kept.join(', ')} is kept by the plugin itself`)
    const problem = connectionProblem({
      ...emptyConnection(),
      serverUrl: patch.serverUrl ?? '',
      deviceTokenId: patch.deviceTokenId ?? '',
    })
    if (problem !== null) throw new Error(problem)
    const current = this.connection.value
    if (patch.selective !== undefined) {
      const refused = selectiveProblem(patch.selective, current.selective)
      if (refused !== null) throw new Error(refused)
    }
    const edit: ConnectionEdit = { ...patch }
    if (patch.serverUrl !== undefined && patch.serverUrl !== '') {
      edit.serverUrl = normalizeServerUrl(patch.serverUrl) ?? patch.serverUrl
    }
    if (
      patch.vaultId !== undefined &&
      patch.vaultId !== current.vaultId &&
      patch.vaultName === undefined
    ) {
      edit.vaultName = ''
    }
    // Asked only of a change that moves the address or the token: a locked keychain must not
    // stop a switch being flipped, and `reconcile` reports it the way it reports any build.
    const next = { ...current, ...edit }
    const moves = edit.serverUrl !== undefined || edit.deviceTokenId !== undefined
    if (moves && next.serverUrl !== '' && this.holdsToken(next.deviceTokenId)) {
      const elsewhere = enrolledElsewhere(next.serverUrl, next.enrolledUrl)
      if (elsewhere !== null) throw new Error(elsewhere)
    }
    return edit
  }

  /** Whether the keychain holds a device token under this id. */
  private holdsToken(id: string): boolean {
    return isDeviceSecretId(id) && secrets().device.get(id) !== ''
  }

  /**
   * Writes the connection with these fields changed, and shows it. Unchecked: the verbs that
   * call it write only what a server answered or what they empty, and `check` comes first on
   * the road for anything else.
   *
   * Always marked as moved: a record this service wrote is the device's own, and the one-time
   * move out of `data.json` must never run over it. The selective settings are filled out the
   * way a read fills them, so what the engine is built on now is what the next launch reads —
   * whoever wrote them, the agent included.
   *
   * Read back after it is written (pi review #6): a record local storage did not keep throws,
   * and what is shown stays what is stored — a phone that refused the write must not sync, or
   * show a pause, for as long as the app runs and find something else at the next start.
   */
  save(patch: ConnectionPatch): void {
    const merged = { ...this.connection.value, ...patch }
    const next: DeviceConnection = {
      ...merged,
      selective: selectiveFrom(merged.selective, Platform.isMobile),
      migrated: true,
    }
    if (this.storage !== null) this.store(this.storage, next)
    else console.debug('[abele-sync] the connection changed before local storage was read')
    this.connection.value = next
    this.damaged = null
  }

  /** Writes the record and reads it back; throws, saying so in the log, when it did not take. */
  private store(storage: LocalStorage, next: DeviceConnection): void {
    let failure: string | null = null
    try {
      writeConnection(storage, next)
      const back = JSON.stringify(storage.loadLocalStorage(CONNECTION_KEY))
      if (back !== JSON.stringify(next)) failure = 'what was read back is not what was written'
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    if (failure === null) return
    const line = `this device could not save its connection (${failure}), so nothing was changed`
    this.note(line)
    throw new Error(line.charAt(0).toUpperCase() + line.slice(1) + '.')
  }

  /**
   * The device token, or null when the connection names one the keychain does not hold — or
   * names an id this plugin never mints, which is never read: pointed at a provider's key, it
   * would send that key to the server as a bearer token.
   */
  token(): string | null {
    const id = this.connection.value.deviceTokenId
    if (!isDeviceSecretId(id)) return null
    const secret = secrets().device.get(id)
    return secret === '' ? null : secret
  }

  /**
   * What the status says before anything is opened (`SyncService.announce`): `joining` for a
   * join still to be answered, which pulls nothing, `paused`, or `syncing` — when the connection
   * names a server the address rule allows, a vault, and a device token the keychain holds. Null
   * otherwise: a refused address pulls nothing, and `reconcile` says why.
   */
  announced(): SyncState | null {
    const connection = this.connection.value
    if (
      connection.serverUrl === '' ||
      connection.vaultId === '' ||
      serverUrlProblem(connection.serverUrl) !== null ||
      this.token() === null
    ) {
      return null
    }
    return joinOf(connection)?.ask ? 'joining' : connection.paused ? 'paused' : 'syncing'
  }
}
