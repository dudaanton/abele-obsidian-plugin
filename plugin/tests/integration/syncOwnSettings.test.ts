// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Notice, Platform, type App } from 'obsidian'
import type { VaultClient } from '@abele/sync-core'
import type { JoinPrefer } from '@abele/sync-protocol'
import { IndexedDbStateStore, stateDatabaseName } from '@/sync/IndexedDbStateStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService } from '@/sync/SyncService'
import { SecretStore, setSecrets, type Keychain } from '@/secrets/SecretStore'
import type { SecretStoreFile } from '@/secrets/storeFile'
import type AbelePlugin from '@/main'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'
import { syncServer, type SyncServer } from '../helpers/syncServer'
import { blob, seed } from '../../../../abele-sync/packages/core/tests/helpers/seed.js'

/**
 * Abele's own `data.json` syncs between two devices, and settles.
 *
 * Two devices, each a vault of its own with its own settings, secret store, ledger and sync
 * service, on one real server in this process. The risk this file is about is the file passing
 * back and forth for ever: it syncs by newest mtime, a reload may write, and a device that wrote
 * the file back on reading the other's would start the next round itself. So every scenario
 * ends the same way — two more cycles on each device, and both push nothing.
 *
 * The plugin's `onExternalSettingsChange` is stood in for by the same steps `main.ts` takes:
 * reload the settings, and only when that reloaded anything, reopen the secret store. Obsidian's
 * own call for the same write (see `AbeleConfig.reloadSettings`) is made by hand where a
 * scenario needs it.
 */

const EMAIL = 'device@test.io'
const PATIENCE_MS = 10_000
const DATA = '.obsidian/plugins/abele/data.json'
const FAST = { iterations: 1000 }
const PROVIDER_KEY = 'abele-provider-x'

let server: SyncServer
let accountToken: string
let vaultId: string
/** The scenario's own device, for seeding and for reading history. */
let other: VaultClient
let devices: Device[] = []

beforeAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>
  globals.window ??= globalThis
  globals.document ??= { visibilityState: 'visible' }
})

/** Obsidian's keychain, per device. */
class FakeKeychain implements Keychain {
  readonly values = new Map<string, string>()
  getSecret(id: string): string | null {
    return this.values.get(id) ?? null
  }
  setSecret(id: string, value: string): void {
    this.values.set(id, value)
  }
  deleteSecret(id: string): boolean {
    return this.values.delete(id)
  }
}

/** Device tokens: one keychain the global secret store reads, each device under its own id. */
const tokens = new FakeKeychain()

interface Device {
  name: string
  app: FakeApp
  config: AbeleConfig
  store: SecretStore
  keychain: FakeKeychain
  service: SyncService
  /** `onExternalSettingsChange` calls, and the ones that reloaded anything. */
  calls: number
  reloads: number
  /** Writes of `data.json` by the plugin itself. */
  saves: number
  /** The plugin's `onExternalSettingsChange`, for making Obsidian's own call by hand. */
  tell: () => Promise<void>
  /** Where its ledger lives. */
  idb: IDBFactory
}

const encoder = new TextEncoder()

/** The same value with every object's keys in the reverse order. */
function reordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reordered)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, inner]) => [key, reordered(inner)])
  )
}

/**
 * A device on the vault, with `settings` already in its `data.json` if given. `reversed` has it write its settings with every key in the reverse
 * order — the same settings in another serialisation, as another build or a hand edit makes.
 */
