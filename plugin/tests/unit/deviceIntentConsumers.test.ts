import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { GlobalStore } from '@/stores/GlobalStore'
import { DeviceIntentStore } from '@/services/DeviceIntentStore'
import { rememberSessionOwnerMode, sessionOwnerMode } from '@/node/sessionOwnerMode'
import { networkDecision } from '@/slides/liveAdapter'
import { recoverScriptProvenance, SCRIPT_TRUST_KEY } from '@/scripting/trust/scriptTrustStorage'
import { buildFakeVault } from '../helpers/fakeVault'
vi.mock('@/components/obsidian/dialogs', () => ({ choiceDialog: vi.fn(async () => 'offline') }))
afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

it('persists session choices durably and restores migrated choices without local mirrors', async () => {
  useVault([])
  const app = GlobalStore.getInstance().app
  Object.assign(app, { appId: 'sample-owner' })
  const factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  await rememberSessionOwnerMode('sample-node', 'sample-session', 'allow-all')
  const key = 'abele-node-session-owner-mode:["sample-node","sample-session"]'
  expect(await new DeviceIntentStore(app, factory).read(key)).toBe('allow-all')
  expect(await sessionOwnerMode('sample-node', 'sample-session')).toBe('allow-all')
  expect(app.loadLocalStorage(key)).toBeFalsy()
})

it('uses migrated offline slide choices without prompting again', async () => {
  const factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  const app = Object.assign(buildFakeVault([]), { appId: 'sample-slide' }) as unknown as App
  window.localStorage.setItem('sample-slide-abele-slide-network:sample-deck.md', 'false')
  const { choiceDialog } = await import('@/components/obsidian/dialogs')
  vi.mocked(choiceDialog).mockClear()
  expect(await networkDecision(app, 'sample-deck.md')).toBe(false)
  expect(choiceDialog).not.toHaveBeenCalled()
  expect(window.localStorage.length).toBe(0)
})

it('commits retired provenance before replacing the descriptor, without a localStorage evidence copy', async () => {
  const factory = new IDBFactory()
  const app = Object.assign(buildFakeVault([]), { appId: 'sample-recovery' }) as unknown as App
  const previous = { id: 'sample-old-descriptor', damaged: ['preserve-me'] }
  app.saveLocalStorage(SCRIPT_TRUST_KEY, previous)
  const result = await recoverScriptProvenance(app, async () => true, factory)
  result.store.close()
  const current = app.loadLocalStorage(SCRIPT_TRUST_KEY) as { id: string }
  const key = 'abele-script-provenance-retired:' + current.id
  expect(await new DeviceIntentStore(app, factory).read(key)).toEqual(previous)
  expect(app.loadLocalStorage(key)).toBeFalsy()
})

it('keeps the current descriptor if its context changes while evidence is committing', async () => {
  const factory = new IDBFactory()
  const app = Object.assign(buildFakeVault([]), { appId: 'sample-context-race' }) as unknown as App
  const previous = { id: 'sample-old' }
  const changed = { id: 'sample-concurrent' }
  app.saveLocalStorage(SCRIPT_TRUST_KEY, previous)
  const write = DeviceIntentStore.prototype.write
  const spy = vi
    .spyOn(DeviceIntentStore.prototype, 'write')
    .mockImplementation(async function (key, value) {
      await write.call(this, key, value)
      app.saveLocalStorage(SCRIPT_TRUST_KEY, changed)
    })
  try {
    await expect(recoverScriptProvenance(app, async () => true, factory)).rejects.toThrow(/changed/)
    expect(app.loadLocalStorage(SCRIPT_TRUST_KEY)).toEqual(changed)
  } finally {
    spy.mockRestore()
  }
})

it('persists a new offline slide choice once for concurrent requests', async () => {
  const factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  const app = Object.assign(buildFakeVault([]), { appId: 'sample-new-slide' }) as unknown as App
  const { choiceDialog } = await import('@/components/obsidian/dialogs')
  vi.mocked(choiceDialog).mockClear()
  expect(
    await Promise.all([networkDecision(app, 'sample.md'), networkDecision(app, 'sample.md')])
  ).toEqual([false, false])
  expect(choiceDialog).toHaveBeenCalledTimes(1)
  expect(await new DeviceIntentStore(app, factory).read('abele-slide-network:sample.md')).toBe(
    false
  )
  expect(window.localStorage.length).toBe(0)
})

it('does not fall back to permissive intent or replace provenance when durable storage fails', async () => {
  const app = Object.assign(useVault([]), { appId: 'sample-unavailable' })
  const factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  const spy = vi.spyOn(factory, 'open').mockImplementation(() => {
    throw new Error('unavailable')
  })
  const previous = { id: 'sample-preserved' }
  app.saveLocalStorage(SCRIPT_TRUST_KEY, previous)
  try {
    await expect(sessionOwnerMode('sample-node', 'sample')).rejects.toThrow('unavailable')
    await expect(rememberSessionOwnerMode('sample-node', 'sample', 'allow-all')).rejects.toThrow(
      'unavailable'
    )
    await expect(
      recoverScriptProvenance(app as unknown as App, async () => true, factory)
    ).rejects.toThrow('unavailable')
    expect(app.loadLocalStorage(SCRIPT_TRUST_KEY)).toEqual(previous)
  } finally {
    spy.mockRestore()
  }
})

it('never restores a permissive default when a previously restrictive choice is missing after restart', async () => {
  Object.assign(useVault([]), { appId: 'sample-missing-owner' })
  vi.stubGlobal('indexedDB', new IDBFactory())
  await rememberSessionOwnerMode('sample-node', 'sample', 'confirm-all')
  // Model a lost database after source cleanup. No legacy mirror remains to recover.
  vi.stubGlobal('indexedDB', new IDBFactory())
  expect(await sessionOwnerMode('sample-node', 'sample')).toBe('confirm-all')
  expect(
    window.localStorage.getItem(
      'sample-missing-owner-abele-node-session-owner-mode:["sample-node","sample"]'
    )
  ).toBeNull()
})

it('continues restrictively when a legacy session choice contains malformed JSON', async () => {
  const app = Object.assign(useVault([]), { appId: 'sample-malformed-session' })
  const factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  const key = 'abele-node-session-owner-mode:["sample-node","sample-session"]'
  window.localStorage.setItem('sample-malformed-session-' + key, '{broken')
  await new DeviceIntentStore(app, factory).migrate()
  await expect(sessionOwnerMode('sample-node', 'sample-session')).resolves.toBe('confirm-all')
  await expect(sessionOwnerMode('sample-node', 'sample-session')).resolves.toBe('confirm-all')
  expect(await new DeviceIntentStore(app, factory).readRaw(key)).toBe('{broken')
})
