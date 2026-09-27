// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Platform, type App } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService, type SyncServiceDeps } from '@/sync/SyncService'
import { CONNECTION_KEY, readConnection, type DeviceConnection } from '@/sync/connection'
import { setSecrets } from '@/secrets/SecretStore'
import { createPluginSecrets } from '@/secrets/host'
import type { SharedSelective } from '@/transfer/connection'
import type AbelePlugin from '@/main'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'
import { syncServer, type SyncServer } from '../helpers/syncServer'

/**
 * A device leaving, and a device handed over: the server is told when a device disconnects, and
 * a transfer gives the receiving device a device of its own rather than the sender's token.
 *
 * The same seams as `syncService.test.ts` — a real server and engine in this process, only the
 * transport, the socket and the IndexedDB supplied by the test. Kept in a file of its own: that
 * one is long enough already, and nothing here needs its helpers beyond the few copied below.
 */

const EMAIL = 'device@test.io'
const PATIENCE_MS = 10_000
const DAY_MS = 24 * 60 * 60 * 1000

let server: SyncServer
let app: FakeApp
let service: SyncService
let indexedDB: IDBFactory
/** Flipped by a test to make every request fail the way a lost network does. */
let offline = false
/** Every `Authorization` header the service sent. */
let bearers: string[] = []

const plugin = {
  manifest: { id: 'abele' },
  registerDomEvent: () => undefined,
  loadData: () => Promise.resolve({}),
  saveData: () => Promise.resolve(),
  syncAiFeatures: () => undefined,
} as unknown as AbelePlugin

beforeAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>
  globals.window ??= globalThis
  globals.document ??= { visibilityState: 'visible' }
})

/** A vault of its own, with its keychain installed as the plugin's: a device, in effect. */
function device(): void {
  app = buildFakeVault([{ path: 'Existing.md', content: 'already here', mtime: 1000, ctime: 1000 }])
  indexedDB = new IDBFactory()
  setSecrets(createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin))
}

beforeEach(async () => {
  server = await syncServer()
  offline = false
  bearers = []
  Platform.isMobile = false
  AbeleConfig.getInstance().init(plugin)
  AbeleConfig.getInstance().applySettings(undefined)
  device()
  service = SyncService.getInstance()
})

afterEach(async () => {
  await service.destroy()
  await server.close()
  setSecrets(null)
})

const transport: typeof fetch = (input, init) => {
  const auth = new Headers(init?.headers).get('authorization')
  if (auth !== null) bearers.push(auth)
  return offline ? Promise.reject(new Error('the network is gone')) : server.fetch(input, init)
}

function start(extra: Partial<SyncServiceDeps> = {}): void {
  service.init(app as unknown as App, plugin, {
    fetch: transport,
    WebSocket: server.WebSocket,
    indexedDB,
    fallbackMs: 60_000,
    pollMs: 60_000,
    ...extra,
  })
}

/** The service as the next launch of the plugin would have it, on the same device. */
async function relaunch(): Promise<void> {
  await service.destroy()
  service = SyncService.getInstance()
  start()
}

const conn = (): DeviceConnection => service.connection.value
const tokenOf = (id: string): string => app.secretStorage.getSecret(id) ?? ''

async function waitFor(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const until = Date.now() + PATIENCE_MS
  while (Date.now() < until) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`gave up waiting for ${what}; the status was ${service.status.value.state}`)
}

const synced = (): Promise<void> =>
  waitFor(
    'a sync to get through',
    () => service.status.value.state === 'idle' && service.status.value.lastSyncAt !== null
  )

interface Connected {
  accountToken: string
  vaultId: string
  deviceId: string
  token: string
}

async function connect(name = 'Laptop'): Promise<Connected> {
  const { accountToken } = await server.account(EMAIL)
  const { vaultId } = await server.vault(accountToken, 'Home')
  start()
  await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
  await service.chooseVault(vaultId, name)
  await synced()
  return { accountToken, vaultId, deviceId: conn().deviceId, token: tokenOf(conn().deviceTokenId) }
}

