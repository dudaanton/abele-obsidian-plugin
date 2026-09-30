// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Platform, type App } from 'obsidian'
import type { VaultClient } from '@abele/sync-core'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService } from '@/sync/SyncService'
import { setSecrets } from '@/secrets/SecretStore'
import { createPluginSecrets } from '@/secrets/host'
import type AbelePlugin from '@/main'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'
import { syncServer, type SyncServer } from '../helpers/syncServer'
import {
  blob,
  create,
  seed,
  shaOf,
} from '../../../../abele-sync/packages/core/tests/helpers/seed.js'

/**
 * Obsidian settings changed on another device (phase 3b, decision 11).
 *
 * A pull that brings a change under the config folder does not write it: the engine stages it,
 * and the plugin asks once per new batch — Reload now writes what was staged and reloads
 * Obsidian, Later leaves it waiting, Keep this device's sends this device's files over it.
 * Abele's own `data.json` is the exception, written at once and reloaded by the plugin itself.
 * A real server and engine run in this process, as in `syncHeldDeletes.test.ts`; the reload is
 * the prompt's seam, so nothing here reloads anything.
 */

const EMAIL = 'device@test.io'
const PATIENCE_MS = 10_000
const HOTKEYS = '.obsidian/hotkeys.json'
const APP = '.obsidian/app.json'
const OWN = '.obsidian/plugins/abele/data.json'

let server: SyncServer
let app: FakeApp
let service: SyncService
let other: VaultClient
let vaultId: string
/** The account's token, for a test that makes a second vault. */
let accountToken: string
let indexedDB: IDBFactory
/** How many times the prompt reloaded Obsidian through its seam. */
let reloads = 0
/** How many times the plugin was told its own settings file changed on disk. */
let ownArrived = 0

const plugin = {
  manifest: { id: 'abele', dir: '.obsidian/plugins/abele' },
  registerDomEvent: () => undefined,
  loadData: () => Promise.resolve({}),
  saveData: () => Promise.resolve(),
  syncAiFeatures: () => undefined,
  onExternalSettingsChange: () => {
    ownArrived++
    return Promise.resolve()
  },
} as unknown as AbelePlugin

beforeAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>
  globals.window ??= globalThis
  globals.document ??= { visibilityState: 'visible' }
})

async function waitFor(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const until = Date.now() + PATIENCE_MS
  while (Date.now() < until) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(
    `gave up waiting for ${what}; the status was ${JSON.stringify(service.status.value)}\n` +
      service.log.value.slice(-25).join('\n')
  )
}

const read = async (path: string): Promise<string> =>
  new TextDecoder().decode(await app.vault.adapter.readBinary(path))

/** A file put into the vault by hand, folders and all. */
const write = async (path: string, text: string): Promise<void> => {
  const cut = path.lastIndexOf('/')
  if (cut !== -1 && !(await app.vault.adapter.exists(path.slice(0, cut)))) {
    await app.vault.adapter.mkdir(path.slice(0, cut))
  }
  await app.vault.adapter.writeBinary(path, new TextEncoder().encode(text).buffer as ArrayBuffer)
}

/** The server's head of `path`, as the other device would change it. */
async function modify(path: string, content: string): Promise<void> {
  const page = await other.manifest(null)
  const item = page.items.find((held) => held.path === path)
  if (item === undefined) throw new Error(`the server holds no ${path}`)
  await seed(other, [
    {
      op: 'modify',
      file_id: item.file_id,
      base_version_id: item.version_id,
      ...(await blob(other, content)),
      mtime: Date.now(),
    },
  ])
}

/** The sha the server's head of `path` holds. */
async function serverSha(path: string): Promise<string | null> {
  const page = await other.manifest(null)
  return page.items.find((held) => held.path === path)?.sha ?? null
}

/** Hands the prompt a reload that counts instead of reloading. */
function seamReload(available = true): void {
  service.settingsPrompt.reloader = {
    available: () => available,
    reload: () => {
      reloads++
      return true
    },
  }
}

/** The versions the open question shows: what a press of its buttons answers for. */
const shown = (): string[] =>
  (service.settingsPrompt.asking.value?.changes ?? []).map((change) => change.version_id)

