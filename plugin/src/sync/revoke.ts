/**
 * Telling the server a device has left.
 *
 * A Disconnect used to forget the token and nothing more, which left the device live on the
 * server: anyone holding a copy of the token could still read and write the vault. Now the
 * device asks the server to revoke it (`DELETE /v1/devices/self`) before it lets the token go.
 *
 * The server cannot always be reached at that moment — a phone on a train. Then the token is
 * kept, filed under an id of its own that a reconnect will not pick up, and the revoke is tried
 * again when the plugin starts, when the Sync tab opens and before every sign-in, for a month.
 * After that it is given up, since a token nobody could deliver for a month is also a device the
 * person has most likely revoked from another device's list by then.
 *
 * The keychain is one store for the whole app on a phone, so every id here is minted fresh at
 * random: no two vaults on one phone can file two waiting tokens under the same name.
 */
import { SyncClient } from '@abele/sync-core'
import { serverUrlProblem } from '@abele/sync-protocol'
import { secrets } from '@/secrets/SecretStore'
import { REVOKE_SECRET_PREFIX, type DeviceConnection, type PendingRevoke } from './connection'
import { USER_AGENT, messageOf, randomStem } from './pieces'

/** How long a revoke may take before it counts as not reaching the server. */
export const REVOKE_TIMEOUT_MS = 10_000

/** How long a revoke is tried again before the token is let go. */
export const PENDING_REVOKE_MAX_MS = 30 * 24 * 60 * 60 * 1000

/** How a device token starts; anything else is never sent to a server as one. */
const DEVICE_TOKEN_PREFIX = 'absd_'

/**
 * What a server said to a revoke:
 * - `revoked`: it took the token back;
 * - `already`: it no longer takes the token — revoked from another device's list, or never its
 *   own. Told to the server that minted the token, that is the same thing;
 * - `unusable`: nothing was sent: the token is not one, or the address is one the https rule
 *   refuses. There is no server to tell, now or later;
 * - `failed`: it could not be told now, and may be later.
 */
export interface Told {
  told: 'revoked' | 'already' | 'unusable' | 'failed'
  reason?: string
}

/** A fresh keychain id for a token waiting to be revoked. */
export function newRevokeSecretId(): string {
  return `${REVOKE_SECRET_PREFIX}${randomStem()}`
}

/**
 * Ask the server at `serverUrl` to revoke the device `token` belongs to.
 *
 * Never throws: every way it can go wrong is one of the answers above. A request that has not
 * come back in `timeoutMs` counts as `failed` — the device is leaving, and a Disconnect that
 * hangs on a dead network is worse than a revoke tried again later.
 */
export async function tellServer(
  serverUrl: string,
  token: string,
  transport: typeof fetch,
  timeoutMs = REVOKE_TIMEOUT_MS
): Promise<Told> {
  if (!token.startsWith(DEVICE_TOKEN_PREFIX)) {
    return { told: 'unusable', reason: 'what is held is not a device token' }
  }
  const problem = serverUrlProblem(serverUrl)
  if (problem !== null) return { told: 'unusable', reason: problem }
  const client = new SyncClient({
    baseUrl: serverUrl,
    fetch: transport,
    token,
    userAgent: USER_AGENT,
  })
  try {
    return { told: await withTimeout(client.revokeSelf(), timeoutMs) }
  } catch (error) {
    return { told: 'failed', reason: messageOf(error) }
  }
}

/**
 * `work`, or a rejection once `ms` have passed without it. The request itself is left to finish
 * on its own; nothing waits for it.
 */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined
  const late = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error(`the server did not answer in ${ms / 1000} s`)),
      ms
    )
  })
  return Promise.race([work, late]).finally(() => window.clearTimeout(timer))
}

/** What the revoker is handed by the service that owns the connection. */
export interface RevokeHost {
  transport(): typeof fetch
  note(text: string): void
  connection(): DeviceConnection
  saveConnection(patch: { pendingRevoke: PendingRevoke[] }): void
}

