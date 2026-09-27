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
import { create, seed } from '../../../../abele-sync/packages/core/tests/helpers/seed.js'

/**
 * Many files deleted at once on this device (phase 3b, decision 8).
 *
 * The engine holds such deletes back from the server until somebody decides; the plugin shows
 * the hold, lists it, asks once per new set of held files, and carries the decision — for
 * exactly the files it showed — to the engine. A real server and engine run in this process, as
 * in `syncJoin.test.ts`.
 */

const EMAIL = 'device@test.io'
const PATIENCE_MS = 10_000
const NOTES = 100

let server: SyncServer
let app: FakeApp
let service: SyncService
let other: VaultClient
let vaultId: string
/** Flipped by a test to make every request fail the way a lost network does. */
let offline = false

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

const note = (n: number): string => `Notes/Note ${String(n).padStart(3, '0')}.md`

async function waitFor(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const until = Date.now() + PATIENCE_MS
  while (Date.now() < until) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`gave up waiting for ${what}; the status was ${service.status.value.state}`)
}

/** Deletes notes `from` to `to` (exclusive) on this device, the way a person or a tool would. */
async function remove(from: number, to: number): Promise<void> {
  for (let n = from; n < to; n++) await app.vault.adapter.remove(note(n))
}

beforeEach(async () => {
  offline = false
  server = await syncServer()
  Platform.isMobile = false
  AbeleConfig.getInstance().init(plugin)
  AbeleConfig.getInstance().applySettings(undefined)
  app = buildFakeVault([])
  setSecrets(createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin))
  const { accountToken } = await server.account(EMAIL)
  ;({ vaultId } = await server.vault(accountToken, 'Home'))
  const { deviceToken } = await server.device(accountToken, vaultId, 'Laptop')
  other = server.clientFor(deviceToken, vaultId)
  const ops = []
  for (let n = 0; n < NOTES; n++) ops.push(await create(other, note(n), `note ${n}`))
  await seed(other, ops)

  service = SyncService.getInstance()
  service.init(app as unknown as App, plugin, {
    fetch: (input, init) =>
      offline ? Promise.reject(new Error('the network is gone')) : server.fetch(input, init),
    WebSocket: server.WebSocket,
    indexedDB: new IDBFactory(),
    fallbackMs: 60_000,
    pollMs: 60_000,
  })
  await service.connect(server.BASE_URL, EMAIL, server.TEST_PASSWORD)
  await service.chooseVault(vaultId, 'Desktop')
  await waitFor('the vault to arrive', async () => app.vault.adapter.exists(note(NOTES - 1)))
  await waitFor('the first sync', () => service.status.value.state === 'idle')
})

afterEach(async () => {
  await service.destroy()
  await server.close()
  setSecrets(null)
})

describe('many files deleted at once on this device', () => {
  it('are held: the status counts them, and nothing reaches the server’s trash', async () => {
    await remove(0, 60)
    await service.syncNow()

    expect(service.status.value.heldDeletes).toBe(60)
    expect(await service.heldDeletes()).toHaveLength(60)
    expect(await other.trash()).toHaveLength(0)
  })

  it('go to the server’s trash when confirmed, the ones shown and no others', async () => {
    await remove(0, 60)
    await service.syncNow()
    const shown = (await service.heldDeletes()).map((one) => one.fileId)

    const decided = await service.decideDeletes('confirm', shown)

    expect(decided).toEqual({ decided: 60, applied: true })
    expect(await other.trash()).toHaveLength(60)
    expect(service.status.value.heldDeletes).toBe(0)
  })

  it('come back when put back', async () => {
    await remove(0, 60)
    await service.syncNow()
    const shown = (await service.heldDeletes()).map((one) => one.fileId)

    await service.decideDeletes('restore', shown)
    await waitFor('the files to come back', async () => app.vault.adapter.exists(note(59)))

    expect(await app.vault.adapter.exists(note(0))).toBe(true)
    expect(await other.trash()).toHaveLength(0)
    expect(service.status.value.heldDeletes).toBe(0)
  })

  it('wait for syncing to resume when decided while paused', async () => {
    await remove(0, 60)
    await service.syncNow()
    const shown = (await service.heldDeletes()).map((one) => one.fileId)
    service.pause()

    expect(await service.decideDeletes('confirm', shown)).toEqual({ decided: 60, applied: false })
    expect(await other.trash()).toHaveLength(0)

    service.resume()
    await waitFor('the trash to fill', async () => (await other.trash()).length === 60)
  })
})