function start(): void {
  service.init(app as unknown as App, plugin, {
    fetch: (input, init) => server.fetch(input, init),
    WebSocket: server.WebSocket,
    indexedDB,
    fallbackMs: 60_000,
    pollMs: 60_000,
  })
  seamReload()
}

beforeEach(async () => {
  server = await syncServer()
  indexedDB = new IDBFactory()
  reloads = 0
  ownArrived = 0
  Platform.isMobile = false
  AbeleConfig.getInstance().init(plugin)
  AbeleConfig.getInstance().applySettings(undefined)
  app = buildFakeVault([
    { path: 'Note.md', content: 'a note', mtime: 1000, ctime: 1000 },
    { path: APP, content: '{"a":1}', mtime: 1000, ctime: 1000 },
    { path: HOTKEYS, content: '{"here":true}', mtime: 1000, ctime: 1000 },
  ])
  setSecrets(createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin))
  ;({ accountToken } = await server.account(EMAIL))
  ;({ vaultId } = await server.vault(accountToken, 'Home'))
  const { deviceToken } = await server.device(accountToken, vaultId, 'Laptop')
  other = server.clientFor(deviceToken, vaultId)

  service = SyncService.getInstance()
  start()
  await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
  await service.chooseVault(vaultId, 'Desktop')
  await waitFor('the first sync', () => service.status.value.state === 'idle')
  await waitFor('the settings on the server', async () => (await serverSha(HOTKEYS)) !== null)
})

afterEach(async () => {
  await service.destroy()
  await server.close()
  setSecrets(null)
})

