// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Platform, type App } from 'obsidian'
import type { VaultClient } from '@abele/sync-core'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService } from '@/sync/SyncService'
import type AbelePlugin from '@/main'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'
import { syncServer, type SyncServer } from '../helpers/syncServer'
import { create, seed } from '../../../../abele-sync/packages/core/tests/helpers/seed.js'

/**
 * The service against a real server, a real engine and a real state database.
 *
 * Nothing here is a stand-in for the sync itself: the Fastify app runs in this process, the
 * engine is the sibling repo's, the state lives in `fake-indexeddb`, and the vault is the
 * fake one every adapter test uses. What is replaced is only what a browser would have
 * supplied — the transport, the socket class and the IndexedDB factory — which is exactly the
 * seam `SyncServiceDeps` exists for.
 *
 * Node, not happy-dom: the server is Fastify on better-sqlite3.
 */

const EMAIL = 'device@test.io'
const IGNORE_FILE = '.abele-sync-ignore'

/** How long a wait for the engine to reach a state may take before the test gives up. */
const PATIENCE_MS = 10_000

let server: SyncServer
let app: FakeApp
let service: SyncService
let indexedDB: IDBFactory
/** Every listener `registerDomEvent` was handed, so a test can fire one. */
let domEvents: (() => void)[] = []
/** How many sockets the service opened; a phone must open none. */
let socketsOpened = 0
/** Flipped by a test to make every request fail the way a lost network does. */
let offline = false

const plugin = {
  manifest: { id: 'abele' },
  registerDomEvent: (_el: unknown, _type: string, cb: () => void) => {
    domEvents.push(cb)
  },
  loadData: () => Promise.resolve({}),
  saveData: () => Promise.resolve(),
  syncAiFeatures: () => undefined,
} as unknown as AbelePlugin

beforeAll(() => {
  // The vault adapter's watcher schedules on `window`, and the visibility hook reads
  // `document`; a Node environment has neither, and the server needs Node.
  const globals = globalThis as unknown as Record<string, unknown>
  globals.window ??= globalThis
  globals.document ??= { visibilityState: 'visible' }
})

beforeEach(async () => {
  server = await syncServer()
  indexedDB = new IDBFactory()
  domEvents = []
  socketsOpened = 0
  offline = false
  Platform.isMobile = false
  app = buildFakeVault([
    { path: 'Existing.md', content: 'already here', mtime: 1000, ctime: 1000 },
    { path: '.obsidian/app.json', content: '{"a":1}', mtime: 1000, ctime: 1000 },
    // The file that must never leave this device: it names the vault, the device and the
    // keychain entry the device token sits in.
    { path: '.obsidian/plugins/abele/data.json', content: '{"sync":{}}', mtime: 1000, ctime: 1000 },
  ])
  AbeleConfig.getInstance().init(plugin)
  AbeleConfig.getInstance().applySettings(undefined)
  service = SyncService.getInstance()
})

afterEach(async () => {
  await service.destroy()
  await server.close()
  Platform.isMobile = false
})

/* -- The seams a browser would have filled ------------------------------- */

/** A `fetch` into the running server that a test can take away by setting `offline`. */
const transport: typeof fetch = (input, init) =>
  offline ? Promise.reject(new Error('the network is gone')) : server.fetch(input, init)

/** The harness's socket, counted, so a test can say that none was opened. */
function countedSocket(): typeof WebSocket {
  return new Proxy(server.WebSocket, {
    construct(target, args: [string | URL, (string | string[])?]) {
      socketsOpened++
      return Reflect.construct(target, args) as WebSocket
    },
  })
}

function start(): void {
  service.init(app as unknown as App, plugin, {
    fetch: transport,
    WebSocket: countedSocket(),
    indexedDB,
    // Long enough that nothing in a test is prompted by a clock it did not ask for.
    fallbackMs: 60_000,
    pollMs: 60_000,
  })
}

/* -- Reading and writing the vault --------------------------------------- */

const read = async (path: string): Promise<string> =>
  new TextDecoder().decode(await app.vault.adapter.readBinary(path))

/** A file put into the vault by hand, folders and all, the way a person would make one. */
const write = async (path: string, text: string): Promise<void> => {
  const cut = path.lastIndexOf('/')
  if (cut !== -1 && !(await app.vault.adapter.exists(path.slice(0, cut)))) {
    await app.vault.adapter.mkdir(path.slice(0, cut))
  }
  await app.vault.adapter.writeBinary(path, new TextEncoder().encode(text).buffer as ArrayBuffer)
}

