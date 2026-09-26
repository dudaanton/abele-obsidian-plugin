import { Platform, type App } from 'obsidian'
import { SyncClient } from '@abele/sync-core'
import { serverUrlProblem, type VaultInfo } from '@abele/sync-protocol'
import { isDeviceSecretId, secrets } from '@/secrets/SecretStore'
import type { DeviceConnection } from './connection'
import { IndexedDbStateStore, stateDatabaseName } from './IndexedDbStateStore'
import { NO_LEDGER, readLedgerId, writeLedgerId } from './ledgerId'
import { USER_AGENT, messageOf, newSecretId, newStateId } from './pieces'

/**
 * Setting this device up and taking it down again: signing in, enrolling on a vault,
 * disconnecting and forgetting.
 *
 * Kept apart from the service that runs the engine because none of it is the engine's business:
 * it talks to the server as an account, files a token in the keychain and writes the connection,
 * and then asks the service to put the engine in step. The account token of a sign-in lives
 * here, in memory, for the length of the connect flow and no longer.
 */

/** Which vault `chooseVault` was asked for: one that exists, or one to make. */
export type VaultChoice = string | { create: string }

/** What a connection may be changed by: anything but the record's own bookkeeping. */
export type ConnectionPatch = Partial<Omit<DeviceConnection, 'migrated'>>

/** What the enrolment verbs are handed by the service that owns the engine. */
export interface EnrolmentHost {
  /** The app the service was started with, or null before `init` and after `destroy`. */
  app(): App | null
  transport(): typeof fetch
  factory(): IDBFactory
  note(text: string): void
  connection(): DeviceConnection
  /** Writes the connection with these fields changed, unchecked (`SyncService.saveConnection`). */
  saveConnection(patch: ConnectionPatch): void
  /** Runs after everything already asked of the engine (`SyncService.serialise`). */
  serialise<T>(fn: () => Promise<T>): Promise<T>
  teardown(): Promise<void>
  reconcile(): Promise<void>
}

export class Enrolment {
  /** The account client of a connect flow, on a token that is never written down. */
  private account: SyncClient | null = null
  /** The server that account signed in to, so `chooseVault` files the one it enrolled against. */
  private accountUrl = ''

  constructor(private readonly host: EnrolmentHost) {}

  /**
   * Sign in and list the vaults this account can enrol a device on.
   *
   * The password is used for this one request and kept nowhere; the account token it answers
   * with is held in memory until `chooseVault` has enrolled, or `endConnect` lets it go. Neither
   * is ever written to the log, the connection or `data.json`.
   */
  async connect(serverUrl: string, email: string, password: string): Promise<VaultInfo[]> {
    const baseUrl = serverUrl.trim().replace(/\/+$/, '')
    if (baseUrl === '') throw new Error('a server address is needed to connect')
    // Before the password goes anywhere: over plain http it would cross the network readable.
    const problem = serverUrlProblem(baseUrl)
    if (problem !== null) throw new Error(problem)
    this.host.note(`connecting to ${baseUrl}`)
    const { account_token } = await SyncClient.login(
      baseUrl,
      this.host.transport(),
      email,
      password
    )
    const account = new SyncClient({
      baseUrl,
      fetch: this.host.transport(),
      token: account_token,
      userAgent: USER_AGENT,
    })
    const vaults = await account.listVaults()
    this.account = account
    this.accountUrl = baseUrl
    this.host.note(`signed in; the account has ${vaults.length} vault(s)`)
    return vaults
  }

  /**
   * Let a connect flow go without finishing it: the account token `connect` holds for
   * `chooseVault` is dropped. The Sync tab calls this when it closes, so a sign-in nobody
   * followed with a vault does not keep a token that can enrol devices for the whole session.
   */
  endConnect(): void {
    this.account = null
    this.accountUrl = ''
  }