/** The ids of the devices the server still takes, as the account's device list shows them. */
async function liveDevices(accountToken: string): Promise<string[]> {
  return (await server.clientOn(accountToken).listDevices()).map((d) => d.id)
}

/** Whether the server still takes a device token: a read of its vault goes through. */
async function accepted(token: string, vaultId: string): Promise<boolean> {
  try {
    await server.clientFor(token, vaultId).state()
    return true
  } catch {
    return false
  }
}

describe('Disconnect tells the server', () => {
  it('has the server stop accepting the device, and forgets the token', async () => {
    const { accountToken, vaultId, deviceId, token } = await connect()
    const tokenId = conn().deviceTokenId

    await service.disconnect()

    expect(await liveDevices(accountToken)).not.toContain(deviceId)
    expect(await accepted(token, vaultId)).toBe(false)
    expect(tokenOf(tokenId)).toBe('')
    expect(conn()).toMatchObject({ serverUrl: '', vaultId: '', deviceId: '', pendingRevoke: [] })
    expect(service.log.value.join('\n')).toContain('the server stopped accepting Laptop')
  })

  it('keeps the token under a name of its own when the server cannot be reached, and tells it at the next launch', async () => {
    const { accountToken, vaultId, deviceId, token } = await connect()
    const tokenId = conn().deviceTokenId
    offline = true

    await service.disconnect()

    expect(conn().pendingRevoke).toHaveLength(1)
    const [waiting] = conn().pendingRevoke
    expect(waiting).toMatchObject({ serverUrl: server.BASE_URL, deviceId, deviceName: 'Laptop' })
    expect(waiting!.tokenId).toMatch(/^abele-sync-device-revoke-/)
    expect(tokenOf(waiting!.tokenId)).toBe(token)
    // A reconnect reuses `deviceTokenId`, so the token must not be found there.
    expect(tokenOf(tokenId)).toBe('')
    expect(readConnection(app).pendingRevoke).toEqual(conn().pendingRevoke)
    expect(await liveDevices(accountToken)).toContain(deviceId)

    offline = false
    await relaunch()
    await waitFor('the revoke to be told', () => conn().pendingRevoke.length === 0)

    expect(await liveDevices(accountToken)).not.toContain(deviceId)
    expect(await accepted(token, vaultId)).toBe(false)
    expect(tokenOf(waiting!.tokenId)).toBe('')
    expect(readConnection(app).pendingRevoke).toEqual([])
  })

  it('tries again before the next sign-in', async () => {
    const { accountToken, vaultId, deviceId } = await connect()
    offline = true
    await service.disconnect()
    offline = false

    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Laptop again')

    expect(conn().pendingRevoke).toEqual([])
    expect(await liveDevices(accountToken)).not.toContain(deviceId)
    expect(await liveDevices(accountToken)).toContain(conn().deviceId)
  })

  it('gives up a revoke a month old, with a line in the log, and sends nothing', async () => {
    const { accountToken, deviceId, token } = await connect()
    offline = true
    await service.disconnect()
    offline = false
    const [waiting] = conn().pendingRevoke
    await service.destroy()
    app.saveLocalStorage(CONNECTION_KEY, {
      ...readConnection(app),
      pendingRevoke: [{ ...waiting, since: new Date(Date.now() - 31 * DAY_MS).toISOString() }],
    })
    bearers = []

    service = SyncService.getInstance()
    start()
    await waitFor('the revoke to be given up', () => conn().pendingRevoke.length === 0)

    expect(bearers.join('\n')).not.toContain(token)
    expect(tokenOf(waiting!.tokenId)).toBe('')
    expect(service.log.value.join('\n')).toContain('gave up telling the server')
    expect(await liveDevices(accountToken)).toContain(deviceId)
  })

  it('forgets a waiting revoke without telling the server, when asked', async () => {
    const { accountToken, deviceId } = await connect()
    offline = true
    await service.disconnect()
    const [waiting] = conn().pendingRevoke
    offline = false

    service.forgetPendingRevoke(waiting!.tokenId)

    expect(conn().pendingRevoke).toEqual([])
    expect(readConnection(app).pendingRevoke).toEqual([])
    expect(tokenOf(waiting!.tokenId)).toBe('')
    expect(await liveDevices(accountToken)).toContain(deviceId)
  })

  it('disconnects cleanly a device the server had already revoked', async () => {
    const { accountToken, deviceId } = await connect()
    await server.clientOn(accountToken).revokeDevice(deviceId)
    await service.syncNow().catch(() => undefined)

    await service.disconnect()

    expect(conn().pendingRevoke).toEqual([])
    expect(conn().serverUrl).toBe('')
    expect(service.status.value.state).toBe('disconnected')
    expect(service.log.value.join('\n')).toContain('the server already did not accept Laptop')
  })

  it('tells the server on Forget too', async () => {
    const { accountToken, deviceId } = await connect()

    await service.forget()

    expect(await liveDevices(accountToken)).not.toContain(deviceId)
    expect(conn().pendingRevoke).toEqual([])
  })

  /**
   * A record whose address was changed outside the service — by hand, or by an older build —
   * runs nothing, and a Disconnect still tells the server that minted the token, never the
   * address written since.
   */
  it('tells the server the device enrolled on, not an address written since', async () => {
    const { accountToken, deviceId, token } = await connect()
    await service.destroy()
    app.saveLocalStorage(CONNECTION_KEY, {
      ...readConnection(app),
      serverUrl: 'https://elsewhere.example.com',
    })
    const seen: string[] = []
    const spying: typeof fetch = (input, init) => {
      seen.push(String(input))
      return transport(input, init)
    }
    service = SyncService.getInstance()
    start({ fetch: spying })
    await waitFor('the refusal', () => service.status.value.state === 'error')
    expect(service.status.value.lastError).toContain(
      `this device is enrolled on ${server.BASE_URL}; disconnect and sign in to the new server`
    )
    await expect(service.enrolSibling('Phone')).rejects.toThrow(
      `this device is enrolled on ${server.BASE_URL}`
    )

    await service.disconnect()

    expect(seen.some((url) => url.startsWith('https://elsewhere.example.com'))).toBe(false)
    expect(await liveDevices(accountToken)).not.toContain(deviceId)
    expect(token).not.toBe('')
  })

  /**
   * A connection made over plain http to another machine, before the https rule: the token is
   * never sent that way, so the server cannot be told — and the Sync tab has to be able to say
   * so, rather than the device being left enrolled with only a log line knowing.
   */
  it('keeps a device on plain http to another machine as one the server cannot be told of', async () => {
    const { token } = await connect()
    await service.destroy()
    app.saveLocalStorage(CONNECTION_KEY, {
      ...readConnection(app),
      serverUrl: 'http://192.168.1.5:8787',
      enrolledUrl: 'http://192.168.1.5:8787',
    })
    const seen: string[] = []
    const spying: typeof fetch = (input, init) => {
      seen.push(String(input))
      return transport(input, init)
    }
    service = SyncService.getInstance()
    start({ fetch: spying })
    await waitFor('the refusal', () => service.status.value.state === 'error')

    await service.disconnect()

    expect(conn().serverUrl).toBe('')
    expect(conn().pendingRevoke).toHaveLength(1)
    const [waiting] = conn().pendingRevoke
    expect(waiting).toMatchObject({ serverUrl: 'http://192.168.1.5:8787', plainHttp: true })
    expect(tokenOf(waiting!.tokenId)).toBe(token)
    await relaunch()
    await service.retryPendingRevokes()
    expect(conn().pendingRevoke).toHaveLength(1)
    expect(seen.some((url) => url.startsWith('http://192.168.1.5'))).toBe(false)

    service.forgetPendingRevoke(waiting!.tokenId)
    expect(conn().pendingRevoke).toEqual([])
    expect(tokenOf(waiting!.tokenId)).toBe('')
  })

  /**
   * Offline, the token is kept under a revoke id to tell the server later. A keychain that will
   * not take that copy would leave the device live on the server with no copy of its token
   * anywhere, so the Disconnect is refused instead, and the device goes on syncing.
   */
  it('refuses a Disconnect it cannot keep the token for, and goes on syncing', async () => {
    const { vaultId, token } = await connect()
    const tokenId = conn().deviceTokenId
    const setSecret = app.secretStorage.setSecret.bind(app.secretStorage)
    app.secretStorage.setSecret = (id: string, value: string) => {
      if (id.startsWith('abele-sync-device-revoke-')) throw new Error('the keychain refused')
      setSecret(id, value)
    }
    offline = true

    await expect(service.disconnect()).rejects.toThrow('stays connected')

    expect(conn()).toMatchObject({ vaultId, deviceTokenId: tokenId, pendingRevoke: [] })
    expect(tokenOf(tokenId)).toBe(token)
    expect(service.isConnected()).toBe(true)
    offline = false
  })
})

