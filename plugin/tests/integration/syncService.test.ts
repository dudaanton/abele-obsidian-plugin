// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Platform, type App } from 'obsidian'
import type { SelectiveSettings, VaultClient } from '@abele/sync-core'
import { AbeleConfig } from '@/services/AbeleConfig'
import { PLAIN_HTTP_REFUSED } from '@abele/sync-protocol'
import { PLAIN_HTTP_CONNECTION, SyncService, type SyncServiceDeps } from '@/sync/SyncService'
import { IndexedDbStateStore, stateDatabaseName } from '@/sync/IndexedDbStateStore'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import {
  CONNECTION_KEY,
  MOBILE_MAX_FILE_BYTES,
  readConnection,
  type DeviceConnection,
} from '@/sync/connection'
import { runAfterSync } from '@/helpers/runAfterSync'
import { setSecrets, type SecretStore } from '@/secrets/SecretStore'
import { createPluginSecrets } from '@/secrets/host'
import type AbelePlugin from '@/main'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'
import { syncServer, type SyncServer } from '../helpers/syncServer'
import { blob, create, seed } from '@abele/sync-test-seed'

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
/** The plugin's secret store, on this device's keychain, as `onload` installs it. */
let secretStore: SecretStore
let indexedDB: IDBFactory
/** Every listener `registerDomEvent` was handed, so a test can fire one. */
let domEvents: (() => void)[] = []
/** How many sockets the service opened; a phone must open none. */
let socketsOpened = 0
/** Flipped by a test to make every request fail the way a lost network does. */
let offline = false
/** How many times the service told the plugin its `data.json` changed on disk. */
let settingsArrived = 0

const plugin = {
  manifest: { id: 'abele' },
  registerDomEvent: (_el: unknown, _type: string, cb: () => void) => {
    domEvents.push(cb)
  },
  loadData: () => Promise.resolve({}),
  saveData: () => Promise.resolve(),
  syncAiFeatures: () => undefined,
  onExternalSettingsChange: () => {
    settingsArrived++
    return Promise.resolve()
  },
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
  settingsArrived = 0
  bearers = []
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
  secretStore = createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin)
  setSecrets(secretStore)
  service = SyncService.getInstance()
})

afterEach(async () => {
  await service.destroy()
  await server.close()
  setSecrets(null)
  Platform.isMobile = false
})

/* -- The seams a browser would have filled ------------------------------- */

/** Every `Authorization` header the service sent, so a test can say what it never sent. */
let bearers: string[] = []

/** A `fetch` into the running server that a test can take away by setting `offline`. */
const transport: typeof fetch = (input, init) => {
  const auth = new Headers(init?.headers).get('authorization')
  if (auth !== null) bearers.push(auth)
  return offline ? Promise.reject(new Error('the network is gone')) : server.fetch(input, init)
}

/** The harness's socket, counted, so a test can say that none was opened. */
function countedSocket(): typeof WebSocket {
  return new Proxy(server.WebSocket, {
    construct(target, args: [string | URL, (string | string[])?]) {
      socketsOpened++
      return Reflect.construct(target, args) as WebSocket
    },
  })
}

function start(extra: Partial<SyncServiceDeps> = {}): void {
  service.init(app as unknown as App, plugin, {
    fetch: transport,
    WebSocket: countedSocket(),
    indexedDB,
    // Long enough that nothing in a test is prompted by a clock it did not ask for.
    fallbackMs: 60_000,
    pollMs: 60_000,
    ...extra,
  })
}

/**
 * The daemon's scope key, spelled the daemon's way — Node's SHA-256 over the same JSON. The
 * plugin computes it through WebCrypto, and the two have to agree or a device that moved
 * between the daemon and the plugin would rescan for ever.
 */
const daemonScopeKey = (selective: SelectiveSettings, ignoreText: string | null): string =>
  createHash('sha256')
    .update(JSON.stringify({ selective, ignore: ignoreText }))
    .digest('hex')

/** What the service filed in its own ledger, read through a second connection. */
async function meta(key: string): Promise<string | null> {
  const store = await IndexedDbStateStore.open(indexedDB, stateDatabaseName(ledgerOf().stateId))
  try {
    return await store.getMeta(key)
  } finally {
    store.close()
  }
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

/** This device's connection, as the service holds it. */
const conn = (): DeviceConnection => service.connection.value

/**
 * A connection record put straight into this vault's local storage — what an older build, a
 * hand in the console, or the next launch finds there — without going through the service.
 */
const storeConnection = (patch: Partial<DeviceConnection>): void =>
  app.saveLocalStorage(CONNECTION_KEY, { ...readConnection(app), ...patch })

/** The ledger this vault syncs on, as its local storage holds it. */
const ledgerOf = (): { stateId: string; vaultId: string } =>
  (app.loadLocalStorage('abele-sync-ledger') as { stateId: string; vaultId: string } | null) ?? {
    stateId: '',
    vaultId: '',
  }

/* -- Waiting ------------------------------------------------------------- */

async function waitFor(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const until = Date.now() + PATIENCE_MS
  while (Date.now() < until) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`gave up waiting for ${what}; the status was ${service.status.value.state}`)
}

/** Long enough for anything already queued to have run. */
const tick = (ms = 50): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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
async function connect(
  extra: Partial<SyncServiceDeps> = {},
  vaultName = 'Home'
): Promise<Connected> {
  const { accountToken } = await server.account(EMAIL)
  const { vaultId } = await server.vault(accountToken, vaultName)
  const { deviceToken } = await server.device(accountToken, vaultId, 'scenario')
  const other = server.clientFor(deviceToken, vaultId)

  start(extra)
  const vaults = await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
  expect(vaults.map((vault) => vault.name)).toEqual([vaultName])
  await service.chooseVault(vaultId, 'Laptop')
  return { accountToken, vaultId, other }
}

/** A new version of a file the server already holds, made by the scenario's own device. */
async function modify(client: VaultClient, path: string, content: string): Promise<void> {
  const page = await client.manifest(null)
  const item = page.items.find((held) => held.path === path)
  if (item === undefined) throw new Error(`the server holds no ${path}`)
  await seed(client, [
    {
      op: 'modify',
      file_id: item.file_id,
      base_version_id: item.version_id,
      ...(await blob(client, content)),
      mtime: Date.now(),
    },
  ])
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

  it('files the device token in the keychain and only its id in the connection', async () => {
    const { vaultId } = await connect()
    await synced()

    expect(conn().vaultId).toBe(vaultId)
    expect(conn().deviceId).not.toBe('')
    expect(conn().deviceTokenId).toMatch(/^abele-sync-device-[a-z0-9]+$/)
    const token = app.secretStorage.getSecret(conn().deviceTokenId)
    expect(token).toMatch(/^absd_/)
    // The token itself is nowhere in the connection, and nothing of it is in the settings.
    expect(JSON.stringify(app.loadLocalStorage(CONNECTION_KEY))).not.toContain(token)
    expect(readConnection(app)).toEqual(conn())
  })

  /**
   * `data.json` is what a copy of the vault, a synced settings file or a transfer hands to
   * another device. Nothing in it may say where this device syncs.
   */
  it('writes nothing of the connection into the settings file', async () => {
    const { vaultId } = await connect()
    await synced()

    const written = JSON.stringify(AbeleConfig.getInstance().exportSettings())
    expect(written).not.toContain(vaultId)
    expect(written).not.toContain(conn().deviceTokenId)
    expect(written).not.toContain(conn().deviceId)
    expect(AbeleConfig.getInstance().exportSettings().sync).toEqual({ keySignature: null })
  })

  /**
   * The synced secret store travels to every device the settings reach. A token that went with
   * it would let a phone sync as this laptop, and the server would see one device where there
   * are two: each device enrols and keeps its own.
   */
  it('keeps the device token out of the synced secret store, open or opened later', async () => {
    await secretStore.enable('passphrase', { iterations: 1000 })
    await connect()
    await synced()
    const tokenId = conn().deviceTokenId

    expect(app.secretStorage.getSecret(tokenId)).toMatch(/^absd_/)
    expect(secretStore.contents()!.map((c) => c.id)).not.toContain(tokenId)

    // Made afresh with the token already in the keychain: it is not one of the ids moved in.
    await secretStore.disable()
    await secretStore.enable('passphrase', { iterations: 1000 })
    expect(secretStore.contents()!.map((c) => c.id)).not.toContain(tokenId)
    expect(service.isConnected()).toBe(true)
  })
})

