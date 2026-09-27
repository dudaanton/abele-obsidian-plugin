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
 * After that it is given up: the server keeps that device enrolled, and the log says so.
 *
 * A connection made over plain http to another machine, before the https rule, is never told at
 * all — the token would cross the network readable. Its token is kept all the same, with an entry
 * that says so, so the Sync tab can show the device is still enrolled there until the person
 * forgets it.
 *
 * A server from before `DELETE /v1/devices/self` answers the device token with 401 on the
 * account's `/:id` route, which reads as `already`. No such server is in use.
 *
 * The keychain is one store for the whole app on a phone, so every id here is minted fresh at
 * random: no two vaults on one phone can file two waiting tokens under the same name.
 */
import { SyncClient } from '@abele/sync-core'
import { PLAIN_HTTP_REFUSED, serverUrlProblem } from '@abele/sync-protocol'
import { secrets } from '@/secrets/SecretStore'
import { REVOKE_SECRET_PREFIX, type DeviceConnection, type PendingRevoke } from './connection'
import { randomStem } from './ids'
import { messageOf } from './messages'
import { USER_AGENT } from './transport'

/** How long a revoke may take before it counts as not reaching the server. */
export const REVOKE_TIMEOUT_MS = 10_000

/** How long a revoke is tried again before the token is let go. */
export const PENDING_REVOKE_MAX_MS = 30 * 24 * 60 * 60 * 1000

/** How a device token starts; anything else is never sent to a server as one. */
const DEVICE_TOKEN_PREFIX = 'absd_'

/**
 * What a server said to a revoke:
 * - `revoked`: it took the token back;
 * - `already`: it no longer takes the token — revoked by the account already, or never its own.
 *   Told to the server that minted the token, that is the same thing;
 * - `unusable`: nothing was sent: the token is not one, or the address is one the https rule
 *   refuses. There is no server to tell, now or later;
 * - `failed`: it could not be told now, and may be later.
 */
export interface Told {
  told: 'revoked' | 'already' | 'unusable' | 'failed'
  reason?: string
  /**
   * From `Revoker.leave`: whether a copy of the token was filed to tell the server later — false
   * when the keychain would not take it, and the caller then still holds the only copy.
   */
  kept?: boolean
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
  /** Who a retry is telling now, for a screen to show while it waits; null once it is done. */
  telling?(line: string | null): void
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
  /** How many are waiting on a retry (`retryWithin`); only then is who is being told said. */
  private waiting = 0

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
    else if (told.told === 'unusable' && told.reason === PLAIN_HTTP_REFUSED) {
      const kept = this.keep(device, token, true, told.reason)
      if (kept) {
        this.host.note(
          `the server was not told that ${who} left: it is plain http to another machine, and ` +
            'the token is not sent that way. It stays enrolled there until it is revoked there'
        )
      }
      return { ...told, kept }
    } else if (told.told === 'unusable') {
      this.host.note(`the server was not told that ${who} left: ${told.reason ?? ''}`)
    } else {
      const kept = this.keep(device, token, false, told.reason ?? 'no answer')
      if (kept) {
        this.host.note(
          `the server could not be told that ${who} left (${told.reason ?? 'no answer'}); ` +
            'it will be tried again'
        )
      }
      return { ...told, kept }
    }
    return told
  }

  /**
   * File a copy of the token under a revoke id of its own, with its entry. False when the
   * keychain would not take it: then nothing is filed, and the caller holds the only copy.
   */
  private keep(device: Leaving, token: string, plainHttp: boolean, why: string): boolean {
    const tokenId = newRevokeSecretId()
    try {
      secrets().device.set(tokenId, token)
    } catch (error) {
      this.host.note(
        `the server was not told that ${device.deviceName || device.deviceId} left (${why}), ` +
          `and the token could not be kept to tell it later: ${messageOf(error)}`
      )
      return false
    }
    const entry: PendingRevoke = {
      ...device,
      tokenId,
      since: new Date(this.now()).toISOString(),
      plainHttp,
    }
    this.host.saveConnection({ pendingRevoke: [...this.host.connection().pendingRevoke, entry] })
    return true
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

  /**
   * `retry`, waited on for at most `ms`: a sign-in goes ahead after that, and the retry carries
   * on behind it. Each server may take the whole revoke timeout, and a sign-in that waited on
   * every one in turn could sit for minutes with nothing moving.
   */
  async retryWithin(ms: number): Promise<void> {
    let timer: number | undefined
    const late = new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, ms)
    })
    this.waiting++
    try {
      await Promise.race([this.retry(), late])
    } finally {
      window.clearTimeout(timer)
      this.waiting--
      this.host.telling?.(null)
    }
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
      // Never sent, never given up: the person forgets it, from the line the Sync tab shows.
      if (entry.plainHttp) continue
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
          `gave up telling the server that ${who} left: a month has passed. The server still ` +
            'has it enrolled, and anyone holding a copy of its token can still sync that vault'
        )
        continue
      }
      if (this.waiting > 0) {
        this.host.telling?.(
          `Telling ${entry.serverUrl} that ${entry.deviceName || entry.deviceId} left…`
        )
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
