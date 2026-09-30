// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Notice, Platform, type App } from 'obsidian'
import type { VaultClient } from '@abele/sync-core'
import type { JoinPrefer } from '@abele/sync-protocol'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService, type SyncServiceDeps } from '@/sync/SyncService'
import { readConnection, type DeviceConnection } from '@/sync/connection'
import { setSecrets } from '@/secrets/SecretStore'
import { createPluginSecrets } from '@/secrets/host'
import type { SharedSelective } from '@/transfer/connection'
import type AbelePlugin from '@/main'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'
import { syncServer, type SyncServer } from '../helpers/syncServer'
import { create, seed, shaOf } from '../../../../abele-sync/packages/core/tests/helpers/seed.js'

/**
 * Joining a vault that has files, from a vault that has files too (phase 3b, decision 7).
 *
 * The person is asked which side wins where both hold a file at one path with other bytes, and
 * the answer is carried to the engine until the join is done. Every scenario starts from the
 * same two sides — one note and one picture on both with other bytes, and a file only on each —
 * and checks what each answer leaves on the disk and on the server, and that the side that lost
 * is in the file's history. A real server and engine run in this process, as in
 * `syncService.test.ts`; only the transport, the socket and the IndexedDB are the test's.
 */

const EMAIL = 'device@test.io'
const PATIENCE_MS = 10_000

let server: SyncServer
let app: FakeApp
let service: SyncService
let indexedDB: IDBFactory
let accountToken: string
let vaultId: string
/** The scenario's own device on the vault, for seeding it and reading what it holds. */
let other: VaultClient
/** Set by a test to fail every commit the way a network cut mid-sync does. */
let commitsFail = false

const plugin = {
  manifest: { id: 'abele' },
  registerDomEvent: () => undefined,
  loadData: () => Promise.resolve({}),
  saveData: () => Promise.resolve(),
  syncAiFeatures: () => undefined,
  onExternalSettingsChange: () => Promise.resolve(),
} as unknown as AbelePlugin

beforeAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>
  globals.window ??= globalThis
  globals.document ??= { visibilityState: 'visible' }
})

/** What this vault holds before it joins: its copy of the two files the server has too. */
const HERE = [
  { path: 'Both.md', content: 'the text written here', mtime: 2000, ctime: 1000 },
  // Older than the server's picture: under "merge both" the newer one wins.
  { path: 'Photo.png', content: 'pixels from here', mtime: 1000, ctime: 1000 },
  { path: 'Only here.md', content: 'made here', mtime: 1000, ctime: 1000 },
]

beforeEach(async () => {
  server = await syncServer()
  commitsFail = false
  Platform.isMobile = false
  AbeleConfig.getInstance().init(plugin)
  AbeleConfig.getInstance().applySettings(undefined)
  app = buildFakeVault(HERE)
  indexedDB = new IDBFactory()
  setSecrets(createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin))
  Notice.shown.length = 0
  ;({ accountToken } = await server.account(EMAIL))
  ;({ vaultId } = await server.vault(accountToken, 'Home'))
  const { deviceToken } = await server.device(accountToken, vaultId, 'Laptop')
  other = server.clientFor(deviceToken, vaultId)
  await seed(other, [
    await create(other, 'Both.md', 'the text on the server', 1500),
    await create(other, 'Photo.png', 'pixels on the server', 5000),
    await create(other, 'Only there.md', 'made there'),
  ])
  service = SyncService.getInstance()
})

afterEach(async () => {
  await service.destroy()
  await server.close()
  setSecrets(null)
})

const transport: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (commitsFail && url.endsWith('/commit')) {
    return Promise.reject(new Error('the network is gone'))
  }
  return server.fetch(input, init)
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

/** The next launch of the plugin, on the same device. */
async function relaunch(): Promise<void> {
  await service.destroy()
  service = SyncService.getInstance()
  start()
}

const conn = (): DeviceConnection => service.connection.value

async function waitFor(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const until = Date.now() + PATIENCE_MS
  while (Date.now() < until) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`gave up waiting for ${what}; the status was ${service.status.value.state}`)
}

/** Settled: a sync got through, and the join it was built with is done. */
const joined = (): Promise<void> =>
  waitFor(
    'the join to finish',
    () =>
      service.status.value.state === 'idle' &&
      service.status.value.lastSyncAt !== null &&
      conn().join === null
  )