describe('SyncService — a sign-in left unfinished', () => {
  it('forgets the account token once the connect flow is let go', async () => {
    const { accountToken } = await server.account(EMAIL)
    const { vaultId } = await server.vault(accountToken, 'Home')
    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)

    service.endConnect()

    await expect(service.chooseVault(vaultId, 'Laptop')).rejects.toThrow('sign in')
    expect(service.isConnected()).toBe(false)
  })

  /** The tab closed while the enrolment was on the wire: the device is still enrolled there. */
  it('files the server an enrolment started on even when the tab closes mid-way', async () => {
    const { accountToken } = await server.account(EMAIL)
    const { vaultId } = await server.vault(accountToken, 'Home')
    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)

    const choosing = service.chooseVault(vaultId, 'Laptop')
    service.endConnect()
    await choosing

    expect(conn().serverUrl).toBe(server.BASE_URL)
    expect(conn().vaultId).toBe(vaultId)
    await synced()
    expect(service.isConnected()).toBe(true)
  })
})

/**
 * The device token travels in every request, so plain http to another machine hands it to
 * anyone on the way. Only a server on this device may be reached without TLS.
 */
describe('SyncService — plain http', () => {
  it('refuses to sign in over plain http to another machine, before anything is sent', async () => {
    await server.account(EMAIL)
    let requests = 0
    start({
      fetch: (input, init) => {
        requests++
        return transport(input, init)
      },
    })

    await expect(
      service.connect('http://192.168.1.5:8787', EMAIL, server.TEST_PASSWORD)
    ).rejects.toThrow(PLAIN_HTTP_REFUSED)
    expect(requests).toBe(0)
  })

  it('signs in over plain http to a server on this device', async () => {
    await server.account(EMAIL)
    start()

    await expect(
      service.connect('http://localhost:8787', EMAIL, server.TEST_PASSWORD)
    ).resolves.toEqual([])
  })

  /**
   * A connection saved before the rule, or written into `data.json` by hand. It is not taken
   * away — the person may want to read what it was — but nothing is built on it either.
   */
  it('builds nothing on a saved plain-http connection to another machine, and says why', async () => {
    await connect()
    await synced()
    await service.destroy()

    storeConnection({ serverUrl: 'http://192.168.1.5:8787' })
    bearers = []
    service = SyncService.getInstance()
    start()
    await waitFor('the refusal to be reported', () => service.status.value.state === 'error')

    expect(service.status.value.lastError).toBe(PLAIN_HTTP_CONNECTION)
    expect(service.isConnected()).toBe(false)
    expect(service.client()).toBeNull()
    expect(bearers).toEqual([])
    // Still set up: the connection is refused, not forgotten.
    expect(conn().serverUrl).toBe('http://192.168.1.5:8787')
    expect(conn().vaultId).not.toBe('')
  })

  it('refuses to be pointed at plain http to another machine, and keeps what it had', async () => {
    await connect()
    await synced()
    const held = conn().serverUrl

    await expect(
      service.updateConnection({ serverUrl: 'http://192.168.1.5:8787' })
    ).rejects.toThrow(PLAIN_HTTP_REFUSED)

    expect(conn().serverUrl).toBe(held)
    expect(readConnection(app).serverUrl).toBe(held)
    expect(service.isConnected()).toBe(true)
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

  it('sends its own data.json like any plugin’s settings, and never its chat index', async () => {
    await write('.obsidian/plugins/abele/chat-index.json', '{"chats":[]}')
    const { other } = await connect()
    await synced()

    const paths = await serverPaths(other)
    expect(paths).toContain('.obsidian/app.json')
    // It names no device any more (the connection is in local storage), so it travels.
    expect(paths).toContain('.obsidian/plugins/abele/data.json')
    // The chat index is each device's own, and no sync carries it.
    expect(paths).not.toContain('.obsidian/plugins/abele/chat-index.json')
  })

  it('has the plugin reload its settings, once, when a pull wrote its data.json', async () => {
    const { other } = await connect()
    await synced()
    expect(settingsArrived).toBe(0)

    await modify(other, '.obsidian/plugins/abele/data.json', '{"tasksFolder":"Elsewhere"}')
    await service.syncNow()
    await waitFor('the plugin to be told', () => settingsArrived > 0)

    expect(await read('.obsidian/plugins/abele/data.json')).toBe('{"tasksFolder":"Elsewhere"}')
    await service.syncNow()
    await tick()
    expect(settingsArrived).toBe(1)
  })

  it('leaves the settings alone when a pull wrote only other files', async () => {
    const { other } = await connect()
    await synced()

    await seed(other, [await create(other, 'Notes/New.md', 'from another device')])
    await modify(other, '.obsidian/app.json', '{"a":2}')
    await service.syncNow()
    await tick()

    expect(await read('Notes/New.md')).toBe('from another device')
    expect(settingsArrived).toBe(0)
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

    await server.clientOn(accountToken).revokeDevice(conn().deviceId)
    await service.syncNow()
    expect(service.status.value.state).toBe('error')
    // Not the client's "the request was refused", which says nothing a person can act on.
    expect(service.status.value.lastError).toContain('connect again from the Sync settings')

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
    expect(conn().paused).toBe(true)
    // This device's own, so a pause here is never another device's.
    expect(readConnection(app).paused).toBe(true)
    expect(JSON.stringify(AbeleConfig.getInstance().exportSettings())).not.toContain('paused')

    service.resume()
    expect(conn().paused).toBe(false)
    await synced()

    await seed(other, [await create(other, 'Resumed.md', 'moving again')])
    await service.syncNow()
    expect(await read('Resumed.md')).toBe('moving again')
  })

  it('moves nothing on Sync now or Rescan while paused, and says why', async () => {
    const { other } = await connect()
    await synced()
    service.pause()

    await write('Made while paused.md', 'stays here')
    await seed(other, [await create(other, 'Sent while paused.md', 'stays there')])
    await service.syncNow()
    await service.rescan()

    expect(await serverPaths(other)).not.toContain('Made while paused.md')
    expect(await app.vault.adapter.exists('Sent while paused.md')).toBe(false)
    expect(service.status.value.state).toBe('paused')
    expect(service.log.value.join('\n')).toContain('sync now: sync is paused')
    expect(service.log.value.join('\n')).toContain('rescan: sync is paused')
  })
})

/**
 * The engine is torn down and built again after a change to what this device syncs, and at
 * startup it is built for the first time. A Pause or a Resume pressed in that gap finds no
 * engine to act on, and the one being built read the switch before it was pressed: the engine
 * must still end up where the Sync tab — which reads the connection — says it is.
 */
describe('SyncService — pause and resume while an engine is being built', () => {
  /** Runs `press` the moment the next build opens its state database, before it has an engine. */
  function duringNextBuild(press: () => void): void {
    const open = IndexedDbStateStore.open.bind(IndexedDbStateStore)
    vi.spyOn(IndexedDbStateStore, 'open').mockImplementationOnce((factory, name) => {
      press()
      return open(factory, name)
    })
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('pauses the engine that was being built when Pause was pressed', async () => {
    await connect()
    await synced()

    duringNextBuild(() => service.pause())
    await service.updateConnection({ selective: { ...conn().selective, pdf: false } })

    await waitFor('the rebuilt engine to be paused', () => service.status.value.state === 'paused')
    await tick()
    expect(conn().paused).toBe(true)
    expect(service.status.value.state).toBe('paused')
  })

  it('resumes the engine that was being built when Resume was pressed', async () => {
    const { other } = await connect()
    await synced()
    service.pause()
    await waitFor('the pause', () => service.status.value.state === 'paused')

    duringNextBuild(() => service.resume())
    await service.updateConnection({ selective: { ...conn().selective, pdf: false } })

    await synced()
    expect(conn().paused).toBe(false)
    await seed(other, [await create(other, 'Moving.md', 'not paused')])
    await service.syncNow()
    expect(await read('Moving.md')).toBe('not paused')
  })
})

describe('SyncService — what this device syncs', () => {
  it('walks the manifest again when the selective settings change', async () => {
    await connect()
    await synced()
    expect(service.log.value.some((line) => line.includes('rescan:'))).toBe(false)

    await service.updateConnection({ selective: { ...conn().selective, images: false } })

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

  /**
   * The engine files the ignore file's text with the scope it took its marks under, as the
   * daemon hands it over: a later engine on another scope then knows what this one left out.
   */
  it('hands the engine the ignore file itself, which it files with the scope', async () => {
    await write(IGNORE_FILE, '# scratch\nDrafts/\n')
    await connect()
    await synced()

    await waitFor('the scope to be filed', async () => (await meta('marked-scope')) !== null)
    const filed = JSON.parse((await meta('marked-scope'))!) as { ignore?: string | null }
    expect(filed.ignore).toBe('# scratch\nDrafts/\n')
  })
})

/**
 * Obsidian never indexes a path with a dot-segment, so a hidden file this device pulled would
 * be missing from the very next scan — and a missing file with a ledger entry is a delete. A
 * daemon on a git or Syncthing folder sends exactly such files, and would get them deleted.
 */
describe('SyncService — hidden paths', () => {
  // The protocol rejects arbitrary leading-dot segments; .trash is the one hidden directory
  // it accepts on the wire (beside .obsidian, which is handled as settings).
  const HIDDEN = ['.trash/x.md']

  it('neither takes nor deletes a hidden file another device sent', async () => {
    const { accountToken } = await server.account(EMAIL)
    const { vaultId } = await server.vault(accountToken, 'Home')
    const { deviceToken } = await server.device(accountToken, vaultId, 'scenario')
    const other = server.clientFor(deviceToken, vaultId)
    const ops = []
    for (const path of HIDDEN) ops.push(await create(other, path, `the daemon's ${path}`))
    await seed(other, ops)

    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Laptop')
    await synced()
    // The scan after the pull is where a pulled hidden file would turn into a delete.
    await service.syncNow()
    await service.syncNow()

    const paths = await serverPaths(other)
    for (const path of HIDDEN) {
      expect(paths).toContain(path)
      expect(await app.vault.adapter.exists(path)).toBe(false)
    }
  })

  it('keeps an overridden config folder out, and leaves the one on the server alone', async () => {
    app = buildFakeVault([
      { path: 'Existing.md', content: 'already here', mtime: 1000, ctime: 1000 },
      { path: '.obsidian-mobile/app.json', content: '{"m":1}', mtime: 1000, ctime: 1000 },
    ])
    app.vault.configDir = '.obsidian-mobile'
    const { accountToken } = await server.account(EMAIL)
    const { vaultId } = await server.vault(accountToken, 'Home')
    const { deviceToken } = await server.device(accountToken, vaultId, 'scenario')
    const other = server.clientFor(deviceToken, vaultId)
    await seed(other, [await create(other, '.obsidian/app.json', '{"desktop":1}')])

    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Phone')
    await synced()
    await service.syncNow()

    const paths = await serverPaths(other)
    expect(paths).toContain('.obsidian/app.json')
    expect(paths).toContain('Existing.md')
    expect(paths).not.toContain('.obsidian-mobile/app.json')
    expect(await app.vault.adapter.exists('.obsidian/app.json')).toBe(false)
    expect(service.log.value.join('\n')).toContain('.obsidian-mobile')
  })
})

describe('SyncService — disconnecting', () => {
  it('forgets the token and says nothing is connected', async () => {
    await connect()
    await synced()
    const tokenId = conn().deviceTokenId

    await service.disconnect()

    expect(app.secretStorage.getSecret(tokenId)).toBe('')
    expect(conn().serverUrl).toBe('')
    expect(conn().vaultId).toBe('')
    expect(readConnection(app).vaultId).toBe('')
    // The id is a keychain name, not a credential: keeping it is what stops a reconnect
    // leaving an entry behind every time.
    expect(conn().deviceTokenId).toBe(tokenId)
    expect(service.isConnected()).toBe(false)
    expect(service.status.value.state).toBe('disconnected')
    expect(service.client()).toBeNull()
  })

  it('keeps what the user chose to sync, which is a preference and not a credential', async () => {
    await connect()
    await synced()
    await service.updateConnection({ selective: { ...conn().selective, video: false } })

    await service.disconnect()

    expect(conn().selective.video).toBe(false)
    expect(readConnection(app).selective.video).toBe(false)
  })

  it('reuses the one keychain entry when the same device connects again', async () => {
    const { vaultId } = await connect()
    await synced()
    const tokenId = conn().deviceTokenId
    const stateId = ledgerOf().stateId

    await service.disconnect()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Laptop')
    await synced()

    expect(conn().deviceTokenId).toBe(tokenId)
    expect(app.secretStorage.getSecret(tokenId)).toMatch(/^absd_/)
    // The same vault, so the same ledger: reconnecting costs a scan, not a download.
    expect(ledgerOf().stateId).toBe(stateId)
  })

  it('forget drops the ledger and the keychain name as well', async () => {
    await connect()
    await synced()
    const tokenId = conn().deviceTokenId
    const stateId = ledgerOf().stateId

    await service.forget()

    expect(ledgerOf().stateId).toBe('')
    expect(conn().deviceTokenId).toBe('')
    expect(readConnection(app).deviceTokenId).toBe('')
    expect(app.secretStorage.getSecret(tokenId)).toBe('')
    // The database is gone: a fresh one opens with nothing filed in it.
    const store = await IndexedDbStateStore.open(indexedDB, stateDatabaseName(stateId))
    try {
      expect(await store.getMeta('scope')).toBeNull()
    } finally {
      store.close()
    }
  })
})

/**
 * The keychain id comes out of the connection, which the agent can write and a hand in the
 * console can edit. Pointed at a provider's key, it would send that key to the server as a
 * bearer token and delete it on Disconnect. Only an id this plugin mints is read or taken.
 */
describe('SyncService — a keychain id it did not mint', () => {
  it('refuses to be pointed at a secret by another id, and neither sends nor deletes it', async () => {
    await connect()
    await synced()
    app.secretStorage.setSecret('abele-provider-x', 'sk-provider')

    await expect(service.updateConnection({ deviceTokenId: 'abele-provider-x' })).rejects.toThrow(
      'abele-sync-device-'
    )
    bearers = []
    await service.syncNow()
    await service.disconnect()
    await service.forget()

    expect(bearers.join('\n')).not.toContain('sk-provider')
    expect(app.secretStorage.getSecret('abele-provider-x')).toBe('sk-provider')
  })

  /**
   * Not connected, and not silently so: the Sync tab shows the sign-in card only for
   * `disconnected`, and a device that lost its token id to a damaged record would drop to it
   * with no word of why. The error says it, and Disconnect clears it.
   */
  it('says the connection is damaged at a launch whose connection names such an id', async () => {
    const { vaultId } = await connect()
    await synced()
    await service.destroy()
    app.secretStorage.setSecret('abele-provider-x', 'sk-provider')
    storeConnection({ deviceTokenId: 'abele-provider-x', vaultId })
    bearers = []

    service = SyncService.getInstance()
    start()
    await waitFor('the damage to be said', () => service.status.value.state === 'error')

    expect(service.isConnected()).toBe(false)
    expect(service.status.value.lastError).toContain('the saved connection is damaged')
    expect(service.status.value.lastError).toContain('deviceTokenId')
    expect(service.log.value.join('\n')).toContain('the saved connection is damaged')
    expect(bearers.join('\n')).not.toContain('sk-provider')

    await service.disconnect()
    expect(service.status.value.state).toBe('disconnected')
  })
})

/**
 * The agent is handed the Sync tab's road, and a change from outside is held to the tab's rules
 * before anything is written: selective settings that are not what they should be are refused
 * whole, rather than filled out silently into something nobody asked for and reported as made.
 */
describe('SyncService — what a connection change may hold', () => {
  it('refuses selective settings that are not what they should be, and writes nothing', async () => {
    await connect()
    await synced()
    const before = conn().selective

    for (const bad of [
      { excludedFolders: 'Archive' as unknown as string[] },
      { video: 'no' as unknown as boolean },
      { maxFileBytes: Number.NaN },
      { maxFileBytes: 0 },
    ]) {
      await expect(
        service.updateConnection({ selective: { ...conn().selective, ...bad } })
      ).rejects.toThrow(/selective/)
    }

    expect(conn().selective).toEqual(before)
    expect(readConnection(app).selective).toEqual(before)
    await synced()
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

/**
 * `entryFor` is the one thing the version history and the trash need from this service that no
 * screen can work out for itself: a path is not an identity on the server — a file that was
 * moved kept its id and changed its name — and the ledger is the only place a host holds the
 * two together.
 */
describe('SyncService — the ledger a screen reads', () => {
  it('says which file on the server a path is', async () => {
    const { other } = await connect()
    await synced()
    await write('Local.md', 'made here')
    await service.syncNow()

    const entry = await service.entryFor('Local.md')

    expect(entry).not.toBeNull()
    expect(entry?.fileId).not.toBe('')
    // The same file the server knows under that name, and the version this device agrees with.
    const versions = await other.versions(entry!.fileId)
    expect(versions[0].path).toBe('Local.md')
    expect(versions[0].version_id).toBe(entry?.versionId)
  })

  it('says nothing about a path the engine has never synced', async () => {
    await connect()
    await synced()

    expect(await service.entryFor('Nowhere.md')).toBeNull()
  })

  it('says nothing at all on a device nobody has set up', async () => {
    start()
    await tick()

    expect(service.isConnected()).toBe(false)
    expect(await service.entryFor('Existing.md')).toBeNull()
  })
})

describe('SyncService — one ledger per local vault', () => {
  it("does not let a second local vault read the first one's ledger", async () => {
    const { vaultId, other } = await connect()
    await synced()
    const first = ledgerOf().stateId
    expect(first).not.toBe('')
    expect(await serverPaths(other)).toContain('Existing.md')

    // The same machine, the same server vault, a different local vault: Obsidian's IndexedDB
    // is one namespace per app, so a ledger keyed by the *server* vault id would be shared.
    // This vault holds none of those files, and the scanner would call every one of them
    // deleted and push a delete for each.
    await service.destroy()
    AbeleConfig.getInstance().applySettings(undefined)
    app = buildFakeVault([])
    service = SyncService.getInstance()
    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Desktop')
    await synced()

    expect(ledgerOf().stateId).not.toBe(first)
    expect(await serverPaths(other)).toContain('Existing.md')
    expect(await read('Existing.md')).toBe('already here')
  })

  it('starts a fresh ledger when the device is pointed at another vault', async () => {
    const { accountToken } = await connect()
    await synced()
    const first = ledgerOf().stateId

    const { vaultId: second } = await server.vault(accountToken, 'Work')
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(second, 'Laptop')
    await synced()

    expect(ledgerOf().stateId).not.toBe(first)
    expect(ledgerOf().vaultId).toBe(second)
    // And the one it replaced is gone rather than left behind for the life of the vault.
    expect(service.log.value.join('\n')).toContain('dropped the ledger')
    const store = await IndexedDbStateStore.open(indexedDB, stateDatabaseName(first))
    try {
      expect(await store.getMeta('scope')).toBeNull()
    } finally {
      store.close()
    }
  })

  it('starts a fresh ledger when a disconnected device joins another vault', async () => {
    const { accountToken, vaultId: first } = await connect()
    await synced()
    const firstState = ledgerOf().stateId
    expect(ledgerOf().vaultId).toBe(first)

    // A disconnect empties `vaultId`, so only `stateVaultId` still knows which vault the
    // ledger describes. Without it this device would open the first vault's ledger against the
    // second, find every entry accounted for, and send nothing — or deletes carrying the wrong
    // file ids.
    await service.disconnect()

    const { vaultId: second } = await server.vault(accountToken, 'Work')
    const { deviceToken } = await server.device(accountToken, second, 'scenario-b')
    const otherB = server.clientFor(deviceToken, second)

    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(second, 'Laptop')
    await synced()

    expect(ledgerOf().stateId).not.toBe(firstState)
    expect(ledgerOf().vaultId).toBe(second)
    expect(await serverPaths(otherB)).toContain('Existing.md')
  })
})

/** A `data.json` as a build before the move wrote it: the connection inside the sync block. */
const olderDataJson = (connection: DeviceConnection): Record<string, unknown> => {
  // An older build knew none of the fields added since: the vault's name, the enrolment address
  // and the revokes still waiting.
  const {
    migrated: _migrated,
    vaultName: _name,
    enrolledUrl: _enrolled,
    pendingRevoke: _pending,
    ...block
  } = connection
  return {
    ...AbeleConfig.getInstance().exportSettings(),
    sync: { ...block, keySignature: null },
  }
}

/**
 * What `onload` does with the settings file: load it, then read the connection — which moves
 * it out of the file the first time. `saveData` is recorded so a test can see what was written.
 */
async function launch(stored: unknown): Promise<unknown[]> {
  const written: unknown[] = []
  const loading = vi.spyOn(plugin, 'loadData').mockResolvedValue(stored)
  const saving = vi.spyOn(plugin, 'saveData').mockImplementation((data: unknown) => {
    written.push(JSON.parse(JSON.stringify(data)))
    return Promise.resolve()
  })
  try {
    await AbeleConfig.getInstance().loadSettings()
    await service.openConnection(app as unknown as App)
  } finally {
    loading.mockRestore()
    saving.mockRestore()
  }
  return written
}

/**
 * IndexedDB is one namespace for every vault in the app, so the name a ledger is filed under
 * must be something no file can carry: a transfer or a copied `data.json` that brought it along
 * would open another vault's ledger, find none of its files on this disk, and delete them all.
 */
describe('SyncService — a ledger no file can carry', () => {
  /** Where the ledger id is kept: this vault's own local storage. */
  const ledger = (): unknown => app.loadLocalStorage('abele-sync-ledger')

  /**
   * A second local vault on this machine: its own disk, keychain and local storage, and the
   * same IndexedDB as the first. The device token is in its keychain, as "Include keys" puts it.
   */
  function secondVault(tokenId: string, token: string): void {
    app = buildFakeVault([])
    app.secretStorage.setSecret(tokenId, token)
    app.secretStorage.setSecret(
      `${tokenId}-server`,
      JSON.stringify({ server: server.BASE_URL, token })
    )
    secretStore = createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin)
    setSecrets(secretStore)
  }

  it('requires recovery rather than silently minting a ledger for a handed connection', async () => {
    const { other } = await connect()
    await synced()
    const tokenId = conn().deviceTokenId
    const token = app.secretStorage.getSecret(tokenId)
    // The connection exactly as this device holds it, set up in the second vault.
    const handed = { ...conn() }
    await service.destroy()

    secondVault(tokenId, token)
    storeConnection(handed)
    service = SyncService.getInstance()
    start()
    await waitFor(
      'missing descriptor to require recovery',
      () => service.status.value.state === 'error'
    )

    expect(service.status.value.lastError).toContain('Sync recovery required')
    expect(service.isConnected()).toBe(false)
    expect(await app.vault.adapter.exists('Existing.md')).toBe(false)
    expect(app.loadLocalStorage('abele-sync-ledger')).toBeNull()
    expect(await serverPaths(other)).toContain('Existing.md')
  })

  /**
   * An older build kept the connection in `data.json`. A copy of such a file arriving with the
   * token in the keychain too — what a phone does, whose keychain is one for every vault on it —
   * is still not adopted: this vault never enrolled, so it holds no ledger for that vault.
   */
  it('does not adopt an older data.json copied from another vault, token or no token', async () => {
    const { other } = await connect()
    await synced()
    const tokenId = conn().deviceTokenId
    const token = app.secretStorage.getSecret(tokenId)
    const copied = olderDataJson(conn())
    await service.destroy()

    secondVault(tokenId, token)
    service = SyncService.getInstance()
    await launch(copied)
    start()
    await tick()

    expect(service.isConnected()).toBe(false)
    expect(conn()).toMatchObject({ serverUrl: '', vaultId: '', deviceTokenId: '' })
    expect(service.log.value.join('\n')).toContain('was not adopted')
    expect(await serverPaths(other)).toContain('Existing.md')
  })

  it('writes no ledger id into the settings file', async () => {
    await connect()
    await synced()

    const written = JSON.stringify(AbeleConfig.getInstance().exportSettings())
    expect(ledger()).toMatchObject({ stateId: expect.any(String) as string })
    const { stateId } = ledger() as { stateId: string }
    expect(stateId).not.toBe('')
    expect(written).not.toContain(stateId)
    expect(written).not.toContain('stateId')
  })

  /**
   * A build of this branch that kept the ledger id in `data.json` was never released, so
   * nothing moves it out: an id the file still names is ignored. A saved connection without
   * its device-local descriptor now requires recovery, never an implicit new ledger.
   */
  it('never opens the ledger an id left in data.json names', async () => {
    const { vaultId, other } = await connect()
    await synced()
    const { stateId } = ledger() as { stateId: string }
    await service.destroy()

    // The next launch of a vault whose file still holds an id, and whose local storage has none.
    app.saveLocalStorage('abele-sync-ledger', null)
    const stored = AbeleConfig.getInstance().exportSettings() as unknown as {
      sync: Record<string, unknown>
    }
    stored.sync = { ...stored.sync, stateId, stateVaultId: vaultId }
    const written: unknown[] = []
    const loading = vi.spyOn(plugin, 'loadData').mockResolvedValue(stored)
    const saving = vi.spyOn(plugin, 'saveData').mockImplementation((data: unknown) => {
      written.push(JSON.parse(JSON.stringify(data)))
      return Promise.resolve()
    })
    try {
      await AbeleConfig.getInstance().loadSettings()
      service = SyncService.getInstance()
      start()
      await waitFor(
        'missing local descriptor to require recovery',
        () => service.status.value.state === 'error'
      )

      expect(service.status.value.lastError).toContain('Sync recovery required')
      expect(service.isConnected()).toBe(false)
      expect(ledger()).toBeNull()
      expect(await serverPaths(other)).toContain('Existing.md')
      expect(await read('Existing.md')).toBe('already here')

      // Not written back either: the next save leaves it out.
      await AbeleConfig.getInstance().saveSettings()
      expect(written.length).toBeGreaterThan(0)
      expect(JSON.stringify(written[written.length - 1])).not.toContain('stateId')
    } finally {
      loading.mockRestore()
      saving.mockRestore()
    }
  })

  it('keeps the ledger id local storage already holds over one data.json brings', async () => {
    const { vaultId } = await connect()
    await synced()
    const held = ledger()
    await service.destroy()

    const stored = AbeleConfig.getInstance().exportSettings() as unknown as {
      sync: Record<string, unknown>
    }
    stored.sync = { ...stored.sync, stateId: 'someoneelse', stateVaultId: vaultId }
    const loading = vi.spyOn(plugin, 'loadData').mockResolvedValue(stored)
    try {
      await AbeleConfig.getInstance().loadSettings()
      service = SyncService.getInstance()
      start()
      await synced()

      expect(ledger()).toEqual(held)
    } finally {
      loading.mockRestore()
    }
  })
})

/**
 * A build before this one kept the connection in `data.json`. The first launch of this one
 * moves it into local storage — but only when this vault holds a ledger for the vault the file
 * names and the keychain holds the token it names, which together say the file is this vault's
 * own and not a copy of another's.
 */
describe('SyncService — moving the connection out of data.json', () => {
  /** A device set up by the older build: its connection in the file, none in local storage. */
  async function olderDevice(): Promise<{ file: Record<string, unknown>; held: DeviceConnection }> {
    await connect()
    await synced()
    // An older build never learned what the vault is called.
    const held = { ...conn(), vaultName: '' }
    await service.destroy()
    app.saveLocalStorage(CONNECTION_KEY, null)
    service = SyncService.getInstance()
    return { file: olderDataJson(held), held }
  }

  it('moves it when this keychain holds the token, strips the file, and stays connected', async () => {
    const { file, held } = await olderDevice()

    const written = await launch(file)
    start()
    await synced()

    expect(conn()).toEqual({ ...held, migrated: true })
    expect(readConnection(app)).toEqual({ ...held, migrated: true })
    expect(written).toHaveLength(1)
    expect((written[0] as { sync: unknown }).sync).toEqual({ keySignature: null })
    expect(service.isConnected()).toBe(true)
    expect(service.log.value.join('\n')).toContain("moved this device's connection")
  })

  it('drops it when this keychain has no such token, strips the file, and is not connected', async () => {
    const { file, held } = await olderDevice()
    app.secretStorage.setSecret(held.deviceTokenId, '')

    const written = await launch(file)
    start()
    await tick()

    expect(conn()).toMatchObject({ serverUrl: '', vaultId: '', deviceTokenId: '', migrated: true })
    expect((written[0] as { sync: unknown }).sync).toEqual({ keySignature: null })
    expect(service.isConnected()).toBe(false)
    expect(service.status.value.state).toBe('disconnected')
    expect(service.log.value.join('\n')).toContain('was not adopted')
  })

  it('does nothing at the next launch, whatever the file then says', async () => {
    const { file, held } = await olderDevice()
    await launch(file)
    service.pause()
    const lines = service.log.value.length

    // The same older file arriving again — from a device still on the older build.
    const written = await launch(olderDataJson({ ...held, vaultId: 'another-vault' }))

    expect(conn()).toEqual({ ...held, paused: true, migrated: true })
    expect(written).toEqual([])
    expect(service.log.value.slice(lines).join('\n')).not.toContain('data.json')
  })

  /**
   * The first launch of this build found `data.json` unreadable — half-written, or mid-swap by
   * another sync tool. The file is restored, and the next launch must still move what it holds:
   * a move recorded as done off a file nobody could read would lose the connection for good.
   */
  it('moves nothing off an unreadable file, and moves it once the file reads', async () => {
    const { file, held } = await olderDevice()

    expect(await launch(undefined)).toEqual([])
    expect(app.loadLocalStorage(CONNECTION_KEY)).toBeNull()
    expect(conn().serverUrl).toBe('')

    const written = await launch(file)
    start()
    await synced()

    expect(conn()).toEqual({ ...held, migrated: true })
    expect((written[0] as { sync: unknown }).sync).toEqual({ keySignature: null })
    expect(service.log.value.join('\n')).toContain("moved this device's connection")
  })

  /** An iCloud vault on a phone: `data.json` not downloaded yet reads as no file at all. */
  it('moves nothing while the file is missing, and moves it once the file is there', async () => {
    const { file, held } = await olderDevice()

    await launch(null)
    expect(app.loadLocalStorage(CONNECTION_KEY)).toBeNull()

    await launch(file)
    start()
    await synced()

    expect(conn()).toEqual({ ...held, migrated: true })
    expect(service.isConnected()).toBe(true)
  })

  /** Obsidian swallows a failed local-storage write; the file is then the only copy there is. */
  it('keeps data.json as it is when the record does not stick', async () => {
    const { file } = await olderDevice()
    const saving = app.saveLocalStorage.bind(app)
    app.saveLocalStorage = (key: string, value: unknown) => {
      if (key !== CONNECTION_KEY) saving(key, value)
    }

    const written = await launch(file)

    expect(written).toEqual([])
    expect(service.log.value.join('\n')).toContain('data.json was left as it was')
    app.saveLocalStorage = saving
  })

  /**
   * Two local vaults on one machine share one IndexedDB. The second got the first one's older
   * `data.json` — a Finder copy, a synced file — but not its keychain, so it is not connected.
   */
  it('connects only the vault whose own record says so, not one handed a copied file', async () => {
    const { other } = await connect()
    await synced()
    const copied = olderDataJson(conn())
    await service.destroy()

    app = buildFakeVault([])
    secretStore = createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin)
    setSecrets(secretStore)
    service = SyncService.getInstance()
    await launch(copied)
    start()
    await tick()

    expect(service.isConnected()).toBe(false)
    expect(conn().vaultId).toBe('')
    expect(await serverPaths(other)).toContain('Existing.md')
  })
})

/**
 * The size cap is the phone's own: a desktop's "no cap" in a file the phone was handed must not
 * fill the phone with video, and a cap chosen on the phone is written nowhere a desktop reads.
 */
describe('SyncService — the size cap on a phone', () => {
  it("takes 50 MB over a desktop data.json's no cap, and keeps its own cap to itself", async () => {
    Platform.isMobile = true
    const desktop = {
      ...AbeleConfig.getInstance().exportSettings(),
      sync: {
        serverUrl: 'https://desktop.example.com',
        vaultId: 'desktop-vault',
        deviceTokenId: 'abele-sync-device-desktop',
        selective: { video: false, maxFileBytes: null },
        keySignature: null,
      },
    }
    service = SyncService.getInstance()
    await launch(desktop)
    expect(conn().selective.maxFileBytes).toBe(MOBILE_MAX_FILE_BYTES)
    // What it syncs is taken as a starting point all the same.
    expect(conn().selective.video).toBe(false)

    await connect()
    await waitFor('the first sync', async () => (await meta('scope')) !== null)
    expect(await meta('scope')).toBe(daemonScopeKey(conn().selective, null))

    const saving = vi.spyOn(plugin, 'saveData')
    await service.updateConnection({ selective: { ...conn().selective, maxFileBytes: 1024 } })
    expect(readConnection(app, true).selective.maxFileBytes).toBe(1024)
    expect(saving).not.toHaveBeenCalled()
    expect(JSON.stringify(AbeleConfig.getInstance().exportSettings())).not.toContain('maxFileBytes')
    saving.mockRestore()
  })
})

describe('SyncService — when it cannot start at all', () => {
  it('says so instead of looking like a device nobody set up', async () => {
    const { accountToken } = await server.account(EMAIL)
    const { vaultId } = await server.vault(accountToken, 'Home')

    const broken = {
      open: () => {
        throw new Error('this browser will not open a database')
      },
    } as unknown as IDBFactory
    start({ indexedDB: broken })
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Laptop')

    expect(service.status.value.state).toBe('error')
    expect(service.status.value.lastError).toContain('state database')
    expect(service.isConnected()).toBe(false)
    expect(service.log.value.join('\n')).toContain('sync could not start')
  })

  it('lets go of the ledger when the build fails half way through', async () => {
    const { accountToken } = await server.account(EMAIL)
    const { vaultId } = await server.vault(accountToken, 'Home')

    // Open succeeds and the first read of the ledger does not: everything is assigned by then.
    const reading = vi
      .spyOn(IndexedDbStateStore.prototype, 'getMeta')
      .mockRejectedValue(new Error('the ledger would not be read'))
    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Laptop')
    reading.mockRestore()

    expect(service.status.value.state).toBe('error')
    expect(service.status.value.lastError).toContain('would not be read')
    expect(service.isConnected()).toBe(false)
    expect(service.client()).toBeNull()
    // The store was let go too, so deleting the database is not blocked by a live connection.
    await service.forget()
    expect(ledgerOf().stateId).toBe('')
  })

  it('reports a failure that happens before the engine is even built', async () => {
    await connect()
    await synced()

    // A locked keychain: read while working out what the engine should be built on, which is
    // outside the build itself.
    app.secretStorage.getSecret = () => {
      throw new Error('the keychain is locked')
    }
    void service.updateConnection({ selective: { ...conn().selective, images: false } })

    await waitFor('the failure to be reported', () => service.status.value.state === 'error')
    expect(service.status.value.lastError).toContain('keychain is locked')
  })
})

/**
 * Another window of the app deleting or upgrading the ledger makes this connection close under
 * the running engine. What follows must be a stopped engine and a sentence, not every later
 * transaction failing with IndexedDB's own words and the status stuck at a raw error.
 */
describe('SyncService — a ledger closed under it', () => {
  it('stops and says why when another window takes the ledger away', async () => {
    await connect()
    await synced()

    const deleting = indexedDB.deleteDatabase(stateDatabaseName(ledgerOf().stateId))

    await waitFor('the engine to stop', () => !service.isConnected())
    expect(service.status.value.state).toBe('error')
    expect(service.status.value.lastError).toContain('another window')
    // Let through, rather than blocked by a connection the engine kept.
    await waitFor('the delete to go through', () => deleting.readyState === 'done')
  })

  it('can recover only after explicit Forget and a reviewed enrolment', async () => {
    const { vaultId, other } = await connect()
    await synced()
    const previous = ledgerOf().stateId
    const deleting = indexedDB.deleteDatabase(stateDatabaseName(previous))
    await waitFor('the lost ledger to close', () => !service.isConnected())
    await waitFor('the delete to complete', () => deleting.readyState === 'done')
    await service.syncNow()
    expect(service.status.value.lastError).toContain('Sync recovery required')
    const before = await other.state()
    await service.forget()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Recovery fixture', null)
    await synced()
    expect(ledgerOf().stateId).not.toBe(previous)
    expect(await serverPaths(other)).toContain('Existing.md')
    expect(await read('Existing.md')).toBe('already here')
    expect((await other.state()).head_seq).toBe(before.head_seq)
  })

  it('stops a running engine if WebKit reconnects to empty ledger storage', async () => {
    const { other } = await connect()
    await synced()
    const before = await other.state()
    const name = stateDatabaseName(ledgerOf().stateId)
    const replacement = new IDBFactory()
    const open = indexedDB.open.bind(indexedDB)
    const opened = vi
      .spyOn(indexedDB, 'open')
      .mockImplementation((database, version) =>
        database === name ? replacement.open(database, version) : open(database, version)
      )
    const store = (service as unknown as { runner: { store: IndexedDbStateStore } }).runner.store
    const db = (store as unknown as { db: IDBDatabase }).db
    const failed = vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
      throw new DOMException('Connection to Indexed Database server lost', 'UnknownError')
    })
    try {
      await expect(service.entryFor('Existing.md')).rejects.toThrow('Sync recovery required')
      await waitFor(
        'fatal recovery to stop the engine',
        () => !service.isConnected() && service.status.value.state === 'error'
      )
      expect(service.status.value.lastError).toContain('Sync recovery required')
      await service.syncNow()
      expect(service.isConnected()).toBe(false)
      expect(await other.state()).toEqual(before)
      expect(await read('Existing.md')).toBe('already here')
    } finally {
      failed.mockRestore()
      opened.mockRestore()
    }
  })

  it('keeps Sync now held for explicit recovery once the ledger is gone', async () => {
    const { other } = await connect()
    await synced()
    const deleting = indexedDB.deleteDatabase(stateDatabaseName(ledgerOf().stateId))
    await waitFor('the engine to stop', () => !service.isConnected())
    await waitFor('the delete to go through', () => deleting.readyState === 'done')

    const before = await other.state()
    await app.vault.create('sample-unsent.md', 'Unsent bytes survive ledger loss')
    await service.syncNow()
    await service.syncNow()
    expect(service.status.value.state).toBe('error')
    expect(service.status.value.lastError).toContain('Sync recovery required')
    expect(service.isConnected()).toBe(false)
    expect(await other.state()).toEqual(before)
    expect(await read('sample-unsent.md')).toBe('Unsent bytes survive ledger loss')
  })
})

describe('SyncService — a settings save', () => {
  it('builds another engine only when a change moved what sync runs on', async () => {
    await connect()
    await synced()
    const builds = (): number =>
      service.log.value.filter((line) => line.includes('syncing vault')).length
    const before = builds()

    // Nothing about sync moved, so this must not stop and restart the engine.
    await AbeleConfig.getInstance().saveSettings()
    // And this must, which is also what makes the assertion below deterministic.
    await service.updateConnection({ selective: { ...conn().selective, pdf: false } })

    await waitFor('the engine to be rebuilt once', () => builds() === before + 1)
    await tick()
    expect(builds()).toBe(before + 1)
  })

  /**
   * The Sync tab shows the sign-in card for `disconnected`. A rebuild that said so between the
   * old engine and the new one would swap the whole tab out under the person editing it — and a
   * switch clicked right after the cap was committed would be gone before the click landed.
   */
  it('never says disconnected while it rebuilds for a change to what it syncs', async () => {
    await connect()
    await synced()
    const seen: string[] = []
    const off = service.onStatusChange((status) => seen.push(status.state))

    // The cap committed on blur, and the switch the blur was on its way to, one after the other.
    void service.updateConnection({
      selective: { ...conn().selective, maxFileBytes: 10 * 1024 * 1024 },
    })
    await service.updateConnection({ selective: { ...conn().selective, pdf: false } })

    const scope = daemonScopeKey(conn().selective, null)
    await waitFor('the engine to run on both changes', async () => {
      if (!service.isConnected() || service.status.value.state !== 'idle') return false
      return (await meta('scope')) === scope
    })
    off()

    expect(seen.length).toBeGreaterThan(0)
    expect(seen).not.toContain('disconnected')
  })

  /** The scripts folder feeds the engine's filter, which is read once, when it is built. */
  it('builds another engine when the scripts folder moves', async () => {
    await connect()
    await synced()
    const builds = (): number =>
      service.log.value.filter((line) => line.includes('syncing vault')).length
    const before = builds()

    const config = AbeleConfig.getInstance()
    config.ai = { ...config.ai, scriptsFolder: 'Automation' }
    await config.saveSettings()

    await waitFor('the engine to be rebuilt', () => builds() === before + 1)
  })

  /**
   * The walk looks at every file in the config folder, and nothing of Abele's is in it to find:
   * its own `data.json` is excluded. A save that walked it anyway would cost a `stat` per file
   * every time any setting in the plugin was changed.
   */
  it('does not walk the config folder on a save', async () => {
    await connect()
    await synced()
    const kicked = vi.spyOn(ObsidianFileSystem.prototype, 'kick')

    await AbeleConfig.getInstance().saveSettings()
    await tick()

    expect(kicked).not.toHaveBeenCalled()
    kicked.mockRestore()
  })

  it('honours a change to the connection that lands while a settings save is in hand', async () => {
    await connect()
    await synced()
    const builds = (): number =>
      service.log.value.filter((line) => line.includes('syncing vault')).length
    const before = builds()

    // A screen narrowing the scope while a save of some other setting is being reconciled.
    // Whichever lands first, `reconcile` compares what the engine was built on and rebuilds
    // once because the scope moved.
    const off = AbeleConfig.getInstance().onSaved(() => {
      off()
      void service.updateConnection({ selective: { ...conn().selective, pdf: false } })
    })
    await AbeleConfig.getInstance().saveSettings()

    await waitFor('the narrowed scope to reach the engine', () => builds() === before + 1)
    await tick()
    expect(builds()).toBe(before + 1)
  })
})

/**
 * `data.json` arriving from another device is reloaded, not saved. The engine must be put in
 * step with it the same way, or it runs on what it was built on until some unrelated save.
 */
describe('SyncService — settings reloaded from disk', () => {
  it('puts the engine in step with a data.json that arrived', async () => {
    await connect()
    await synced()
    const builds = (): number =>
      service.log.value.filter((line) => line.includes('syncing vault')).length
    const before = builds()

    const arrived = AbeleConfig.getInstance().exportSettings()
    arrived.ai = { ...arrived.ai!, scriptsFolder: 'Automation' }
    const loading = vi.spyOn(plugin, 'loadData').mockResolvedValue(arrived)
    try {
      await AbeleConfig.getInstance().reloadSettings()
      await waitFor('the engine to be rebuilt', () => builds() === before + 1)
    } finally {
      loading.mockRestore()
    }
  })

  /**
   * Another device's `data.json` from an older build still carries that device's connection.
   * It used to replace this one's in memory, and the engine was torn down and rebuilt on it.
   * Now nothing reads it: the connection, the pause and the engine all stay as they were.
   */
  it("keeps its own connection and engine through a data.json naming another device's", async () => {
    await connect()
    await synced()
    const held = { ...conn() }
    const vault = service.client()
    const builds = (): number =>
      service.log.value.filter((line) => line.includes('syncing vault')).length
    const before = builds()

    const arrived = olderDataJson({
      ...held,
      serverUrl: 'https://elsewhere.example.com',
      vaultId: 'another-vault',
      deviceId: 'another-device',
      deviceTokenId: 'abele-sync-device-another',
      paused: true,
    })
    const loading = vi.spyOn(plugin, 'loadData').mockResolvedValue(arrived)
    try {
      await AbeleConfig.getInstance().reloadSettings()
      await tick()
    } finally {
      loading.mockRestore()
    }

    expect(conn()).toEqual(held)
    expect(readConnection(app)).toEqual(held)
    expect(service.client()).toBe(vault)
    expect(builds()).toBe(before)
    expect(service.status.value.state).not.toBe('paused')
  })
})

describe('SyncService — a plugin reload', () => {
  it('hands the next instance a clean slate, in order', async () => {
    await connect()
    await synced()
    const old = service

    // Captured before the spies replace them, so both still do the real thing.
    const order: string[] = []
    const realOpen = IndexedDbStateStore.open.bind(IndexedDbStateStore)
    const realClose = IndexedDbStateStore.prototype.close
    const opened = vi
      .spyOn(IndexedDbStateStore, 'open')
      .mockImplementation(async (factory, name) => {
        const store = await realOpen(factory, name)
        order.push('open')
        return store
      })
    const closed = vi.spyOn(IndexedDbStateStore.prototype, 'close').mockImplementation(function (
      this: IndexedDbStateStore
    ) {
      order.push('close')
      realClose.call(this)
    })

    // What `onunload` does: it cannot await, so the reload starts while this is still running.
    void old.syncNow()
    const stopping = old.destroy()

    const next = SyncService.getInstance()
    // Detached the moment `destroy` was called, so the reload cannot be handed the old one.
    expect(next).not.toBe(old)
    service = next
    next.init(app as unknown as App, plugin, {
      fetch: transport,
      WebSocket: countedSocket(),
      indexedDB,
      fallbackMs: 60_000,
      pollMs: 60_000,
    })

    await stopping
    await waitFor('the new instance to take over', () => next.isConnected())
    await synced()

    expect(old.isConnected()).toBe(false)
    // The old ledger was closed before the new one was opened, so no two engines ever held it.
    expect(order.lastIndexOf('close')).toBeLessThan(order.lastIndexOf('open'))

    opened.mockRestore()
    closed.mockRestore()
  })

  it('does not deadlock when a launch and an unload land in the same tick', async () => {
    await connect()
    await synced()
    await service.destroy()

    const next = SyncService.getInstance()
    service = next
    // No await between the two: an `onLayoutReady` and an `onunload` in one turn. The teardown
    // is queued behind the init, so an init that read `lastTeardown` from inside its own queued
    // work would be waiting for something that cannot start until it lets go.
    start()
    await next.destroy()

    expect(next.isConnected()).toBe(false)
  })
})

describe('SyncService — what this device syncs, driven from the Sync tab', () => {
  it('rescans and fetches what the old scope skipped when a change widens it', async () => {
    const { accountToken } = await server.account(EMAIL)
    const { vaultId } = await server.vault(accountToken, 'Home')
    const { deviceToken } = await server.device(accountToken, vaultId, 'scenario')
    const other = server.clientFor(deviceToken, vaultId)
    await seed(other, [await create(other, 'Archive/old.md', 'kept out at first')])

    // Narrow before the first sync, so the pull passes the folder over.
    storeConnection({
      selective: { ...readConnection(app).selective, excludedFolders: ['Archive'] },
    })
    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Laptop')
    await synced()
    expect(await app.vault.adapter.exists('Archive/old.md')).toBe(false)

    // Widened through the one road every screen takes.
    await service.updateConnection({ selective: { ...conn().selective, excludedFolders: [] } })

    await waitFor('the file the old scope skipped', () =>
      app.vault.adapter.exists('Archive/old.md')
    )
    expect(await read('Archive/old.md')).toBe('kept out at first')
    expect(
      service.log.value.some((line) =>
        line.includes('rescan: what this device syncs changed since the last sync')
      )
    ).toBe(true)
  })

  it('files the scope under the key the daemon would have computed', async () => {
    await connect()
    await synced()

    expect(await meta('scope')).toBe(daemonScopeKey(conn().selective, null))
  })

  /**
   * A locked file, an iCloud placeholder, a permissions slip: an ignore file that is there and
   * cannot be read is not an ignore file that is absent. Syncing as if it were would upload
   * the very folders it keeps off the server.
   */
  it('stops with an error when the ignore file is there and cannot be read', async () => {
    await write(IGNORE_FILE, 'Private/\n')
    await write('Private/diary.md', 'not for the server')
    const { accountToken } = await server.account(EMAIL)
    const { vaultId } = await server.vault(accountToken, 'Home')
    const { deviceToken } = await server.device(accountToken, vaultId, 'scenario')
    const other = server.clientFor(deviceToken, vaultId)
    const readBinary = app.vault.adapter.readBinary.bind(app.vault.adapter)
    app.vault.adapter.readBinary = (path: string) =>
      path === IGNORE_FILE
        ? Promise.reject(new Error('EBUSY: the file is locked'))
        : readBinary(path)

    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Laptop')
    await tick()

    expect(service.status.value.state).toBe('error')
    expect(service.status.value.lastError).toContain(IGNORE_FILE)
    expect(service.isConnected()).toBe(false)
    expect(await serverPaths(other)).not.toContain('Private/diary.md')
  })

  /** Nothing else would try again: the watcher that notices the file went with the engine. */
  it('tries to start again on Sync now once the ignore file reads', async () => {
    await write(IGNORE_FILE, 'Private/\n')
    await write('Private/diary.md', 'not for the server')
    await write('Public.md', 'for the server')
    const { accountToken } = await server.account(EMAIL)
    const { vaultId } = await server.vault(accountToken, 'Home')
    const { deviceToken } = await server.device(accountToken, vaultId, 'scenario')
    const other = server.clientFor(deviceToken, vaultId)
    const readBinary = app.vault.adapter.readBinary.bind(app.vault.adapter)
    let locked = true
    app.vault.adapter.readBinary = (path: string) =>
      locked && path === IGNORE_FILE
        ? Promise.reject(new Error('EBUSY: the file is locked'))
        : readBinary(path)

    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Laptop')
    await tick()
    expect(service.status.value.state).toBe('error')

    locked = false
    await service.syncNow()
    await synced()

    expect(service.isConnected()).toBe(true)
    const paths = await serverPaths(other)
    expect(paths).toContain('Public.md')
    expect(paths).not.toContain('Private/diary.md')
  })

  it('does nothing on Sync now on a device nobody set up', async () => {
    start()
    await tick()
    await service.syncNow()
    await tick()

    expect(service.status.value.state).toBe('disconnected')
    expect(service.log.value.join('\n')).toContain('not connected')
  })

  it('reads the ignore file again when it is edited in the vault', async () => {
    const { other } = await connect({ pollMs: 20 })
    await synced()

    await write(IGNORE_FILE, 'Drafts/\n')
    // The line is written after the engine has been rebuilt on the new rules, so waiting for
    // it is waiting for the rules to be the ones the next sync runs on.
    await waitFor('the new rules to be in force', () =>
      service.log.value.some((line) => line.includes(`${IGNORE_FILE}: 1 rule(s) in force`))
    )
    expect(service.log.value.some((line) => line.includes('the vault ignore file changed'))).toBe(
      true
    )

    await write('Drafts/note.md', 'not for the server')
    await service.syncNow()
    expect(await serverPaths(other)).not.toContain('Drafts/note.md')
  })
})

describe('SyncService — runAfterSync at startup', () => {
  it('holds a callback queued before the first sync of a launch', async () => {
    await connect()
    await synced()

    // The next launch: the settings already name a vault, so this device is about to pull.
    await service.destroy()
    service = SyncService.getInstance()
    start()

    const ran = vi.fn()
    runAfterSync(app as unknown as App, ran)
    // `disconnected` here would have read as "nothing in flight" and let the callback run over
    // a vault the first pull is about to rewrite.
    expect(service.status.value.state).toBe('syncing')
    expect(ran).not.toHaveBeenCalled()

    await synced()
    expect(ran).toHaveBeenCalledOnce()
  })
})

/**
 * An `abele://` link can open the app cold, and its handler asks `runAfterSync` before the
 * layout is ready and `init` has run. `onload` announces the pull as soon as the settings and
 * the keychain are read, so the link waits for it too.
 */
describe('SyncService — runAfterSync before init', () => {
  it('holds a callback asked for between onload and the layout being ready', async () => {
    await connect()
    await synced()
    await service.destroy()
    service = SyncService.getInstance()

    // What `onload` does: the connection is read, then announced.
    await service.openConnection(app as unknown as App)
    service.announce()
    const ran = vi.fn()
    runAfterSync(app as unknown as App, ran)
    expect(service.status.value.state).toBe('syncing')
    expect(ran).not.toHaveBeenCalled()

    start()
    await synced()
    expect(ran).toHaveBeenCalledOnce()
  })

  it('holds nothing on a device nobody set up', () => {
    service.announce()
    const ran = vi.fn()
    runAfterSync(app as unknown as App, ran)

    expect(service.status.value.state).toBe('disconnected')
    expect(ran).toHaveBeenCalledOnce()
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
    // No socket tells a phone, and its clock is a minute away.
    expect(await app.vault.adapter.exists('Phone.md')).toBe(false)

    domEvents[0]()
    await waitFor('the note to arrive', () => app.vault.adapter.exists('Phone.md'))
    expect(await read('Phone.md')).toBe('read on the train')
    expect(socketsOpened).toBe(0)
  })

  it('sends a note made on the phone while the app stays in front', async () => {
    Platform.isMobile = true
    const { other } = await connect()
    await synced()

    await write('Phone/Created on phone.md', 'written on the bus')
    app.emit('vault', 'create', app.vault.getFileByPath('Phone/Created on phone.md'))

    await waitFor('the note to reach the server', async () =>
      (await serverPaths(other)).includes('Phone/Created on phone.md')
    )
    expect(socketsOpened).toBe(0)
    expect(service.log.value.join('\n')).toContain('keeps no connection open')
  })

  it('asks the server on a clock while the app is in front', async () => {
    Platform.isMobile = true
    const { other } = await connect({ fallbackMs: 200 })
    await synced()

    await seed(other, [await create(other, 'Laptop.md', 'written at the desk')])
    await waitFor('the note to arrive without the app leaving the front', () =>
      app.vault.adapter.exists('Laptop.md')
    )
    expect(socketsOpened).toBe(0)
  })

  it('sends what is unsent as the app leaves the front', async () => {
    Platform.isMobile = true
    const { other } = await connect()
    await synced()

    // Written behind the vault's back, so only a sync that scans can find it.
    await write('Locked away.md', 'the last thing before the pocket')
    const doc = document as unknown as { visibilityState: string }
    doc.visibilityState = 'hidden'
    try {
      domEvents[0]()
      await waitFor('the note to reach the server', async () =>
        (await serverPaths(other)).includes('Locked away.md')
      )
    } finally {
      doc.visibilityState = 'visible'
    }
  })

  it('opens a socket on a desktop, which is what the phone is spared', async () => {
    await connect()
    await synced()
    expect(socketsOpened).toBeGreaterThan(0)
  })
})
