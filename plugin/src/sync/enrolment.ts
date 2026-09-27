import { Platform, type App } from 'obsidian'
import { SyncClient } from '@abele/sync-core'
import {
  normalizeServerUrl,
  serverUrlProblem,
  type JoinPrefer,
  type VaultInfo,
} from '@abele/sync-protocol'
import { isDeviceSecretId, secrets } from '@/secrets/SecretStore'
import type { SharedSelective, Sibling, TransferredConnection } from '@/transfer/connection'
import type { DeviceConnection, JoinState } from './connection'
import { sideOf } from './joinState'
import { IndexedDbStateStore, stateDatabaseName } from './IndexedDbStateStore'
import { NO_LEDGER, readLedgerId, writeLedgerId } from './ledgerId'
import { newSecretId, newStateId } from './ids'
import { messageOf } from './messages'
import { USER_AGENT } from './transport'
import { Revoker, withTimeout } from './revoke'

/**
 * Setting this device up and taking it down again: signing in, enrolling on a vault, taking a
 * connection a transfer brought, making a device for a transfer to hand over, disconnecting —
 * which tells the server (`revoke.ts`) — and forgetting.
 *
 * Kept apart from the service that runs the engine because none of it is the engine's business:
 * it talks to the server as an account, files a token in the keychain and writes the connection,
 * and then asks the service to put the engine in step. The account token of a sign-in lives
 * here, in memory, for the length of the connect flow and no longer.
 */

/** Which vault `chooseVault` was asked for: one that exists, or one to make. */
export type VaultChoice = string | { create: string }

/** What the service's own verbs may change of a connection: anything but the move flag. */
export type ConnectionPatch = Partial<Omit<DeviceConnection, 'migrated'>>

/**
 * The fields the bookkeeping owns, never changed from outside: where the token was minted, the
 * revokes still waiting — each naming a kept token and where to send it — the join in progress,
 * whose side is the person's to choose in the join dialog and nobody's to set around it, and the
 * move flag.
 */
export const KEPT_FIELDS = ['enrolledUrl', 'pendingRevoke', 'join', 'migrated'] as const

/** What a screen or the agent may change of a connection (`SyncService.updateConnection`). */
export type ConnectionEdit = Partial<Omit<DeviceConnection, (typeof KEPT_FIELDS)[number]>>

/**
 * Why a device holding a token may not be pointed at `serverUrl`, or null when it may: the
 * token goes only to the server that minted it. A new server is a new sign-in.
 */
export function enrolledElsewhere(serverUrl: string, enrolledUrl: string): string | null {
  const url = normalizeServerUrl(serverUrl) ?? serverUrl
  if (url === enrolledUrl) return null
  return `this device is enrolled on ${enrolledUrl || 'no server'}; disconnect and sign in to the new server`
}

/** What the enrolment verbs are handed by the service that owns the engine. */
export interface EnrolmentHost {
  /** The app the service was started with, or null before `init` and after `destroy`. */
  app(): App | null
  transport(): typeof fetch
  factory(): IDBFactory
  note(text: string): void
  connection(): DeviceConnection
  /** Writes the connection with these fields changed, unchecked (`ConnectionKeeper.save`). */
  saveConnection(patch: ConnectionPatch): void
  /** Runs after everything already asked of the engine (`SyncService.serialise`). */
  serialise<T>(fn: () => Promise<T>): Promise<T>
  teardown(): Promise<void>
  reconcile(): Promise<void>
  /** Who a sign-in's retry of waiting revokes is telling now (`Revoker.retryWithin`). */
  telling?(line: string | null): void
}

export class Enrolment {
  /** The account client of a connect flow, on a token that is never written down. */
  private account: SyncClient | null = null
  /** The server that account signed in to, so `chooseVault` files the one it enrolled against. */
  private accountUrl = ''
  /** What the account's vaults are called, from its last listing, for the connection to say. */
  private vaultNames = new Map<string, string>()

  /** Telling the server a device has left, now or later. */
  readonly revoker: Revoker