describe('a decision a sync did not carry out', () => {
  it('is counted as taken when the sync after it fails, and is carried out once it gets through', async () => {
    await remove(0, 60)
    await service.syncNow()
    const shown = (await service.heldDeletes()).map((one) => one.fileId)

    offline = true
    expect(await service.decideDeletes('restore', shown)).toEqual({ decided: 60, applied: false })

    offline = false
    await service.syncNow()
    await waitFor('the files to come back', async () => app.vault.adapter.exists(note(59)))
    expect(await other.trash()).toHaveLength(0)
  })

  it('is shown as waiting while paused, and a second answer replaces it, saying so', async () => {
    await remove(0, 60)
    await service.syncNow()
    const shown = (await service.heldDeletes()).map((one) => one.fileId)
    service.pause()

    await service.decideDeletes('confirm', shown)
    expect(service.heldPrompt.decided.value).toEqual({ kind: 'confirm', count: 60 })

    await service.decideDeletes('restore', shown)
    expect(service.heldPrompt.decided.value).toEqual({ kind: 'restore', count: 60 })
    expect(service.log.value.join('\n')).toContain('replaces the answer given before')

    service.resume()
    await waitFor('the files to come back', async () => app.vault.adapter.exists(note(59)))
    await waitFor('the hold to go', () => service.heldPrompt.held.value.length === 0)
    expect(service.heldPrompt.decided.value).toBeNull()
    expect(await other.trash()).toHaveLength(0)
  })
})

describe('after they were deleted everywhere', () => {
  it('come back with one bulk restore of the trash, and are here after a sync', async () => {
    await remove(0, 60)
    await service.syncNow()
    await service.decideDeletes(
      'confirm',
      (await service.heldDeletes()).map((one) => one.fileId)
    )
    const client = service.client()!
    const trash = await client.trash()
    expect(trash).toHaveLength(60)

    const results = await client.restoreDeletedMany(
      trash.map((one) => one.file_id),
      'restore-since-test'
    )
    await service.syncNow()

    expect(results.every((result) => result.status === 'applied')).toBe(true)
    expect(await client.trash()).toHaveLength(0)
    expect(await app.vault.adapter.exists(note(0))).toBe(true)
    expect(await app.vault.adapter.exists(note(59))).toBe(true)
    expect(service.status.value.heldDeletes).toBe(0)
  })
})

describe('asking about held deletes', () => {
  it('asks once per new set of held files, with exactly those files', async () => {
    await remove(0, 60)
    await service.syncNow()
    await waitFor('the question', () => service.heldPrompt.asking.value !== null)

    const first = service.heldPrompt.asking.value!
    expect(first.held).toHaveLength(60)
    service.heldPrompt.close()

    // The same hold again: nothing new to ask.
    await service.syncNow()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(service.heldPrompt.asking.value).toBeNull()

    // More go while it is held: the hold grows, and that is a new question, about all of them.
    await remove(60, 80)
    await service.syncNow()
    await waitFor('the second question', () => service.heldPrompt.asking.value !== null)
    expect(service.heldPrompt.asking.value!.held).toHaveLength(80)
    expect(service.heldPrompt.asking.value!.key).not.toBe(first.key)
  })

  it('lets go of the question once nothing is held', async () => {
    await remove(0, 60)
    await service.syncNow()
    await waitFor('the question', () => service.heldPrompt.asking.value !== null)
    const shown = service.heldPrompt.asking.value!.held.map((one) => one.fileId)

    await service.decideDeletes('confirm', shown)
    await waitFor('the question to go', () => service.heldPrompt.asking.value === null)
    expect(service.heldPrompt.held.value).toEqual([])
  })
})