async function device(
  name: string,
  {
    reversed = false,
    settings,
    prefer,
    beforeCommit,
    beforeReload,
  }: {
    reversed?: boolean
    settings?: Record<string, unknown>
    prefer?: JoinPrefer | null
    /** Run before each commit this device sends reaches the server, with the request's body. */
    beforeCommit?: (app: FakeApp, body: string) => Promise<void>
    /** Run when the sync tells the plugin its settings file changed, before it is reloaded. */
    beforeReload?: () => Promise<void>
  } = {}
): Promise<Device> {
  const app = buildFakeVault([
    { path: 'Existing.md', content: `made on ${name}`, mtime: 1000, ctime: 1000 },
    { path: '.obsidian/plugins/abele/manifest.json', content: '{}', mtime: 1000, ctime: 1000 },
    // A settings file of its own from before it ever synced, saved just now.
    ...(settings === undefined
      ? []
      : [{ path: DATA, content: JSON.stringify(settings), mtime: Date.now(), ctime: Date.now() }]),
  ])
  // Its own settings, as a second copy of the plugin would hold them.
  const config = new (AbeleConfig as unknown as new () => AbeleConfig)()
  const keychain = new FakeKeychain()
  const made = { name, app, config, keychain, calls: 0, reloads: 0, saves: 0 } as Device
  made.store = new SecretStore({
    keychain: () => keychain,
    read: () => config.secretStore,
    write: async (file: SecretStoreFile | null) => {
      config.secretStore = file ?? undefined
      await config.saveSettings()
    },
    ids: () => [PROVIDER_KEY],
    conflictCopies: async () => [],
    now: () => Date.now(),
  })
  const plugin = {
    app,
    manifest: { id: 'abele', dir: '.obsidian/plugins/abele' },
    registerDomEvent: () => undefined,
    syncAiFeatures: () => undefined,
    // Obsidian's `loadData`: null for no file, undefined for one that is not JSON.
    loadData: async () => {
      if (!(await app.vault.adapter.exists(DATA))) return null
      try {
        return JSON.parse(new TextDecoder().decode(await app.vault.adapter.readBinary(DATA)))
      } catch {
        return undefined
      }
    },
    // Obsidian's `saveData`: two-space JSON, stamped with this device's clock.
    saveData: async (data: unknown) => {
      made.saves++
      const bytes = encoder.encode(JSON.stringify(reversed ? reordered(data) : data, undefined, 2))
      await app.vault.adapter.writeBinary(DATA, bytes.buffer as ArrayBuffer, { mtime: Date.now() })
    },
    // `main.ts`'s `onExternalSettingsChange`, less what needs the whole plugin.
    onExternalSettingsChange: async () => {
      made.calls++
      if (beforeReload !== undefined) await beforeReload()
      if (!(await config.reloadSettings())) return
      made.reloads++
      await made.store.load()
    },
  }
  made.tell = plugin.onExternalSettingsChange
  config.init(plugin as unknown as AbelePlugin)
  await config.loadSettings()
  await made.store.load()

  made.service = new (SyncService as unknown as new () => SyncService)()
  made.idb = new IDBFactory()
  made.service.init(app as unknown as App, plugin as unknown as AbelePlugin, {
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (beforeCommit !== undefined && url.endsWith('/commit') && typeof init?.body === 'string') {
        await beforeCommit(app, init.body)
      }
      return server.fetch(input, init)
    },
    WebSocket: server.WebSocket,
    indexedDB: made.idb,
    fallbackMs: 60_000,
    pollMs: 60_000,
  })
  await made.service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
  await made.service.chooseVault(vaultId, name, prefer)
  await waitFor(`${name} to sync`, () => {
    const status = made.service.status.value
    return status.state === 'idle' && status.lastSyncAt !== null
  })
  devices.push(made)
  return made
}

async function waitFor(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const until = Date.now() + PATIENCE_MS
  while (Date.now() < until) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`gave up waiting for ${what}`)
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** What the last run on a device pushed, out of the line its log keeps. */
function pushed(one: Device): number {
  const line = [...one.service.log.value].reverse().find((text) => text.includes('sync: done ('))
  const match = /pushed (\d+)/.exec(line ?? '')
  if (match === null)
    throw new Error(`${one.name} has not finished a sync: ${one.service.log.value.join(' | ')}`)
  return Number(match[1])
}

/**
 * One sync on the device, and whatever reload it set off seen through: the reload is started
 * after the run, and a save it made is the next run's to push.
 */