const read = async (path: string): Promise<string> =>
  new TextDecoder().decode(await app.vault.adapter.readBinary(path))

/** The server's head of a path, as text. */
async function head(path: string): Promise<string> {
  const item = (await other.manifest(null)).items.find((held) => held.path === path)
  if (item === undefined) throw new Error(`the server holds no ${path}`)
  return new TextDecoder().decode(await other.versionBytes(item.file_id, item.version_id))
}

/** Whether a path's history on the server holds these bytes as some version. */
async function inHistory(path: string, text: string): Promise<boolean> {
  const item = (await other.manifest(null)).items.find((held) => held.path === path)
  if (item === undefined) return false
  const sha = await shaOf(text)
  return (await other.versions(item.file_id)).some((version) => version.sha === sha)
}

async function join(prefer: JoinPrefer | null): Promise<void> {
  start()
  await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
  await service.chooseVault(vaultId, 'Desktop', prefer)
  await joined()
}

describe('joining with files on both sides', () => {
  it('sends no deletes when finishing the join rebuilds the engine before pulled notes are indexed', async () => {
    const files = app.vault.getFiles.bind(app.vault)
    app.vault.getFiles = () => files().filter((file) => file.path !== 'Only there.md')
    await join('theirs')
    expect(conn().join).toBeNull()
    await waitFor(
      'the post-join engine to be built',
      () => service.log.value.filter((line) => line.includes('syncing vault ')).length >= 2
    )
    expect(
      service.log.value.filter((line) => line.includes('syncing vault ')).length
    ).toBeGreaterThanOrEqual(2)
    // The join's reconciliation has built another filesystem on the same ledger. Its scan
    // must verify the missing index entry on disk, not send it as a local delete.
    await service.syncNow()
    await service.syncNow()
    expect(await read('Only there.md')).toBe('made there')
    expect(await head('Only there.md')).toBe('made there')
    expect(await other.trash()).toEqual([])
  })

  it('asks which side wins, counting both sides, and enrols nothing by asking', async () => {
    start()
    const [vault] = await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    const before = await server.clientOn(accountToken).listDevices()

    const question = await service.joinQuestion(vault)

    expect(question).toEqual({
      kind: 'choose',
      vaultName: 'Home',
      here: { files: 3, settings: 0 },
      there: { files: 3, settings: 0 },
    })
    expect(await server.clientOn(accountToken).listDevices()).toEqual(before)
    expect(conn().vaultId).toBe('')
  })

  it('keeps the server\'s copy on "the server wins", with this device\'s in history', async () => {
    await join('theirs')

    expect(await read('Both.md')).toBe('the text on the server')
    expect(await read('Photo.png')).toBe('pixels on the server')
    expect(await head('Both.md')).toBe('the text on the server')
    expect(await inHistory('Both.md', 'the text written here')).toBe(true)
    expect(await inHistory('Photo.png', 'pixels from here')).toBe(true)
    // Files only one side had go the other way whatever the answer.
    expect(await read('Only there.md')).toBe('made there')
    expect(await head('Only here.md')).toBe('made here')
  })

  it('makes this device\'s copy the head on "this device wins", whatever its age', async () => {
    await join('mine')

    expect(await head('Both.md')).toBe('the text written here')
    // Older than the server's, and kept all the same.
    expect(await head('Photo.png')).toBe('pixels from here')
    expect(await read('Photo.png')).toBe('pixels from here')
    expect(await inHistory('Both.md', 'the text on the server')).toBe(true)
    expect(await inHistory('Photo.png', 'pixels on the server')).toBe(true)
    expect(await read('Only there.md')).toBe('made there')
  })

  it('keeps both texts of a note on "merge both", and the newer of anything else', async () => {
    await join(null)

    const merged = await read('Both.md')
    expect(merged).toContain('the text on the server')
    expect(merged).toContain('the text written here')
    expect(await read('Photo.png')).toBe('pixels on the server')
    expect(await inHistory('Photo.png', 'pixels from here')).toBe(true)
  })

  it('forgets the choice once the join is done, and says so', async () => {
    await join('theirs')

    expect(conn().join).toBeNull()
    expect(readConnection(app).join).toBeNull()
    expect(Notice.shown.some((text) => text.includes('Version history'))).toBe(true)
  })

  it('finishes a join cut off half way the way it was asked, after a restart', async () => {
    commitsFail = true
    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Desktop', 'theirs')
    await waitFor('the first sync to fail', () => service.status.value.lastError !== null)

    // Nothing here was written over before the server had this device's copy.
    expect(await read('Both.md')).toBe('the text written here')
    expect(readConnection(app).join).toEqual({ vaultId, prefer: 'theirs', ask: false })

    commitsFail = false
    await relaunch()
    await joined()

    expect(await read('Both.md')).toBe('the text on the server')
    expect(await inHistory('Both.md', 'the text written here')).toBe(true)
    expect(readConnection(app).join).toBeNull()
  })

  /**
   * The walk of a join with no file on both sides holds nothing, so the cursor moves past 0
   * before the push. A push cut off there leaves every later run starting above 0, and none of
   * them walks the vault again: a join forgotten only by a run that walked would never be.
   */
  it('forgets the choice after a join whose push was cut off after a walk that held nothing', async () => {
    await app.vault.adapter.remove('Both.md')
    await app.vault.adapter.remove('Photo.png')
    commitsFail = true
    start()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(vaultId, 'Desktop', 'mine')
    await waitFor('the first sync to fail', () => service.status.value.lastError !== null)

    commitsFail = false
    await relaunch()
    await joined()

    expect(readConnection(app).join).toBeNull()
    expect(await head('Only here.md')).toBe('made here')
  })

  it('asks nothing of a vault this device already synced, on a reconnect', async () => {
    await join(null)
    await service.disconnect()
    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    const [vault] = await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)

    expect((await service.joinQuestion(vault)).kind).toBe('reconnect')
  })
})

