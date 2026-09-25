// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Platform, type App } from 'obsidian'
import type { SelectiveSettings, VaultClient } from '@abele/sync-core'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService, type SyncServiceDeps } from '@/sync/SyncService'
import { IndexedDbStateStore, stateDatabaseName } from '@/sync/IndexedDbStateStore'
import { runAfterSync } from '@/helpers/runAfterSync'
import { setSecrets, type SecretStore } from '@/secrets/SecretStore'
import { createPluginSecrets } from '@/secrets/host'
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
/** The plugin's secret store, on this device's keychain, as `onload` installs it. */
let secretStore: SecretStore
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

const settings = () => AbeleConfig.getInstance().sync

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

  /**
   * The synced secret store travels to every device the settings reach. A token that went with
   * it would let a phone sync as this laptop, and the server would see one device where there
   * are two: each device enrols and keeps its own.
   */
  it('keeps the device token out of the synced secret store, open or opened later', async () => {
    await secretStore.enable('passphrase', { iterations: 1000 })
    await connect()
    await synced()
    const tokenId = settings().deviceTokenId

    expect(app.secretStorage.getSecret(tokenId)).toMatch(/^absd_/)
    expect(secretStore.contents()!.map((c) => c.id)).not.toContain(tokenId)

    // Made afresh with the token already in the keychain: it is not one of the ids moved in.
    await secretStore.disable()
    await secretStore.enable('passphrase', { iterations: 1000 })
    expect(secretStore.contents()!.map((c) => c.id)).not.toContain(tokenId)
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

/**
 * Obsidian never indexes a path with a dot-segment, so a hidden file this device pulled would
 * be missing from the very next scan — and a missing file with a ledger entry is a delete. A
 * daemon on a git or Syncthing folder sends exactly such files, and would get them deleted.
 */
describe('SyncService — hidden paths', () => {
  const HIDDEN = ['.gitignore', '.git/HEAD', '.DS_Store', '.stfolder', '.trash/x.md']

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
    const tokenId = settings().deviceTokenId

    await service.disconnect()

    expect(app.secretStorage.getSecret(tokenId)).toBe('')
    expect(settings().serverUrl).toBe('')
    expect(settings().vaultId).toBe('')
    // The id is a keychain name, not a credential: keeping it is what stops a reconnect
    // leaving an entry behind every time.
    expect(settings().deviceTokenId).toBe(tokenId)
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

  it('reuses the one keychain entry when the same device connects again', async () => {
    const { vaultId } = await connect()
    await synced()
    const tokenId = settings().deviceTokenId
    const stateId = ledgerOf().stateId

    await service.disconnect()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Laptop')
    await synced()

    expect(settings().deviceTokenId).toBe(tokenId)
    expect(app.secretStorage.getSecret(tokenId)).toMatch(/^absd_/)
    // The same vault, so the same ledger: reconnecting costs a scan, not a download.
    expect(ledgerOf().stateId).toBe(stateId)
  })

  it('forget drops the ledger and the keychain name as well', async () => {
    await connect()
    await synced()
    const tokenId = settings().deviceTokenId
    const stateId = ledgerOf().stateId

    await service.forget()

    expect(ledgerOf().stateId).toBe('')
    expect(settings().deviceTokenId).toBe('')
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
 * The keychain id comes out of the settings, which an agent's `write_settings` or another
 * device's `data.json` can write. Pointed at a provider's key, it would send that key to the
 * server as a bearer token and delete it on Disconnect. Only an id this plugin mints is read.
 */
describe('SyncService — a keychain id it did not mint', () => {
  it('neither sends nor deletes a secret the settings name by another id', async () => {
    await connect()
    await synced()
    app.secretStorage.setSecret('abele-provider-x', 'sk-provider')

    settings().deviceTokenId = 'abele-provider-x'
    await AbeleConfig.getInstance().saveSettings()
    await waitFor('the engine to stop', () => !service.isConnected())
    bearers = []
    await service.syncNow()
    await service.disconnect()
    await service.forget()

    expect(bearers.join('\n')).not.toContain('sk-provider')
    expect(app.secretStorage.getSecret('abele-provider-x')).toBe('sk-provider')
  })

  it('says nothing is connected at a launch whose settings name such an id', async () => {
    const { vaultId } = await connect()
    await synced()
    await service.destroy()
    app.secretStorage.setSecret('abele-provider-x', 'sk-provider')
    settings().deviceTokenId = 'abele-provider-x'
    settings().vaultId = vaultId
    bearers = []

    service = SyncService.getInstance()
    start()
    await tick()

    expect(service.isConnected()).toBe(false)
    expect(bearers.join('\n')).not.toContain('sk-provider')
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
    secretStore = createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin)
    setSecrets(secretStore)
  }

  it('opens a fresh ledger in a vault a transfer set up on the same machine', async () => {
    const { other } = await connect()
    await synced()
    const tokenId = settings().deviceTokenId
    const token = app.secretStorage.getSecret(tokenId)
    // The sync block exactly as the transfer reads it off this device.
    const block: unknown = JSON.parse(
      JSON.stringify(AbeleConfig.getInstance().exportSettings().sync)
    )
    await service.destroy()

    secondVault(tokenId, token)
    AbeleConfig.getInstance().applySettings({ sync: block } as never)
    service = SyncService.getInstance()
    start()
    await synced()

    // A first run on an empty ledger walks the manifest and takes the vault down.
    expect(await read('Existing.md')).toBe('already here')
    expect(await serverPaths(other)).toContain('Existing.md')
  })

  it('opens a fresh ledger in a vault whose data.json was copied from another', async () => {
    const { other } = await connect()
    await synced()
    const tokenId = settings().deviceTokenId
    const token = app.secretStorage.getSecret(tokenId)
    const copied: unknown = JSON.parse(JSON.stringify(AbeleConfig.getInstance().exportSettings()))
    await service.destroy()

    secondVault(tokenId, token)
    const loading = vi.spyOn(plugin, 'loadData').mockResolvedValue(copied)
    await AbeleConfig.getInstance().loadSettings()
    loading.mockRestore()
    service = SyncService.getInstance()
    start()
    await synced()

    expect(await read('Existing.md')).toBe('already here')
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

  it('moves the ledger id an older data.json holds into local storage, once', async () => {
    const { vaultId } = await connect()
    await synced()
    const { stateId } = ledger() as { stateId: string }
    await service.destroy()

    // The next launch of a vault an older version of the plugin wrote.
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
      await synced()

      expect(ledger()).toEqual({ stateId, vaultId })
      // The file is written again without it, so it can never travel from here.
      expect(written.length).toBeGreaterThan(0)
      expect(JSON.stringify(written[written.length - 1])).not.toContain(stateId)
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
    settings().selective.images = false
    await AbeleConfig.getInstance().saveSettings()

    await waitFor('the failure to be reported', () => service.status.value.state === 'error')
    expect(service.status.value.lastError).toContain('keychain is locked')
  })
})

describe('SyncService — a settings save', () => {
  it('builds another engine only when the save moved what sync runs on', async () => {
    await connect()
    await synced()
    const builds = (): number =>
      service.log.value.filter((line) => line.includes('syncing vault')).length
    const before = builds()

    // Nothing about sync moved, so this must not stop and restart the engine.
    await AbeleConfig.getInstance().saveSettings()
    // And this must, which is also what makes the assertion below deterministic.
    settings().selective.pdf = false
    await AbeleConfig.getInstance().saveSettings()

    await waitFor('the engine to be rebuilt once', () => builds() === before + 1)
    await tick()
    expect(builds()).toBe(before + 1)
  })

  it('honours a save that lands while the service is saving one of its own', async () => {
    await connect()
    await synced()
    const builds = (): number =>
      service.log.value.filter((line) => line.includes('syncing vault')).length
    const before = builds()

    // A screen widening the scope while the service is writing down a pause of its own. There
    // is no filter on whose save this was — whether it lands inside the service's own save or
    // after it, `reconcile` compares what the engine was built on and rebuilds because the
    // scope moved.
    const off = AbeleConfig.getInstance().onSaved(() => {
      off()
      settings().selective.pdf = false
      void AbeleConfig.getInstance().saveSettings()
    })
    service.pause()

    await waitFor('the widened scope to reach the engine', () => builds() === before + 1)
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

    const arrived = AbeleConfig.getInstance().exportSettings()
    arrived.sync = { ...arrived.sync!, paused: true }
    const loading = vi.spyOn(plugin, 'loadData').mockResolvedValue(arrived)
    try {
      await AbeleConfig.getInstance().reloadSettings()
      await waitFor('the engine to pause', () => service.status.value.state === 'paused')
    } finally {
      loading.mockRestore()
    }
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

describe('SyncService — what this device syncs, driven from the settings', () => {
  it('rescans and fetches what the old scope skipped when a settings save widens it', async () => {
    const { accountToken } = await server.account(EMAIL)
    const { vaultId } = await server.vault(accountToken, 'Home')
    const { deviceToken } = await server.device(accountToken, vaultId, 'scenario')
    const other = server.clientFor(deviceToken, vaultId)
    await seed(other, [await create(other, 'Archive/old.md', 'kept out at first')])

    // Narrow before the first sync, so the pull passes the folder over.
    settings().selective.excludedFolders = ['Archive']
    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Laptop')
    await synced()
    expect(await app.vault.adapter.exists('Archive/old.md')).toBe(false)

    // Widened through the one road every screen takes: a settings save.
    settings().selective.excludedFolders = []
    await AbeleConfig.getInstance().saveSettings()

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

    expect(await meta('scope')).toBe(daemonScopeKey(settings().selective, null))
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
      path === IGNORE_FILE ? Promise.reject(new Error('EBUSY: the file is locked')) : readBinary(path)

    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Laptop')
    await tick()

    expect(service.status.value.state).toBe('error')
    expect(service.status.value.lastError).toContain(IGNORE_FILE)
    expect(service.isConnected()).toBe(false)
    expect(await serverPaths(other)).not.toContain('Private/diary.md')
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