const settings = () => AbeleConfig.getInstance().sync

/* -- Waiting ------------------------------------------------------------- */

async function waitFor(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const until = Date.now() + PATIENCE_MS
  while (Date.now() < until) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`gave up waiting for ${what}; the status was ${service.status.value.state}`)
}

/** A sync that got through: the state is settled and something was actually synced. */
const synced = (): Promise<void> =>
  waitFor(
    'a sync to get through',
    () => service.status.value.state === 'idle' && service.status.value.lastSyncAt !== null
  )

/* -- Setting a device up ------------------------------------------------- */

interface Connected {
  accountToken: string
  vaultId: string
  /** A client of the scenario's own, on a second device, for seeding and for reading back. */
  other: VaultClient
}

/**
 * The whole connect flow, as the settings tab will drive it: sign in, list the vaults, enrol
 * on one. The extra device is the scenario's, not the one under test.
 */
async function connect(vaultName = 'Home'): Promise<Connected> {
  const { accountToken } = await server.account(EMAIL)
  const { vaultId } = await server.vault(accountToken, vaultName)
  const { deviceToken } = await server.device(accountToken, vaultId, 'scenario')
  const other = server.clientFor(deviceToken, vaultId)

  start()
  const vaults = await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
  expect(vaults.map((vault) => vault.name)).toEqual([vaultName])
  await service.chooseVault(vaultId, 'Laptop')
  return { accountToken, vaultId, other }
}

/** Every live path the server holds for the vault. */
async function serverPaths(client: VaultClient): Promise<string[]> {
  const paths: string[] = []
  let cursor: string | null = null
  do {
    const page = await client.manifest(cursor)
    for (const item of page.items) paths.push(item.path)
    cursor = page.next
  } while (cursor !== null)
  return paths.sort()
}

/* -- The tests ----------------------------------------------------------- */

describe('SyncService — connecting', () => {
  it('signs in, enrols a device, and brings the vault down', async () => {
    const { accountToken } = await server.account(EMAIL)
    const { vaultId } = await server.vault(accountToken, 'Home')
    const { deviceToken } = await server.device(accountToken, vaultId, 'scenario')
    const other = server.clientFor(deviceToken, vaultId)
    await seed(other, [await create(other, 'Notes/Seeded.md', 'from the server')])

    start()
    expect(service.status.value.state).toBe('disconnected')
    expect(service.isConnected()).toBe(false)

    const vaults = await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    expect(vaults.map((vault) => vault.name)).toEqual(['Home'])

    await service.chooseVault(vaultId, 'Laptop')
    await synced()

    expect(await read('Notes/Seeded.md')).toBe('from the server')
    expect(service.isConnected()).toBe(true)
    expect(service.client()).not.toBeNull()
  })

  it('files the device token in the keychain and only its id in the settings', async () => {
    const { vaultId } = await connect()
    await synced()

    expect(settings().vaultId).toBe(vaultId)
    expect(settings().deviceId).not.toBe('')
    expect(settings().deviceTokenId).toMatch(/^abele-sync-device-[a-z0-9]+$/)
    const token = app.secretStorage.getSecret(settings().deviceTokenId)
    expect(token).toMatch(/^absd_/)
    // The token itself is nowhere in what gets written to the vault.
    expect(JSON.stringify(settings())).not.toContain(token)
  })
})