async function cycle(one: Device): Promise<void> {
  const calls = one.calls
  await one.service.syncNow()
  await tick()
  if (one.calls !== calls) await tick(50)
}

/** Syncs both devices in turn until a round in which neither pushed anything. */
async function settle(a: Device, b: Device): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await cycle(a)
    await cycle(b)
    if (pushed(a) === 0 && pushed(b) === 0) return
  }
  throw new Error('the two devices never settled')
}

/** Two more cycles on each: the convergence the scenarios end on. */
async function twoMoreCycles(a: Device, b: Device): Promise<void> {
  for (let round = 0; round < 2; round++) {
    await cycle(a)
    await cycle(b)
  }
}

async function onDisk(one: Device): Promise<Record<string, unknown>> {
  return JSON.parse(new TextDecoder().decode(await one.app.vault.adapter.readBinary(DATA)))
}

/** A new version of the settings file on the server, from the scenario's own device. */
async function commitSettings(text: string): Promise<void> {
  const item = (await other.manifest(null)).items.find((held) => held.path === DATA)
  if (item === undefined) throw new Error('the server holds no settings file')
  await seed(other, [
    {
      op: 'modify',
      file_id: item.file_id,
      base_version_id: item.version_id,
      ...(await blob(other, text)),
      mtime: Date.now(),
    },
  ])
}

/** What a device says when the vault's settings took the place of its own. */
const REPLACED = /settings on this device were replaced by the vault's/i

beforeEach(async () => {
  server = await syncServer()
  devices = []
  Notice.shown.length = 0
  tokens.values.clear()
  Platform.isMobile = false
  // The one the services read the scripts folder from, and the device-token keychain.
  AbeleConfig.getInstance().applySettings(undefined)
  setSecrets(
    new SecretStore({
      keychain: () => tokens,
      read: () => undefined,
      write: async () => undefined,
      ids: () => [],
      conflictCopies: async () => [],
      now: () => Date.now(),
    })
  )
  ;({ accountToken } = await server.account(EMAIL))
  ;({ vaultId } = await server.vault(accountToken, 'Home'))
  const { deviceToken } = await server.device(accountToken, vaultId, 'scenario')
  other = server.clientFor(deviceToken, vaultId)
})

afterEach(async () => {
  for (const one of devices) await one.service.destroy()
  await server.close()
  setSecrets(null)
})