/**
 * The token is the server's that minted it. What the agent or a screen may change of the
 * connection never includes where the token goes, or the bookkeeping that decides it.
 */
describe('a connection change cannot move the token', () => {
  it('refuses another server address while the device is enrolled', async () => {
    await connect()

    await expect(
      service.updateConnection({ serverUrl: 'https://elsewhere.example.com' })
    ).rejects.toThrow(
      `this device is enrolled on ${server.BASE_URL}; disconnect and sign in to the new server`
    )

    expect(conn().serverUrl).toBe(server.BASE_URL)
    expect(readConnection(app).serverUrl).toBe(server.BASE_URL)
    expect(service.isConnected()).toBe(true)
    // The same address in another spelling is the same server.
    await service.updateConnection({ serverUrl: `${server.BASE_URL}/` })
    expect(service.isConnected()).toBe(true)
  })

  it('takes another server address on a device that holds no token', async () => {
    start()

    await service.updateConnection({ serverUrl: 'https://elsewhere.example.com' })

    expect(conn().serverUrl).toBe('https://elsewhere.example.com')
  })

  it('refuses the enrolment address, the waiting revokes and a revoke id from outside', async () => {
    await connect()
    const held = { ...conn() }

    for (const patch of [
      { enrolledUrl: 'https://elsewhere.example.com' },
      { pendingRevoke: [] },
      { migrated: false },
    ]) {
      await expect(service.updateConnection(patch as never)).rejects.toThrow('kept by the plugin')
    }
    await expect(
      service.updateConnection({ deviceTokenId: 'abele-sync-device-revoke-x' })
    ).rejects.toThrow('not this device')

    expect(conn()).toEqual(held)
  })
})