describe('SyncService — syncing', () => {
  it('sends a note made in the vault to the server', async () => {
    const { other } = await connect()
    await synced()

    await write('Local.md', 'made here')
    await service.syncNow()

    expect(await serverPaths(other)).toContain('Local.md')
  })

  it('never sends the plugin data file that names this device', async () => {
    const { other } = await connect()
    await synced()

    const paths = await serverPaths(other)
    // The settings folder syncs; this one file inside it does not.
    expect(paths).toContain('.obsidian/app.json')
    expect(paths).not.toContain('.obsidian/plugins/abele/data.json')
  })

  it('goes from idle through syncing and back', async () => {
    await connect()
    await synced()

    const seen: string[] = []
    const unsubscribe = service.onStatusChange((status) => seen.push(status.state))
    await service.syncNow()
    unsubscribe()

    expect(seen[0]).toBe('syncing')
    expect(seen[seen.length - 1]).toBe('idle')
    expect(service.status.value.lastError).toBeNull()
  })

  it('is offline while nothing can reach the server, and comes back', async () => {
    const { other } = await connect()
    await synced()

    offline = true
    await service.syncNow()
    expect(service.status.value.state).toBe('offline')
    expect(service.status.value.lastError).not.toBeNull()

    offline = false
    await seed(other, [await create(other, 'Back.md', 'the network returned')])
    await service.syncNow()

    expect(service.status.value.state).toBe('idle')
    expect(await read('Back.md')).toBe('the network returned')
  })

  it('goes into error on a refused token, and syncs again once the device is enrolled anew', async () => {
    const { accountToken, vaultId, other } = await connect()
    await synced()

    await server.clientOn(accountToken).revokeDevice(settings().deviceId)
    await service.syncNow()
    expect(service.status.value.state).toBe('error')

    // What the settings tab does about it: sign in and enrol again.
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Laptop')
    service.resume()
    await synced()

    await seed(other, [await create(other, 'After.md', 'enrolled again')])
    await service.syncNow()
    expect(await read('After.md')).toBe('enrolled again')
  })

  it('stops moving anything while it is paused, and starts again when it is resumed', async () => {
    const { other } = await connect()
    await synced()

    service.pause()
    expect(service.status.value.state).toBe('paused')
    expect(settings().paused).toBe(true)

    service.resume()
    expect(settings().paused).toBe(false)
    await synced()

    await seed(other, [await create(other, 'Resumed.md', 'moving again')])
    await service.syncNow()
    expect(await read('Resumed.md')).toBe('moving again')
  })
})

describe('SyncService — what this device syncs', () => {
  it('walks the manifest again when the selective settings change', async () => {
    await connect()
    await synced()
    expect(service.log.value.some((line) => line.includes('rescan:'))).toBe(false)

    settings().selective.images = false
    service.onSettingsSaved()

    await waitFor('the rescan to be announced', () =>
      service.log.value.some((line) =>
        line.includes('rescan: what this device syncs changed since the last sync')
      )
    )
    await synced()
  })

  it('takes the vault ignore file as the daemon does', async () => {
    await write(IGNORE_FILE, '# scratch\nDrafts/\n')
    const { other } = await connect()
    await synced()

    await write('Drafts/note.md', 'not for the server')
    await write('Kept.md', 'for the server')
    await service.syncNow()

    const paths = await serverPaths(other)
    expect(paths).toContain('Kept.md')
    expect(paths).not.toContain('Drafts/note.md')
  })
})

describe('SyncService — disconnecting', () => {
  it('forgets the token and says nothing is connected', async () => {
    await connect()
    await synced()
    const tokenId = settings().deviceTokenId

    await service.disconnect()

    expect(app.secretStorage.getSecret(tokenId)).toBe('')
    expect(settings().serverUrl).toBe('')
    expect(settings().vaultId).toBe('')
    expect(settings().deviceTokenId).toBe('')
    expect(service.isConnected()).toBe(false)
    expect(service.status.value.state).toBe('disconnected')
    expect(service.client()).toBeNull()
  })

  it('keeps what the user chose to sync, which is a preference and not a credential', async () => {
    await connect()
    await synced()
    settings().selective.video = false

    await service.disconnect()

    expect(settings().selective.video).toBe(false)
  })
})

describe('SyncService — the log', () => {
  it('keeps the last five hundred lines and no more', async () => {
    for (let i = 0; i < 600; i++) service.note(`line ${i}`)

    expect(service.log.value).toHaveLength(500)
    expect(service.log.value[0]).toContain('line 100')
    expect(service.log.value[499]).toContain('line 599')
  })

  it('says why nothing happened when there is nothing to sync with', async () => {
    await service.syncNow()
    expect(service.log.value.join('\n')).toContain('not connected to a server')
  })
})

describe('SyncService — a phone', () => {
  it('opens no socket and syncs when the app comes back to the front', async () => {
    Platform.isMobile = true
    const { other } = await connect()
    await synced()

    expect(socketsOpened).toBe(0)
    expect(domEvents).toHaveLength(1)

    await seed(other, [await create(other, 'Phone.md', 'read on the train')])
    // Nothing prompts a phone: no watcher, no socket, no clock.
    expect(await app.vault.adapter.exists('Phone.md')).toBe(false)

    domEvents[0]()
    await waitFor('the note to arrive', () => app.vault.adapter.exists('Phone.md'))
    expect(await read('Phone.md')).toBe('read on the train')
    expect(socketsOpened).toBe(0)
  })

  it('opens a socket on a desktop, which is what the phone is spared', async () => {
    await connect()
    await synced()
    expect(socketsOpened).toBeGreaterThan(0)
  })
})