describe('settings changed on another device', () => {
  it('are staged rather than written, counted, and asked about once', async () => {
    await modify(HOTKEYS, '{"there":true}')
    await service.syncNow()
    await waitFor('the question', () => service.settingsPrompt.asking.value !== null)

    expect(await read(HOTKEYS)).toBe('{"here":true}')
    expect(service.status.value.deferred).toBe(1)
    const asked = service.settingsPrompt.asking.value!
    expect(asked.changes.map((change) => change.path)).toEqual([HOTKEYS])
    expect(asked.changes[0]!.actor.name).toBe('Laptop')
    expect(service.settingsPrompt.staged.value).toHaveLength(1)

    // Another sync with nothing new asks nothing new.
    await service.syncNow()
    expect(service.settingsPrompt.asking.value?.key).toBe(asked.key)
  })

  it('are not asked about again after Later, until another change is staged', async () => {
    await modify(HOTKEYS, '{"there":true}')
    await service.syncNow()
    await waitFor('the question', () => service.settingsPrompt.asking.value !== null)
    const first = service.settingsPrompt.asking.value!.key

    service.settingsPrompt.later()
    await service.syncNow()
    expect(service.settingsPrompt.asking.value).toBeNull()
    expect(service.status.value.deferred).toBe(1)

    await modify(APP, '{"a":2}')
    await service.syncNow()
    await waitFor('the second question', () => service.settingsPrompt.asking.value !== null)
    const second = service.settingsPrompt.asking.value!
    expect(second.key).toBeGreaterThan(first)
    expect(second.changes.map((change) => change.path).sort()).toEqual([APP, HOTKEYS])
  })

  it('reports a partial apply exactly and still offers reload after a later file write fails', async () => {
    await modify(APP, '{"a":2}')
    await modify(HOTKEYS, '{"there":true}')
    await service.syncNow()
    await waitFor('both settings staged', () => service.status.value.deferred === 2)
    const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
    app.vault.adapter.writeBinary = async (path, bytes, options) => {
      if (path.endsWith('.tmp') && new TextDecoder().decode(bytes).includes('"there"'))
        throw new Error('write unavailable')
      return write(path, bytes, options)
    }
    const outcome = await service.applySettingsAndReload(shown())
    expect(outcome?.applied).toEqual([APP])
    expect(outcome?.failed).toEqual([expect.objectContaining({ path: HOTKEYS })])
    expect(outcome?.reloaded).toBe(false)
    expect(await read(APP)).toBe('{"a":2}')
    expect(await read(HOTKEYS)).toBe('{"here":true}')
    expect(service.settingsPrompt.appliedWaiting.value).toEqual([APP])
    expect(await service.reloadAppliedSettings()).toBe(true)
    expect(reloads).toBe(1)
    expect(service.settingsPrompt.appliedWaiting.value).toEqual([])
  })

  it('reports a file already written when its replacement journal update fails afterwards', async () => {
    await modify(APP, '{"a":2}')
    await service.syncNow()
    await waitFor('the question', () => service.settingsPrompt.asking.value !== null)
    const save = app.saveLocalStorage.bind(app)
    app.saveLocalStorage = (key, value) => {
      if (
        key === 'abele-sync-writes' &&
        Array.isArray(value) &&
        value.some((entry) => entry.installed === true)
      )
        throw new Error('journal update unavailable')
      save(key, value)
    }
    const outcome = await service.applySettingsAndReload(shown())
    expect(outcome?.applied).toEqual([APP])
    expect(outcome?.failed).toEqual([expect.objectContaining({ path: APP })])
    expect(await read(APP)).toBe('{"a":2}')
    expect(service.settingsPrompt.appliedWaiting.value).toEqual([APP])
    app.saveLocalStorage = save
  })

  it('are written by Reload now, which reloads Obsidian once', async () => {
    await modify(HOTKEYS, '{"there":true}')
    await service.syncNow()
    await waitFor('the question', () => service.settingsPrompt.asking.value !== null)

    const outcome = await service.applySettingsAndReload(shown())

    expect(outcome).toEqual({ applied: [HOTKEYS], skipped: [], reloaded: true, unshown: [] })
    expect(await read(HOTKEYS)).toBe('{"there":true}')
    expect(reloads).toBe(1)
    expect(service.status.value.deferred).toBe(0)
    expect(service.settingsPrompt.asking.value).toBeNull()
  })

  it('are applied without a reload where Obsidian has no reload command, and say so', async () => {
    seamReload(false)
    await modify(HOTKEYS, '{"there":true}')
    await service.syncNow()
    await waitFor('the question', () => service.settingsPrompt.asking.value !== null)

    const outcome = await service.applySettingsAndReload(shown())

    expect(outcome).toEqual({ applied: [HOTKEYS], skipped: [], reloaded: false, unshown: [] })
    expect(await read(HOTKEYS)).toBe('{"there":true}')
    expect(reloads).toBe(0)
  })

  it('give way to this device’s files with Keep this device’s, which the next run pushes', async () => {
    await modify(HOTKEYS, '{"there":true}')
    await service.syncNow()
    await waitFor('the question', () => service.settingsPrompt.asking.value !== null)

    const kept = await service.keepLocalSettings(undefined, shown())
    expect(kept).toEqual({ kept: [HOTKEYS], left: [], blocked: [], unshown: [] })
    await service.syncNow()

    expect(await read(HOTKEYS)).toBe('{"here":true}')
    expect(await serverSha(HOTKEYS)).toBe(await shaOf('{"here":true}'))
    expect(service.status.value.deferred).toBe(0)
    expect(service.settingsPrompt.asking.value).toBeNull()
    expect(reloads).toBe(0)
  })

  it('never stage Abele’s own data.json, which is written and reloaded at once', async () => {
    await write(OWN, '{"tasksFolder":"Here"}')
    await service.syncNow()
    await waitFor('the own settings on the server', async () => (await serverSha(OWN)) !== null)
    ownArrived = 0

    await modify(OWN, '{"tasksFolder":"Elsewhere"}')
    await service.syncNow()
    await waitFor('the plugin to be told', () => ownArrived > 0)

    expect(await read(OWN)).toBe('{"tasksFolder":"Elsewhere"}')
    expect(service.status.value.deferred).toBe(0)
    expect(service.settingsPrompt.asking.value).toBeNull()
  })

  it('are asked about again at the next start, while they wait', async () => {
    await modify(HOTKEYS, '{"there":true}')
    await service.syncNow()
    await waitFor('the question', () => service.settingsPrompt.asking.value !== null)
    service.settingsPrompt.later()

    await service.destroy()
    service = SyncService.getInstance()
    start()
    await waitFor(
      'the question after the start',
      () => service.settingsPrompt.asking.value !== null
    )

    expect(service.settingsPrompt.asking.value!.changes.map((change) => change.path)).toEqual([
      HOTKEYS,
    ])
    expect(await read(HOTKEYS)).toBe('{"here":true}')
  })

  it('are staged at a join where the server wins, rather than written over this device’s', async () => {
    await service.forget()
    const { vaultId: joined } = await server.vault(accountToken, 'Work')
    const { deviceToken } = await server.device(accountToken, joined, 'Laptop')
    const there = server.clientFor(deviceToken, joined)
    await seed(there, [await create(there, APP, '{"a":"there"}', Date.now())])

    await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
    await service.chooseVault(joined, 'Desktop', 'theirs')
    await waitFor('the question', () => service.settingsPrompt.asking.value !== null)

    expect(await read(APP)).toBe('{"a":1}')
    expect(service.settingsPrompt.asking.value!.changes.map((change) => change.path)).toContain(APP)
  })

  /**
   * A press answers for what the question showed (pi review #3): a setting staged while it was
   * open, or a newer version of one it showed, is neither written nor kept, and Obsidian is not
   * reloaded into it — it is asked about instead.
   */
  describe('answered after more arrived', () => {
    it('Reload now writes only what was shown, reloads nothing, and asks about the rest', async () => {
      await modify(HOTKEYS, '{"there":true}')
      await service.syncNow()
      await waitFor('the question', () => service.settingsPrompt.asking.value !== null)
      const answered = shown()

      await modify(APP, '{"a":2}')
      await service.syncNow()
      await waitFor('both staged', () => service.status.value.deferred === 2)

      const outcome = await service.applySettingsAndReload(answered)

      expect(outcome).toMatchObject({ applied: [HOTKEYS], skipped: [], reloaded: false })
      expect(outcome?.unshown).toEqual([APP])
      expect(await read(HOTKEYS)).toBe('{"there":true}')
      expect(await read(APP)).toBe('{"a":1}')
      expect(reloads).toBe(0)
      expect(service.settingsPrompt.asking.value?.changes.map((change) => change.path)).toEqual([
        APP,
      ])
    })

    it('a newer version of a shown file is not applied, and is asked about', async () => {
      await modify(HOTKEYS, '{"there":true}')
      await service.syncNow()
      await waitFor('the question', () => service.settingsPrompt.asking.value !== null)
      const answered = shown()

      await modify(HOTKEYS, '{"there":"again"}')
      await service.syncNow()
      await waitFor(
        'the newer version staged',
        () => service.settingsPrompt.staged.value[0]?.version_id !== answered[0]
      )

      const outcome = await service.applySettingsAndReload(answered)

      expect(outcome).toMatchObject({ applied: [], reloaded: false, unshown: [HOTKEYS] })
      expect(await read(HOTKEYS)).toBe('{"here":true}')
      expect(reloads).toBe(0)
      const asked = service.settingsPrompt.asking.value
      expect(asked?.changes.map((change) => change.version_id)).not.toEqual(answered)
      expect(asked?.changes.map((change) => change.path)).toEqual([HOTKEYS])
    })

    it('Keep this device’s does not send this device’s file over a newer version', async () => {
      await modify(HOTKEYS, '{"there":true}')
      await service.syncNow()
      await waitFor('the question', () => service.settingsPrompt.asking.value !== null)
      const answered = shown()

      await modify(HOTKEYS, '{"there":"again"}')
      await service.syncNow()
      await waitFor(
        'the newer version staged',
        () => service.settingsPrompt.staged.value[0]?.version_id !== answered[0]
      )

      const kept = await service.keepLocalSettings([HOTKEYS], answered)
      await service.syncNow()

      expect(kept).toMatchObject({ kept: [], unshown: [HOTKEYS] })
      expect(await serverSha(HOTKEYS)).toBe(await shaOf('{"there":"again"}'))
      expect(service.status.value.deferred).toBe(1)
      expect(service.settingsPrompt.asking.value?.changes.map((change) => change.path)).toEqual([
        HOTKEYS,
      ])
    })
  })
})