/** The device a revoke is about: where it was enrolled, and what it was called there. */
export interface Leaving {
  serverUrl: string
  deviceId: string
  deviceName: string
}

export class Revoker {
  /** A retry already running, which a second caller waits on rather than repeats. */
  private running: Promise<void> | null = null

  constructor(
    private readonly host: RevokeHost,
    readonly timeoutMs = REVOKE_TIMEOUT_MS,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Tell the server a device is leaving; keep its token to tell it later when it cannot be told
   * now. The caller still removes the token from where it was filed: what is kept is a copy
   * under an id of its own.
   */
  async leave(device: Leaving, token: string): Promise<Told> {
    const told = await tellServer(device.serverUrl, token, this.host.transport(), this.timeoutMs)
    const who = `${device.deviceName || device.deviceId} on ${device.serverUrl}`
    if (told.told === 'revoked') this.host.note(`the server stopped accepting ${who}`)
    else if (told.told === 'already') this.host.note(`the server already did not accept ${who}`)
    else if (told.told === 'unusable') {
      this.host.note(`the server was not told that ${who} left: ${told.reason ?? ''}`)
    } else {
      const tokenId = newRevokeSecretId()
      secrets().device.set(tokenId, token)
      const entry: PendingRevoke = { ...device, tokenId, since: new Date(this.now()).toISOString() }
      this.host.saveConnection({ pendingRevoke: [...this.host.connection().pendingRevoke, entry] })
      this.host.note(
        `the server could not be told that ${who} left (${told.reason ?? 'no answer'}); ` +
          'it will be tried again'
      )
    }
    return told
  }

  /**
   * Try every waiting revoke once more. One that the server answers, one whose token is gone
   * from the keychain and one older than a month all stop waiting; the rest wait on.
   */
  retry(): Promise<void> {
    this.running ??= this.retryAll().finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Stop waiting to tell the server, and let the token go: "Forget without telling the server". */
  forget(tokenId: string): void {
    const entry = this.host.connection().pendingRevoke.find((item) => item.tokenId === tokenId)
    if (entry === undefined) return
    secrets().device.remove(tokenId)
    this.drop(new Set([tokenId]))
    this.host.note(
      `stopped waiting to tell ${entry.serverUrl} that ${entry.deviceName || entry.deviceId} ` +
        'left; the token is forgotten'
    )
  }

  private async retryAll(): Promise<void> {
    const done = new Set<string>()
    for (const entry of this.host.connection().pendingRevoke) {
      const who = `${entry.deviceName || entry.deviceId} on ${entry.serverUrl}`
      const token = secrets().device.get(entry.tokenId)
      if (token === '') {
        done.add(entry.tokenId)
        this.host.note(`the token kept to tell the server that ${who} left is gone; given up`)
        continue
      }
      if (this.now() - Date.parse(entry.since) > PENDING_REVOKE_MAX_MS) {
        secrets().device.remove(entry.tokenId)
        done.add(entry.tokenId)
        this.host.note(
          `gave up telling the server that ${who} left: a month has passed; ` +
            'revoke it from the device list if it is still there'
        )
        continue
      }
      const told = await tellServer(entry.serverUrl, token, this.host.transport(), this.timeoutMs)
      if (told.told === 'failed') continue
      secrets().device.remove(entry.tokenId)
      done.add(entry.tokenId)
      this.host.note(
        told.told === 'unusable'
          ? `the server was not told that ${who} left: ${told.reason ?? ''}`
          : `the server now knows that ${who} left`
      )
    }
    this.drop(done)
  }

  /** Written against the connection as it is now: a Disconnect may have queued one meanwhile. */
  private drop(tokenIds: Set<string>): void {
    if (tokenIds.size === 0) return
    const left = this.host.connection().pendingRevoke.filter((item) => !tokenIds.has(item.tokenId))
    this.host.saveConnection({ pendingRevoke: left })
  }
}