describe('Abele settings between two devices', () => {
  it('takes a change made on one device to the other, reloads it once, and settles', async () => {
    const a = await device('Laptop')
    const b = await device('Phone')
    await settle(a, b)
    const before = { reloads: b.reloads, saves: b.saves }

    a.config.tasksFolder = 'Projects'
    await a.config.saveSettings()
    await cycle(a)
    await cycle(b)

    expect(b.config.tasksFolder).toBe('Projects')
    expect(b.reloads).toBe(before.reloads + 1)
    // Obsidian's own call for the same write finds nothing new.
    const calls = b.calls
    await b.tell()
    expect(b.calls).toBe(calls + 1)
    expect(b.reloads).toBe(before.reloads + 1)

    await twoMoreCycles(a, b)
    expect([pushed(a), pushed(b)]).toEqual([0, 0])
    // The device that took the change wrote nothing back.
    expect(b.saves).toBe(before.saves)
    expect((await onDisk(b)).tasksFolder).toBe('Projects')
  })

  it('a device joining with settings of its own takes the vault’s, and its own go to history', async () => {
    const a = await device('Laptop')
    a.config.tasksFolder = 'From the laptop'
    await a.config.saveSettings()
    await a.store.enable('passphrase', FAST)
    a.store.set(PROVIDER_KEY, 'sk-from-the-laptop')
    await a.store.flush()
    await cycle(a)

    // Saved after the laptop's, so its mtime is the newer one: it would win a plain race.
    await tick(20)
    const b = await device('Phone', { settings: { tasksFolder: 'From the phone' } })
    await settle(a, b)

    for (const one of [a, b]) {
      expect(one.config.tasksFolder).toBe('From the laptop')
      expect((await onDisk(one)).tasksFolder).toBe('From the laptop')
    }
    expect(a.store.status.value).toBe('unlocked')
    expect(a.store.get(PROVIDER_KEY)).toBe('sk-from-the-laptop')
    expect(b.store.status.value).toBe('locked')

    const item = (await other.manifest(null)).items.find((held) => held.path === DATA)
    const versions = await other.versions(item!.file_id)
    const texts = await Promise.all(
      versions.map(async (version) =>
        new TextDecoder().decode(await other.versionBytes(item!.file_id, version.version_id))
      )
    )
    expect(texts.some((text) => text.includes('From the phone'))).toBe(true)
    // The phone is told, once, where its own went; the laptop's became the vault's, and it is
    // told nothing.
    const told = Notice.shown.filter((message) => REPLACED.test(message))
    expect(told).toHaveLength(1)
    expect(told[0]).toMatch(/version history/i)

    await twoMoreCycles(a, b)
    expect([pushed(a), pushed(b)]).toEqual([0, 0])
    expect(Notice.shown.filter((message) => REPLACED.test(message))).toHaveLength(1)
  })

  it('says nothing of a first contact whose file was already the vault’s', async () => {
    const a = await device('Laptop')
    await settle(a, a)
    const text = new TextDecoder().decode(await a.app.vault.adapter.readBinary(DATA))

    await device('Phone', { settings: JSON.parse(text) as Record<string, unknown> })

    expect(Notice.shown.filter((message) => REPLACED.test(message))).toHaveLength(0)
  })

  /**
   * The first contact reports this device's file as the oldest there is, so the pusher, taking
   * the server's answer, must still see an edit made while the create was in the air — even one
   * that left the file the same size. Taken for untouched, the head would be written over it and
   * the edit would be in no version anywhere.
   */
  it('a same-size edit made while the first contact is in the air still reaches the history', async () => {
    const a = await device('Laptop')
    a.config.tasksFolder = 'From the laptop'
    await a.config.saveSettings()
    await cycle(a)

    await tick(20)
    let edited = false
    const b = await device('Phone', {
      settings: { tasksFolder: 'From the phone' },
      beforeCommit: async (app, body) => {
        if (edited || !body.includes(DATA)) return
        edited = true
        // The same number of bytes, saved a moment after the scan read the file.
        const was = new TextDecoder().decode(await app.vault.adapter.readBinary(DATA))
        const text = was.replace('From the phone', 'From the phonE')
        expect(text.length).toBe(was.length)
        await app.vault.adapter.writeBinary(DATA, encoder.encode(text).buffer as ArrayBuffer, {
          mtime: Date.now() + 5000,
        })
      },
    })
    await settle(a, b)
    expect(edited).toBe(true)

    for (const one of [a, b]) expect((await onDisk(one)).tasksFolder).toBe('From the laptop')
    const item = (await other.manifest(null)).items.find((held) => held.path === DATA)
    const versions = await other.versions(item!.file_id)
    const texts = await Promise.all(
      versions.map(async (version) =>
        new TextDecoder().decode(await other.versionBytes(item!.file_id, version.version_id))
      )
    )
    expect(texts.some((text) => text.includes('From the phonE'))).toBe(true)

    await twoMoreCycles(a, b)
    expect([pushed(a), pushed(b)]).toEqual([0, 0])
  })

  /**
   * "This device wins" makes every file the joining device holds the head, whatever its age —
   * and every Abele device holds a `data.json` from its first launch. So that one file is left out
   * of the join, and taken up once the join is done the way a first contact is: the vault's wins.
   */
  it('a device joining with "this device wins" still takes the vault’s settings, and its own go to history', async () => {
    const a = await device('Laptop')
    a.config.tasksFolder = 'X'
    await a.config.saveSettings()
    await cycle(a)

    await tick(20)
    const b = await device('Phone', { settings: { tasksFolder: 'From the phone' }, prefer: 'mine' })
    await settle(a, b)

    for (const one of [a, b]) {
      expect(one.config.tasksFolder).toBe('X')
      expect((await onDisk(one)).tasksFolder).toBe('X')
    }
    expect(b.service.connection.value.join).toBeNull()
    const item = (await other.manifest(null)).items.find((held) => held.path === DATA)
    const versions = await other.versions(item!.file_id)
    const texts = await Promise.all(
      versions.map(async (version) =>
        new TextDecoder().decode(await other.versionBytes(item!.file_id, version.version_id))
      )
    )
    expect(texts.some((text) => text.includes('From the phone'))).toBe(true)
    // The note both held went the way the phone asked: its copy is the head.
    const note = (await other.manifest(null)).items.find((held) => held.path === 'Existing.md')
    const head = await other.versionBytes(note!.file_id, note!.version_id)
    expect(new TextDecoder().decode(head)).toBe('made on Phone')

    // Left out while joining and back in after: nothing marks it as a file that went while out
    // of scope, which is what would later read its absence as a delete.
    const { stateId } = b.app.loadLocalStorage('abele-sync-ledger') as { stateId: string }
    const store = await IndexedDbStateStore.open(b.idb, stateDatabaseName(stateId))
    const marks = JSON.parse((await store.getMeta('out-of-scope-files')) ?? '[]') as string[]
    store.close()
    expect(marks).not.toContain(item!.file_id)

    await twoMoreCycles(a, b)
    expect([pushed(a), pushed(b)]).toEqual([0, 0])
    const still = (await other.manifest(null)).items.find((held) => held.path === DATA)
    expect(still?.file_id).toBe(item!.file_id)
    expect((await onDisk(b)).tasksFolder).toBe('X')
  })

  it('settles even when something writes the settings back every time they are reloaded', async () => {
    const a = await device('Laptop')
    const b = await device('Phone', { reversed: true })
    // A reload that saves on its way through — a migration persisted again, a screen writing
    // what it shows. Each such write is a newer file for the other device to pull.
    for (const one of [a, b]) one.config.onSaved(() => void one.config.rewrite())
    await settle(a, b)

    a.config.tasksFolder = 'Projects'
    await a.config.saveSettings()
    await cycle(a)
    await cycle(b)
    const saves = [a.saves, b.saves]
    await twoMoreCycles(a, b)

    expect(b.config.tasksFolder).toBe('Projects')
    expect([pushed(a), pushed(b)]).toEqual([0, 0])
    expect([a.saves, b.saves]).toEqual(saves)
  })

  it('carries a synced key to the other device, usable there once unlocked, and settles', async () => {
    const a = await device('Laptop')
    const b = await device('Phone')
    await settle(a, b)

    await a.store.enable('passphrase', FAST)
    await cycle(a)
    await cycle(b)
    expect(b.store.status.value).toBe('locked')
    expect(await b.store.unlock('passphrase')).toBe(true)
    await b.store.flush()

    a.store.set(PROVIDER_KEY, 'sk-from-the-laptop')
    await a.store.flush()
    await cycle(a)
    await cycle(b)

    expect(b.store.get(PROVIDER_KEY)).toBe('sk-from-the-laptop')
    expect(b.keychain.getSecret(PROVIDER_KEY)).toBe('sk-from-the-laptop')

    await settle(a, b)
    const saves = [a.saves, b.saves]
    await twoMoreCycles(a, b)
    expect([pushed(a), pushed(b)]).toEqual([0, 0])
    expect([a.saves, b.saves]).toEqual(saves)
  })

  /**
   * pi review, test gap: a file that arrives is parsed, a change this device made meanwhile is
   * put back on top of it rather than lost under it, and what is on disk — and then on every
   * device — holds both.
   */
  it('takes an arriving file with a change made here and not saved yet on top, on disk and everywhere', async () => {
    const a = await device('Laptop')
    const b = await device('Phone')
    await settle(a, b)

    b.config.refreshDelay = 777
    a.config.tasksFolder = 'Projects'
    await a.config.saveSettings()
    await cycle(a)
    await cycle(b)

    expect(b.config.tasksFolder).toBe('Projects')
    expect(b.config.refreshDelay).toBe(777)
    expect(await onDisk(b)).toMatchObject({ tasksFolder: 'Projects', refreshDelay: 777 })

    await settle(a, b)
    expect(a.config.refreshDelay).toBe(777)
    expect(await onDisk(a)).toMatchObject({ tasksFolder: 'Projects', refreshDelay: 777 })
    await twoMoreCycles(a, b)
    expect([pushed(a), pushed(b)]).toEqual([0, 0])
  })

  it('takes an arriving file with a save made here between its write and its reload on top', async () => {
    const a = await device('Laptop')
    let saveHere: (() => Promise<void>) | null = null
    const b = await device('Phone', {
      beforeReload: async () => {
        const save = saveHere
        saveHere = null
        await save?.()
      },
    })
    await settle(a, b)

    saveHere = async () => {
      b.config.refreshDelay = 888
      await b.config.saveSettings()
    }
    a.config.tasksFolder = 'Projects'
    await a.config.saveSettings()
    await cycle(a)
    await cycle(b)

    expect(saveHere).toBeNull()
    expect(b.config.tasksFolder).toBe('Projects')
    expect(b.config.refreshDelay).toBe(888)
    expect(await onDisk(b)).toMatchObject({ tasksFolder: 'Projects', refreshDelay: 888 })

    await settle(a, b)
    expect(await onDisk(a)).toMatchObject({ tasksFolder: 'Projects', refreshDelay: 888 })
    await twoMoreCycles(a, b)
    expect([pushed(a), pushed(b)]).toEqual([0, 0])
  })

  it('keeps the later of two saves made at once, and the other in version history', async () => {
    const a = await device('Laptop')
    const b = await device('Phone')
    await settle(a, b)

    a.config.tasksFolder = 'From the laptop'
    await a.config.saveSettings()
    await tick(20)
    b.config.tasksFolder = 'From the phone'
    await b.config.saveSettings()

    await cycle(a)
    await cycle(b)
    await cycle(a)

    for (const one of [a, b]) {
      expect(one.config.tasksFolder).toBe('From the phone')
      expect((await onDisk(one)).tasksFolder).toBe('From the phone')
    }
    const item = (await other.manifest(null)).items.find((held) => held.path === DATA)
    const versions = await other.versions(item!.file_id)
    const texts = await Promise.all(
      versions.map(async (version) =>
        new TextDecoder().decode(await other.versionBytes(item!.file_id, version.version_id))
      )
    )
    expect(texts.some((text) => text.includes('From the laptop'))).toBe(true)

    await twoMoreCycles(a, b)
    expect([pushed(a), pushed(b)]).toEqual([0, 0])
  })

  it('reads a settings file pulled half written again, and takes the whole one after it', async () => {
    const a = await device('Laptop')
    const b = await device('Phone')
    await settle(a, b)
    const whole = { ...(await onDisk(a)), tasksFolder: 'Whole' }
    const text = JSON.stringify(whole, undefined, 2)

    // Another device's write caught half way, then finished, within half a second.
    await commitSettings(text.slice(0, text.length / 2))
    await b.service.syncNow()
    await commitSettings(text)
    await b.service.syncNow()
    await waitFor('the phone to reload', () => b.config.tasksFolder === 'Whole')

    expect(b.config.settingsUnreadable).toBe(false)
    await tick(600)
    expect(b.config.settingsUnreadable).toBe(false)

    await settle(a, b)
    await twoMoreCycles(a, b)
    expect([pushed(a), pushed(b)]).toEqual([0, 0])
    expect(a.config.tasksFolder).toBe('Whole')
  })
})