describe('a transfer hands over a device of its own', () => {
  const selective = (video: boolean): SharedSelective => {
    const { maxFileBytes: _cap, ...shared } = readConnection(app).selective
    return { ...shared, video }
  }

  it('has the server make a second device for the other side, on the same vault', async () => {
    const { accountToken, vaultId, deviceId, token } = await connect()

    const sibling = await service.enrolSibling('Phone')

    expect(sibling).toMatchObject({
      serverUrl: server.BASE_URL,
      vaultId,
      vaultName: 'Home',
      deviceName: 'Phone',
    })
    expect(sibling.deviceId).not.toBe(deviceId)
    expect(sibling.token).toMatch(/^absd_/)
    expect(sibling.token).not.toBe(token)
    const devices = await server.clientOn(accountToken).listDevices()
    expect(devices.find((d) => d.id === sibling.deviceId)?.enrolled_by).toBe(deviceId)
  })

  it('connects a fresh device as itself, and its Disconnect leaves the sender syncing', async () => {
    const { accountToken, vaultId, deviceId, token } = await connect()
    const sibling = await service.enrolSibling('Phone')
    const { token: siblingToken, ...connection } = sibling
    await service.destroy()

    device()
    service = SyncService.getInstance()
    start()
    await service.adoptTransferred(connection, siblingToken, selective(false))
    await synced()

    expect(conn()).toMatchObject({
      serverUrl: server.BASE_URL,
      enrolledUrl: server.BASE_URL,
      vaultId,
      vaultName: 'Home',
      deviceId: sibling.deviceId,
      deviceName: 'Phone',
    })
    expect(conn().deviceTokenId).toMatch(/^abele-sync-device-/)
    expect(tokenOf(conn().deviceTokenId)).toBe(siblingToken)
    expect(conn().selective.video).toBe(false)
    // Its own cap, never the sender's.
    expect(conn().selective.maxFileBytes).toBeNull()
    expect(await app.vault.adapter.exists('Existing.md')).toBe(true)

    await service.disconnect()

    expect(await liveDevices(accountToken)).not.toContain(sibling.deviceId)
    expect(await liveDevices(accountToken)).toContain(deviceId)
    expect(await accepted(token, vaultId)).toBe(true)
  })

  it('makes no device for the other side while the server cannot be reached', async () => {
    const { accountToken } = await connect()
    const before = await liveDevices(accountToken)
    offline = true

    await expect(service.enrolSibling('Phone')).rejects.toThrow()

    offline = false
    expect(await liveDevices(accountToken)).toEqual(before)
  })

  it('tells the server a device made for a transfer is not needed', async () => {
    const { accountToken } = await connect()
    const { token, ...connection } = await service.enrolSibling('Phone')

    await service.revokeTransferred(connection, token)

    expect(await liveDevices(accountToken)).not.toContain(connection.deviceId)
    expect(conn().pendingRevoke).toEqual([])
  })

  it('switches a device syncing another vault, telling the server there it left', async () => {
    const { accountToken, vaultId, deviceId } = await connect()
    const { vaultId: otherVault } = await server.vault(accountToken, 'Work')
    const { deviceToken } = await server.device(accountToken, otherVault, 'Desk')
    const sender = server.clientOn(deviceToken)
    const minted = await sender.enrolSibling('Laptop at work', 'desktop')
    const oldLedger = (app.loadLocalStorage('abele-sync-ledger') as { stateId: string }).stateId

    await service.adoptTransferred(
      {
        serverUrl: server.BASE_URL,
        vaultId: otherVault,
        vaultName: 'Work',
        deviceId: minted.device_id,
        deviceName: 'Laptop at work',
      },
      minted.device_token,
      selective(true)
    )
    await synced()

    expect(await liveDevices(accountToken)).not.toContain(deviceId)
    expect(conn()).toMatchObject({ vaultId: otherVault, deviceId: minted.device_id })
    const ledger = app.loadLocalStorage('abele-sync-ledger') as { stateId: string; vaultId: string }
    expect(ledger.vaultId).toBe(otherVault)
    expect(ledger.stateId).not.toBe(oldLedger)
    expect(vaultId).not.toBe(otherVault)
  })

  it('refuses a connection to plain http on another machine, and writes nothing', async () => {
    start()

    await expect(
      service.adoptTransferred(
        {
          serverUrl: 'http://192.168.1.5:8787',
          vaultId: 'v1',
          vaultName: 'Home',
          deviceId: 'd1',
          deviceName: 'Phone',
        },
        'absd_x',
        selective(true)
      )
    ).rejects.toThrow('https')

    expect(conn().serverUrl).toBe('')
    expect(app.loadLocalStorage(CONNECTION_KEY)).toBeNull()
  })
})