  constructor(private readonly host: EnrolmentHost) {
    this.revoker = new Revoker(host)
  }

  /**
   * Sign in and list the vaults this account can enrol a device on.
   *
   * The password is used for this one request and kept nowhere; the account token it answers
   * with is held in memory until `chooseVault` has enrolled, or `endConnect` lets it go. Neither
   * is ever written to the log, the connection or `data.json`.
   */
  async connect(serverUrl: string, email: string, password: string): Promise<VaultInfo[]> {
    const typed = serverUrl.trim()
    if (typed === '') throw new Error('a server address is needed to connect')
    // Before the password goes anywhere: over plain http it would cross the network readable.
    const problem = serverUrlProblem(typed)
    if (problem !== null) throw new Error(problem)
    // One spelling, whatever was typed: the connection compares addresses, and a transfer tells
    // "the same vault" from "another one" by them.
    const baseUrl = normalizeServerUrl(typed) ?? typed
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
    this.vaultNames = new Map(vaults.map((vault) => [vault.id, vault.name]))
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
   * `prefer` is the answer to the join question (`join.ts`), given only when it was asked: which
   * side wins where this vault and the server both hold a file — `mine`, `theirs`, or null for
   * "merge both". It is kept with the connection until the engine reports the join done, so a
   * join cut off half way finishes the way it was asked to. Left out, nothing was asked — a new
   * vault, a vault only one side has files for, a reconnect — and the engine merges, which on
   * those is the same thing as either side.
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
  async chooseVault(
    choice: VaultChoice,
    deviceName: string,
    prefer?: JoinPrefer | null
  ): Promise<void> {
    const account = this.account
    // Read with the account, not after the awaits: the tab closing mid-enrolment calls
    // `endConnect`, and the device the server enrols meanwhile must still be filed against it.
    const accountUrl = this.accountUrl
    const app = this.host.app()
    if (account === null) throw new Error('sign in to the server before choosing a vault')
    if (app === null) throw new Error('the sync service has not been started yet')
    const name = deviceName.trim()
    if (name === '') throw new Error('this device needs a name to enrol under')
    // A device this one left while offline is told first: most likely the same server, reachable
    // now. Waited on for one revoke's timeout at most; the card says who is being told.
    await this.revoker.retryWithin(this.revoker.timeoutMs)

    /** The ledger this enrolment replaces, to be deleted once nothing is holding it. */
    let dropped: string | null = null
    try {
      const vaultId =
        typeof choice === 'string' ? choice : (await account.createVault(choice.create)).id
      const vaultName =
        typeof choice === 'string' ? (this.vaultNames.get(choice) ?? '') : choice.create
      const enrolled = await account.enrolDevice(
        vaultId,
        name,
        Platform.isMobile ? 'mobile' : 'desktop'
      )

      const held = this.host.connection().deviceTokenId
      const tokenId = isDeviceSecretId(held) ? held : newSecretId()
      secrets().device.set(tokenId, enrolled.device_token)
      dropped = this.enrolAs(app, {
        serverUrl: accountUrl,
        vaultId,
        vaultName,
        deviceId: enrolled.device_id,
        deviceName: name,
        tokenId,
        // A vault made just now holds nothing to join with.
        join:
          prefer === undefined || typeof choice !== 'string'
            ? null
            : { vaultId, prefer, ask: false },
      })
    } finally {
      this.account = null
    }
    await this.settle(dropped)
  }

  /**
   * Take the connection a transfer brought: the device the sending side had the server make for
   * this one, and its token.
   *
   * A device that syncs something already is disconnected from it first — which tells that
   * server it left — and only a screen that has asked calls this over one. The token is filed
   * under an id minted here: on a phone the keychain is one for the whole app, and a name the
   * sender chose, or one reused, could land on another vault's token. What the sender syncs is
   * taken as a starting point, with this device's own size cap kept.
   *
   * The join question is left open (`join.ask`): the vault arriving may hold files, and so may
   * this one, and which side wins is the person's to say. No engine is built until the Sync tab
   * has asked it and `answerJoin` has the answer.
   */
  async adoptTransferred(
    arrived: TransferredConnection,
    token: string,
    selective: SharedSelective
  ): Promise<void> {
    const app = this.host.app()
    if (app === null) throw new Error('the sync service has not been started yet')
    const problem = serverUrlProblem(arrived.serverUrl)
    const serverUrl = normalizeServerUrl(arrived.serverUrl)
    if (problem !== null || serverUrl === null) {
      throw new Error(problem ?? 'that is not a web address; use an https:// address')
    }
    if (!token.startsWith('absd_') || arrived.vaultId === '' || arrived.deviceId === '') {
      throw new Error('the transfer did not carry a whole connection')
    }

    const own = this.host.connection()
    if (own.serverUrl !== '' || own.vaultId !== '') await this.disconnect()

    const tokenId = newSecretId()
    secrets().device.set(tokenId, token)
    const dropped = this.enrolAs(app, {
      serverUrl,
      vaultId: arrived.vaultId,
      vaultName: arrived.vaultName,
      deviceId: arrived.deviceId,
      deviceName: arrived.deviceName,
      tokenId,
      selective: { ...selective, maxFileBytes: this.host.connection().selective.maxFileBytes },
      join: { vaultId: arrived.vaultId, prefer: null, ask: true },
    })
    this.host.note('took the connection a transfer brought')
    await this.settle(dropped)
  }

  /**
   * Answer the join question a transfer left open, and start syncing.
   *
   * `prefer` as `chooseVault` takes it; undefined when the question turned out to be a plain
   * confirmation — only one side holds files, or this vault already walked the server's to the
   * end — and there is no side to keep. Refused when no question is open for the vault this
   * device is connected to: an answer that arrives after a Disconnect is not an answer to anything.
   */
  async answerJoin(prefer?: JoinPrefer | null): Promise<void> {
    const own = this.host.connection()
    const open = own.join
    if (open === null || !open.ask || open.vaultId !== own.vaultId || own.vaultId === '') {
      throw new Error('there is no join waiting for an answer')
    }
    const join: JoinState | null =
      prefer === undefined ? null : { vaultId: own.vaultId, prefer, ask: false }
    this.host.saveConnection({ join })
    this.host.note(
      join === null ? 'join confirmed; nothing to choose' : `join answered: ${sideOf(join.prefer)}`
    )
    await this.host.serialise(() => this.host.reconcile())
  }

  /**
   * Have the server make a device on this vault for a transfer to hand over, and return it with
   * its token.
   *
   * Asked once, never again on a failure: the server enrols before it answers, so a request
   * whose answer was lost has made a device nobody holds the token of — and a retry would make
   * another. The server records such a one as enrolled by this device.
   *
   * Asked of the server the token was minted on, and of no other: an address changed since is
   * refused, as it is everywhere the token goes.
   */
  async enrolSibling(name: string): Promise<Sibling> {
    const own = this.host.connection()
    const token = isDeviceSecretId(own.deviceTokenId) ? secrets().device.get(own.deviceTokenId) : ''
    if (own.serverUrl === '' || own.vaultId === '' || token === '') {
      throw new Error('this device is not connected')
    }
    const refused =
      serverUrlProblem(own.enrolledUrl) ?? enrolledElsewhere(own.serverUrl, own.enrolledUrl)
    if (refused !== null) throw new Error(refused)
    const deviceName = name.trim()
    if (deviceName === '') throw new Error('the other device needs a name')
    const client = new SyncClient({
      baseUrl: own.enrolledUrl,
      fetch: this.host.transport(),
      token,
      userAgent: USER_AGENT,
    })
    // Which one the other device is, nobody here knows; the likelier guess is the other kind.
    const platform = Platform.isMobile ? 'desktop' : 'mobile'
    const answer = await withTimeout(
      client.enrolSibling(deviceName, platform),
      this.revoker.timeoutMs
    )
    this.host.note(`the server made ${deviceName} on this vault, for a transfer to hand over`)
    return {
      serverUrl: own.enrolledUrl,
      vaultId: own.vaultId,
      vaultName: own.vaultName,
      deviceId: answer.device_id,
      deviceName,
      token: answer.device_token,
    }
  }

  /**
   * Tell the server a device made for a transfer is not needed: the receiving side already syncs
   * that vault, or chose not to take it. Kept to be told later, like any Disconnect, when the
   * server cannot be reached now — so nothing is left enrolled that nobody holds.
   */
  async revokeTransferred(arrived: TransferredConnection, token: string): Promise<void> {
    const serverUrl = normalizeServerUrl(arrived.serverUrl) ?? arrived.serverUrl
    await this.revoker.leave(
      { serverUrl, deviceId: arrived.deviceId, deviceName: arrived.deviceName },
      token
    )
  }

  /**
   * Write the connection an enrolment produced, minting a ledger when this vault has none for
   * that vault. Returns the ledger it replaced, for `settle` to delete.
   */
  private enrolAs(
    app: App,
    enrolled: {
      serverUrl: string
      vaultId: string
      vaultName: string
      deviceId: string
      deviceName: string
      tokenId: string
      selective?: DeviceConnection['selective']
      join: JoinState | null
    }
  ): string | null {
    const { tokenId, selective, join, ...where } = enrolled
    let dropped: string | null = null
    const ledger = readLedgerId(app)
    if (ledger.stateId === '' || ledger.vaultId !== where.vaultId) {
      dropped = ledger.stateId === '' ? null : ledger.stateId
      writeLedgerId(app, { stateId: newStateId(), vaultId: where.vaultId })
    }
    this.host.saveConnection({
      ...where,
      enrolledUrl: where.serverUrl,
      deviceTokenId: tokenId,
      paused: false,
      join,
      ...(selective === undefined ? {} : { selective }),
    })
    this.host.note(`enrolled as ${where.deviceName} on vault ${where.vaultName || where.vaultId}`)
    return dropped
  }

  /**
   * Put the engine on the connection just written, then delete the ledger it replaced.
   *
   * `reconcile` sees the new token even behind an unchanged keychain id, so it builds another
   * engine of its own accord. Only once that has stopped the old engine is the ledger it held
   * free to delete.
   */
  private async settle(dropped: string | null): Promise<void> {
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
   * Stop syncing, tell the server this device has left, and forget how to reach it.
   *
   * The server is asked to revoke the device, on the address the token was minted on: after
   * that no copy of the token anywhere reads or writes the vault. When it cannot be reached the
   * token is kept under a name of its own and the revoke tried again (`revoke.ts`); the
   * Disconnect itself goes ahead either way — unless the keychain will not take that copy: then
   * no copy would be left anywhere to tell the server with, and the device stays enrolled for
   * good, so the Disconnect is refused and the engine put back.
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
      const own = this.host.connection()
      const tokenId = own.deviceTokenId
      const token = isDeviceSecretId(tokenId) ? secrets().device.get(tokenId) : ''
      const serverUrl = own.enrolledUrl !== '' ? own.enrolledUrl : own.serverUrl
      if (token !== '' && serverUrl !== '') {
        const told = await this.revoker.leave(
          { serverUrl, deviceId: own.deviceId, deviceName: own.deviceName },
          token
        )
        if (told.kept === false) {
          await this.host.reconcile()
          throw new Error(
            'the server could not be told, and the keychain would not keep the token to tell it ' +
              'later, so this device stays connected; try again when the server can be reached'
          )
        }
      }
      // The secret goes and the id stays: `token()` reads a missing secret as no device, which
      // is exactly the truth.
      if (tokenId !== '') secrets().device.remove(tokenId)
      this.host.saveConnection({
        serverUrl: '',
        enrolledUrl: '',
        vaultId: '',
        vaultName: '',
        deviceId: '',
        deviceName: '',
        paused: false,
        // A join belongs to the vault it was asked about; connecting again asks again.
        join: null,
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