  /**
   * Enrol this device on a vault — an existing one, or one made for it — and start syncing.
   *
   * The device token the server answers with goes straight into Obsidian's keychain; only the
   * id it is filed under is saved with the connection. Enrolling again over an existing setup
   * reuses that id, so the keychain never fills with tokens no device holds any more.
   *
   * The ledger id is minted here, once, and again whenever the chosen vault is not the one the
   * ledger describes — which is why the ledger's own vault is asked and not `vaultId`: a
   * disconnect empties the latter, so a device that left vault A and joined vault B would
   * otherwise open A's ledger, find every entry accounted for, and send deletes carrying A's
   * file ids. The ledger left behind is deleted once the old engine has let go of it. The account
   * client is dropped on the way out either way: it is on a token this flow has no further use
   * for.
   */
  async chooseVault(choice: VaultChoice, deviceName: string): Promise<void> {
    const account = this.account
    // Read with the account, not after the awaits: the tab closing mid-enrolment calls
    // `endConnect`, and the device the server enrols meanwhile must still be filed against it.
    const accountUrl = this.accountUrl
    const app = this.host.app()
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

      const held = this.host.connection().deviceTokenId
      const tokenId = isDeviceSecretId(held) ? held : newSecretId()
      secrets().device.set(tokenId, enrolled.device_token)
      const ledger = readLedgerId(app)
      if (ledger.stateId === '' || ledger.vaultId !== vaultId) {
        dropped = ledger.stateId === '' ? null : ledger.stateId
        writeLedgerId(app, { stateId: newStateId(), vaultId })
      }
      this.host.saveConnection({
        serverUrl: accountUrl,
        vaultId,
        deviceId: enrolled.device_id,
        deviceTokenId: tokenId,
        deviceName: name,
        paused: false,
      })
      this.host.note(`enrolled as ${name} on vault ${vaultId}`)
    } finally {
      this.account = null
    }

    // `reconcile` sees the new token even behind an unchanged keychain id, so it builds another
    // engine of its own accord. Only once that has stopped the old engine is the ledger it held
    // free to delete.
    await this.host.serialise(() => this.host.reconcile())
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
      await IndexedDbStateStore.delete(this.host.factory(), stateDatabaseName(stateId))
      this.host.note('dropped the ledger of the vault this device used to sync')
    } catch (error) {
      this.host.note(`the ledger of the previous vault could not be dropped: ${messageOf(error)}`)
    }
  }

  /**
   * Stop syncing and forget how to reach the server.
   *
   * The device token is cleared from the keychain and the identity fields from the connection.
   * What is kept is everything that is not a credential: what this device syncs, which is the
   * user's preference and should not have to be given twice; the
   * `deviceTokenId`, which is a keychain *name* and whose reuse is what stops that keychain
   * filling with an entry per connect; and the state database, so reconnecting the same vault
   * costs a scan rather than a download of everything. `forget` is what throws those away.
   */
  async disconnect(): Promise<void> {
    await this.host.serialise(async () => {
      await this.host.teardown()
      // The secret goes and the id stays: `token()` reads a missing secret as no device, which
      // is exactly the truth.
      const tokenId = this.host.connection().deviceTokenId
      if (tokenId !== '') secrets().device.remove(tokenId)
      this.host.saveConnection({
        serverUrl: '',
        vaultId: '',
        deviceId: '',
        deviceName: '',
        paused: false,
      })
      this.account = null
      this.accountUrl = ''
      this.host.note('disconnected; the device token is forgotten')
    })
  }

  /** Disconnect and throw away what this device remembered: the ledger and the keychain name. */
  async forget(): Promise<void> {
    const app = this.host.app()
    const stateId = app === null ? '' : readLedgerId(app).stateId
    await this.disconnect()
    const tokenId = this.host.connection().deviceTokenId
    if (tokenId !== '') {
      secrets().device.remove(tokenId)
      this.host.saveConnection({ deviceTokenId: '' })
    }
    if (app !== null) writeLedgerId(app, NO_LEDGER)
    if (stateId === '') return
    await IndexedDbStateStore.delete(this.host.factory(), stateDatabaseName(stateId))
    this.host.note("forgot this device's ledger; the next connect starts from the manifest")
  }
}
