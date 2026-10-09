import { Platform, type App } from 'obsidian'
import { SyncClient } from '@abele/sync-core'
import { assertPersonalContext } from './scoped/scopedJoin'
import {
  normalizeServerUrl,
  serverUrlProblem,
  type JoinPrefer,
  type VaultInfo,
} from '@abele/sync-protocol'
import { isDeviceSecretId, secrets } from '@/secrets/SecretStore'
import { bindDeviceToken, boundDeviceToken, tokenServerId } from '@/secrets/deviceSecret'
import {
  isOwnTransferred,
  type SharedSelective,
  type Sibling,
  type TransferredConnection,
} from '@/transfer/connection'
import { inspectConnection, type DeviceConnection, type JoinState } from './connection'
import { sideOf } from './joinState'
import { keptLedger } from './join'
import { IndexedDbStateStore, stateDatabaseName } from './IndexedDbStateStore'
import { LEDGER_KEY, NO_LEDGER, readLedgerId, writeLedgerId } from './ledgerId'
import { finishLedgerCleanup, ledgerCleanupIds, rememberLedgerCleanup } from './ledgerCleanup'
import { newSecretId, newStateId } from './ids'
import { authorizeLedgerBootstrap, LEDGER_BOOTSTRAP_KEY, LEDGER_PROOF_KEY } from './ledgerRecovery'
import { messageOf } from './messages'
import { USER_AGENT } from './transport'
import { Revoker, withTimeout } from './revoke'
import { retirePublicationStores } from './publication/publicationRetirement'
import { requireExternalLifecycleSafety } from './external/pluginSafety'
import { assertNoExternalLifecycleMarker } from './external/recovery'

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
  stillCurrent?(): boolean
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
  /** One inventory after quiescing the runtime, shared only by this departure's revoke. */
  private retirementInventory: { app: App; identity: string } | null = null

  /** Telling the server a device has left, now or later. */
  readonly revoker: Revoker

  constructor(private readonly host: EnrolmentHost) {
    this.revoker = new Revoker({
      transport: () => host.transport(),
      connection: () => host.connection(),
      saveConnection: (patch) => host.saveConnection(patch),
      note: (text) => host.note(text),
      telling: (line) => host.telling?.(line),
      beforeRetirement: async () => {
        this.assertCurrent()
        const app = host.app()
        if (this.retirementInventory) {
          this.assertCurrent(this.retirementInventory.identity, this.retirementInventory.app)
          assertNoExternalLifecycleMarker(this.retirementInventory.app)
        } else if (app) await requireExternalLifecycleSafety(app, host.factory())
        this.assertCurrent()
      },
      beforeForget: async () => {
        this.assertCurrent()
        const app = host.app(),
          identity = this.identity()
        if (app) await requireExternalLifecycleSafety(app, host.factory())
        this.assertCurrent(identity, app ?? undefined)
      },
    })
  }

  private identity(): string {
    const c = this.host.connection()
    return JSON.stringify([
      c.serverUrl,
      c.vaultId,
      c.deviceId,
      c.deviceTokenId,
      isDeviceSecretId(c.deviceTokenId) ? secrets().device.get(c.deviceTokenId) : '',
    ])
  }
  private assertCurrent(identity?: string, app?: App): void {
    if (
      this.host.stillCurrent?.() === false ||
      (app && this.host.app() !== app) ||
      (identity !== undefined && identity !== this.identity())
    )
      throw new Error('Sync connection changed or closed; recovery required')
    if (app) {
      const current = this.host.connection(),
        durable = inspectConnection(app).connection
      if (
        JSON.stringify([
          current.serverUrl,
          current.vaultId,
          current.deviceId,
          current.deviceTokenId,
        ]) !==
        JSON.stringify([
          durable.serverUrl,
          durable.vaultId,
          durable.deviceId,
          durable.deviceTokenId,
        ])
      )
        throw new Error('Sync connection changed; recovery required')
    }
  }

  /**
   * Sign in and list the vaults this account can enrol a device on.
   *
   * The password is used for this one request and kept nowhere; the account token it answers
   * with is held in memory until `chooseVault` has enrolled, or `endConnect` lets it go. Neither
   * is ever written to the log, the connection or `data.json`.
   */
  async connect(serverUrl: string, email: string, password: string): Promise<VaultInfo[]> {
    this.assertCurrent()
    assertPersonalContext(this.host.app())
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
    this.assertCurrent()
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
    assertPersonalContext(this.host.app())
    const account = this.account
    // Read with the account, not after the awaits: the tab closing mid-enrolment calls
    // `endConnect`, and the device the server enrols meanwhile must still be filed against it.
    const accountUrl = this.accountUrl
    const app = this.host.app()
    if (account === null) throw new Error('sign in to the server before choosing a vault')
    if (app === null) throw new Error('the sync service has not been started yet')
    this.assertCurrent(undefined, app)
    const identity = this.identity()
    const name = deviceName.trim()
    if (name === '') throw new Error('this device needs a name to enrol under')
    // A device this one left while offline is told first: most likely the same server, reachable
    // now. Waited on for one revoke's timeout at most; the card says who is being told.
    await requireExternalLifecycleSafety(app, this.host.factory())
    await this.host.serialise(() => this.host.teardown())
    await requireExternalLifecycleSafety(app, this.host.factory())
    await this.revoker.retryWithin(this.revoker.timeoutMs)
    this.assertCurrent(identity, app)

    /** The ledger this enrolment replaces, to be deleted once nothing is holding it. */
    let dropped: string | null = null
    try {
      const vaultId =
        typeof choice === 'string' ? choice : (await account.createVault(choice.create)).id
      const vaultName =
        typeof choice === 'string' ? (this.vaultNames.get(choice) ?? '') : choice.create
      this.assertCurrent(identity, app)
      const enrolled = await account.enrolDevice(
        vaultId,
        name,
        Platform.isMobile ? 'mobile' : 'desktop'
      )

      await requireExternalLifecycleSafety(app, this.host.factory())
      this.assertCurrent(identity, app)
      const held = this.host.connection().deviceTokenId
      const tokenId = isDeviceSecretId(held) ? held : newSecretId()
      dropped = this.enrolAs(app, enrolled.device_token, {
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
   * has asked it and `answerJoin` has the answer. Not for a vault this device already walked to
   * the end (`keptLedger`): that is a reconnect, with nothing to choose, and it syncs at once.
   */
  async adoptTransferred(
    arrived: TransferredConnection,
    token: string,
    selective: SharedSelective
  ): Promise<void> {
    const app = this.host.app()
    assertPersonalContext(app)
    if (app === null) throw new Error('the sync service has not been started yet')
    const problem = serverUrlProblem(arrived.serverUrl)
    const serverUrl = normalizeServerUrl(arrived.serverUrl)
    if (problem !== null || serverUrl === null) {
      throw new Error(problem ?? 'that is not a web address; use an https:// address')
    }
    if (!token.startsWith('absd_') || arrived.vaultId === '' || arrived.deviceId === '') {
      throw new Error('the transfer did not carry a whole connection')
    }

    await requireExternalLifecycleSafety(app, this.host.factory())
    this.assertCurrent(undefined, app)
    const own = this.host.connection()
    if (own.serverUrl !== '' || own.vaultId !== '') await this.disconnect()
    const identity = this.identity()
    // A vault this device already walked to the end is a reconnect: nothing to choose, so
    // nothing is asked and it syncs at once (task-8 review, #6).
    const reconnect = await keptLedger(app, this.host.factory(), arrived.vaultId).catch(
      (error: unknown) => {
        this.host.note(`the ledger could not be read, so the join is asked: ${messageOf(error)}`)
        return false
      }
    )

    await requireExternalLifecycleSafety(app, this.host.factory())
    this.assertCurrent(identity, app)
    const tokenId = newSecretId()
    const dropped = this.enrolAs(app, token, {
      serverUrl,
      vaultId: arrived.vaultId,
      vaultName: arrived.vaultName,
      deviceId: arrived.deviceId,
      deviceName: arrived.deviceName,
      tokenId,
      selective: { ...selective, maxFileBytes: this.host.connection().selective.maxFileBytes },
      join: reconnect ? null : { vaultId: arrived.vaultId, prefer: null, ask: true },
    })
    this.host.note(
      reconnect
        ? 'took the connection a transfer brought; this device synced that vault before'
        : 'took the connection a transfer brought'
    )
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
   * another. The device list shows such a one, enrolled by this device, and any device of the
   * vault can revoke it there.
   *
   * Asked of the server the token was minted on, and of no other: an address changed since is
   * refused, as it is everywhere the token goes.
   */
  async enrolSibling(name: string): Promise<Sibling> {
    const own = this.host.connection()
    const token = boundDeviceToken(secrets().device, own.deviceTokenId, own.enrolledUrl) ?? ''
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
    if (isOwnTransferred(this.host.connection(), arrived)) return
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
    token: string,
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
    this.assertCurrent(undefined, app)
    assertNoExternalLifecycleMarker(app)
    const { tokenId, selective, join, ...where } = enrolled
    const before = secrets().device.get(tokenId)
    const beforeServer = secrets().device.get(tokenServerId(tokenId))
    bindDeviceToken(secrets().device, tokenId, token, where.serverUrl)
    let dropped: string | null = null
    const ledger = readLedgerId(app)
    const bootstrap = app.loadLocalStorage(LEDGER_BOOTSTRAP_KEY)
    try {
      if (ledger.stateId === '' || ledger.vaultId !== where.vaultId) {
        dropped = ledger.stateId === '' ? null : ledger.stateId
        if (dropped) rememberLedgerCleanup(app, dropped)
        const minted = { stateId: newStateId(), vaultId: where.vaultId }
        writeLedgerId(app, minted)
        authorizeLedgerBootstrap(app, minted)
      }
      this.host.saveConnection({
        ...where,
        enrolledUrl: where.serverUrl,
        deviceTokenId: tokenId,
        paused: false,
        join,
        ...(selective === undefined ? {} : { selective }),
      })
    } catch (error) {
      // Not saved, so not enrolled here: the keychain and the ledger go back to what they were
      // (pi review #6). The server keeps the device, which the device list can revoke.
      secrets().device.set(tokenId, before)
      secrets().device.set(tokenServerId(tokenId), beforeServer)
      writeLedgerId(app, ledger)
      app.saveLocalStorage(LEDGER_BOOTSTRAP_KEY, bootstrap)
      this.host.note(`the server made ${where.deviceName}, but this device did not keep it`)
      throw error
    }
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
      const app = this.host.app()
      if (!app) throw new Error('Vault-local cleanup storage unavailable')
      rememberLedgerCleanup(app, stateId)
      await requireExternalLifecycleSafety(app, this.host.factory(), stateDatabaseName(stateId))
      await IndexedDbStateStore.delete(this.host.factory(), stateDatabaseName(stateId))
      finishLedgerCleanup(app, stateId)
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
    await this.host.serialise(() => this.disconnectLocal())
  }

  private async disconnectLocal(forgetPublication = false): Promise<void> {
    this.assertCurrent()
    const identity = this.identity()
    await this.host.teardown()
    const appForSafety = this.host.app()
    if (appForSafety) await requireExternalLifecycleSafety(appForSafety, this.host.factory())
    this.assertCurrent(identity, appForSafety ?? undefined)
    const previousInventory = this.retirementInventory
    if (appForSafety) this.retirementInventory = { app: appForSafety, identity }
    try {
      const own = this.host.connection()
      const tokenId = own.deviceTokenId
      const serverUrl = own.enrolledUrl !== '' ? own.enrolledUrl : own.serverUrl
      const token = boundDeviceToken(secrets().device, tokenId, serverUrl) ?? ''
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
      this.assertCurrent(identity, appForSafety ?? undefined)
      // The secret goes and the id stays: `token()` reads a missing secret as no device, which
      // is exactly the truth.
      if (tokenId !== '' && token !== '') {
        secrets().device.remove(tokenId)
        secrets().device.remove(tokenServerId(tokenId))
      }
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
      const app = this.host.app()
      if (app) {
        await retirePublicationStores(app, this.host.factory(), null, forgetPublication)
        const retained = readLedgerId(app).stateId
        for (const retired of ledgerCleanupIds(app))
          if (retired !== retained) await this.dropLedger(retired)
      }
    } finally {
      this.retirementInventory = previousInventory
    }
  }

  /** Disconnect and throw away what this device remembered: the ledger and the keychain name. */
  async forget(): Promise<void> {
    await this.host.serialise(async () => {
      await this.disconnectLocal(true)
      const app = this.host.app()
      const tokenId = this.host.connection().deviceTokenId
      if (tokenId !== '') {
        secrets().device.remove(tokenId)
        this.host.saveConnection({ deviceTokenId: '' })
      }
      if (app === null) return
      // Legacy Forget could clear the descriptor before deletion but leave its proof behind.
      // Those vault-local records prove ownership; a global database name alone never does.
      const proof = readLedgerId(app, LEDGER_PROOF_KEY)
      const bootstrap = readLedgerId(app, LEDGER_BOOTSTRAP_KEY)
      rememberLedgerCleanup(app, readLedgerId(app).stateId, proof.stateId, bootstrap.stateId)
      writeLedgerId(app, NO_LEDGER)
      for (const key of [LEDGER_PROOF_KEY, LEDGER_BOOTSTRAP_KEY]) {
        app.saveLocalStorage(key, null)
        if (app.loadLocalStorage(key) != null)
          throw new Error('Forgotten ledger marker was not cleared')
      }
      let failure: unknown
      for (const stateId of ledgerCleanupIds(app)) {
        try {
          await IndexedDbStateStore.delete(this.host.factory(), stateDatabaseName(stateId))
          finishLedgerCleanup(app, stateId)
        } catch (error) {
          failure ??= error
          this.host.note(`ledger cleanup is still pending: ${messageOf(error)}`)
        }
      }
      if (failure) throw failure
      app.saveLocalStorage(LEDGER_KEY, null)
      if (app.loadLocalStorage(LEDGER_KEY) != null)
        throw new Error('Forgotten ledger descriptor was not cleared')
      this.host.note("forgot this device's ledger; the next connect starts from the manifest")
    })
  }
}
