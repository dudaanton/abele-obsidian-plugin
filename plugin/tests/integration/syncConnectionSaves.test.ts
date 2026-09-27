// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Notice, Platform, type App } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService } from '@/sync/SyncService'
import { CONNECTION_KEY, readConnection } from '@/sync/connection'
import { readLedgerId } from '@/sync/ledgerId'
import { setSecrets } from '@/secrets/SecretStore'
import { createPluginSecrets } from '@/secrets/host'
import type AbelePlugin from '@/main'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'
import { syncServer, type SyncServer } from '../helpers/syncServer'

/**
 * A connection record the vault's local storage would not keep (pi review #6).
 *
 * A phone whose local storage refuses a write would otherwise be told it was enrolled, or paused,
 * for as long as the app runs, and find something else at the next start: a live token nobody
 * syncs with, or a pause that undid itself. Every write is read back; one that did not take is
 * said, and what the screen shows stays what is stored.
 */

const EMAIL = 'device@test.io'
const PATIENCE_MS = 10_000

let server: SyncServer
let app: FakeApp
let service: SyncService
let indexedDB: IDBFactory
/** While set, local storage takes no write to the connection record, silently. */
let refusing = false

const plugin = {
  manifest: { id: 'abele', dir: '.obsidian/plugins/abele' },
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

async function waitFor(what: string, check: () => boolean): Promise<void> {
  const until = Date.now() + PATIENCE_MS
  while (Date.now() < until) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`gave up waiting for ${what}; ${JSON.stringify(service.status.value)}`)
}

beforeEach(async () => {
  server = await syncServer()
  indexedDB = new IDBFactory()
  refusing = false
  Notice.shown.length = 0
  Platform.isMobile = false
  AbeleConfig.getInstance().init(plugin)
  AbeleConfig.getInstance().applySettings(undefined)
  app = buildFakeVault([{ path: 'Note.md', content: 'a note', mtime: 1000, ctime: 1000 }])
  const save = app.saveLocalStorage.bind(app)
  app.saveLocalStorage = (key: string, value: unknown) => {
    if (refusing && key === CONNECTION_KEY) return
    save(key, value)
  }
  setSecrets(createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin))
  service = SyncService.getInstance()
  service.init(app as unknown as App, plugin, {
    fetch: (input, init) => server.fetch(input, init),
    WebSocket: server.WebSocket,
    indexedDB,
    fallbackMs: 60_000,
    pollMs: 60_000,
  })
})

afterEach(async () => {
  await service.destroy()
  await server.close()
  setSecrets(null)
})

async function enrol(): Promise<string> {
  const { accountToken } = await server.account(EMAIL)
  const { vaultId } = await server.vault(accountToken, 'Home')
  await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
  await service.chooseVault(vaultId, 'Laptop')
  return vaultId
}

describe('a connection local storage would not keep', () => {
  it('is not an enrolment: nothing syncs, and the ledger is what it was', async () => {
    const ledger = readLedgerId(app)
    refusing = true

    await expect(enrol()).rejects.toThrow(/could not save/)

    expect(service.connection.value.vaultId).toBe('')
    expect(readConnection(app).vaultId).toBe('')
    expect(readLedgerId(app)).toEqual(ledger)
    expect(service.status.value.state).not.toBe('syncing')
    expect(service.status.value.state).not.toBe('idle')
  })

  it('is not a pause: the screen goes on saying it syncs, and says why', async () => {
    await enrol()
    await waitFor('the first sync', () => service.status.value.state === 'idle')
    refusing = true

    service.pause()

    expect(service.connection.value.paused).toBe(false)
    expect(readConnection(app).paused).toBe(false)
    expect(service.status.value.state).not.toBe('paused')
    expect(Notice.shown.some((text) => /could not save/.test(text))).toBe(true)
    expect(service.log.value.join('\n')).toMatch(/could not save/)
  })

  it('is not a disconnect that the screen believes and the next start does not', async () => {
    const vaultId = await enrol()
    await waitFor('the first sync', () => service.status.value.state === 'idle')
    refusing = true

    await expect(service.disconnect()).rejects.toThrow(/could not save/)

    expect(service.connection.value.vaultId).toBe(vaultId)
    expect(readConnection(app).vaultId).toBe(vaultId)
  })
})