describe('a transfer onto a vault with files', () => {
  const selective = (): SharedSelective => {
    const { maxFileBytes: _cap, ...shared } = readConnection(app).selective
    return shared
  }

  async function receive(): Promise<void> {
    const { deviceToken } = await server.device(accountToken, vaultId, 'Sender')
    const minted = await server.clientOn(deviceToken).enrolSibling('Desktop', 'desktop')
    start()
    await service.adoptTransferred(
      {
        serverUrl: server.BASE_URL,
        vaultId,
        vaultName: 'Home',
        deviceId: minted.device_id,
        deviceName: 'Desktop',
      },
      minted.device_token,
      selective()
    )
  }

  it('asks nothing when this device already synced that vault to the end, and syncs', async () => {
    await join(null)
    await service.disconnect()
    const { deviceToken } = await server.device(accountToken, vaultId, 'Sender')
    const minted = await server.clientOn(deviceToken).enrolSibling('Desktop', 'desktop')

    await service.adoptTransferred(
      {
        serverUrl: server.BASE_URL,
        vaultId,
        vaultName: 'Home',
        deviceId: minted.device_id,
        deviceName: 'Desktop',
      },
      minted.device_token,
      selective()
    )

    expect(conn().join).toBeNull()
    await waitFor('the sync to run', () => service.isConnected())
    expect(service.status.value.state).not.toBe('joining')
  })

  it('builds no engine until the question is answered', async () => {
    await receive()

    expect(conn().join).toEqual({ vaultId, prefer: null, ask: true })
    expect(service.isConnected()).toBe(false)
    expect(service.status.value.state).toBe('joining')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await app.vault.adapter.exists('Only there.md')).toBe(false)
    expect(await read('Both.md')).toBe('the text written here')
  })

  it('stays waiting across a restart', async () => {
    await receive()

    Notice.shown.length = 0
    await relaunch()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(service.status.value.state).toBe('joining')
    expect(service.isConnected()).toBe(false)
    // Said once as the plugin starts, since nothing else on screen asks.
    expect(Notice.shown.filter((text) => text.includes('Sync tab'))).toHaveLength(1)
  })

  it('asks the question on its own token, counting the server', async () => {
    await receive()

    expect(await service.joinQuestion()).toEqual({
      kind: 'choose',
      vaultName: 'Home',
      here: { files: 3, settings: 0 },
      there: { files: 3, settings: 0 },
    })
  })

  it('builds the engine once answered, and keeps the side it was told', async () => {
    await receive()

    await service.answerJoin('theirs')
    await joined()

    expect(await read('Both.md')).toBe('the text on the server')
    expect(await inHistory('Both.md', 'the text written here')).toBe(true)
    expect(await read('Only there.md')).toBe('made there')
  })

  it('takes no answer when nothing is asked', async () => {
    start()

    await expect(service.answerJoin('mine')).rejects.toThrow('no join waiting')
  })
})
