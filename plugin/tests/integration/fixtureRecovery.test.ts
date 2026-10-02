// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
const mock = vi.hoisted(() => ({
  connection: { value: { vaultId: '', deviceTokenId: '', pendingRevoke: [] as any[] } },
  forget: vi.fn(async () => {}),
  keeper: { read: vi.fn() },
}))
vi.mock('@/sync/SyncService', () => ({ SyncService: { getInstance: () => mock } }))
import { prepareFixtureContext, restoreFixtureContext } from '@/testing/fixtureContext'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { buildFakeVault } from '../helpers/fakeVault'
import { scriptForExecution, assertScriptContext } from '@/scripting/trust/scriptExecutionGate'
import { readConnection, emptyConnection } from '@/sync/connection'
import { Platform, type App } from 'obsidian'
let factory: IDBFactory
beforeEach(() => {
  factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  vi.stubGlobal('window', globalThis)
  mock.connection.value = { vaultId: '', deviceTokenId: '', pendingRevoke: [] }
  mock.forget.mockReset()
  mock.keeper.read.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  Platform.isMobile = false
})
async function setup() {
  const app = buildFakeVault([
    { path: 'Scripts/sample.js', content: '// @name Sample\nreturn "unapproved"' },
  ])
  ;(app.workspace as any).getLayout = () => ({ sample: true })
  ;(app.workspace as any).changeLayout = vi.fn(async () => {})
  app.saveLocalStorage('abele-sync-ledger', { stateId: 'sample-original', vaultId: 'sample-old' })
  const db = await IndexedDbStateStore.open(factory, 'abele-sync-sample-original')
  await db.setMeta('preserved', 'original ledger bytes')
  db.close()
  return app
}
async function fixture(app: ReturnType<typeof buildFakeVault>) {
  await prepareFixtureContext(app as unknown as App, 'FixtureRecovery')
  app.saveLocalStorage('abele-sync-ledger', { stateId: 'sample-fixture', vaultId: 'sample-new' })
  const db = await IndexedDbStateStore.open(factory, 'abele-sync-sample-fixture')
  db.close()
  mock.forget.mockImplementation(async () => {
    const id = (app.loadLocalStorage('abele-sync-ledger') as any)?.stateId
    if (id) await IndexedDbStateStore.delete(factory, 'abele-sync-' + id)
    app.saveLocalStorage('abele-sync-ledger', null)
  })
  mock.keeper.read.mockImplementation(() => {
    mock.connection.value = readConnection(app) as any
  })
}
describe('retryable phone fixture recovery', () => {
  it.each(['sentinel', 'bindings'])(
    'recovers interrupted preparation at %s without forgetting originals',
    async (boundary) => {
      const app = await setup()
      const saved = app.loadLocalStorage('abele-sync-ledger')
      mock.keeper.read.mockImplementation(() => {
        mock.connection.value = readConnection(app, Platform.isMobile) as any
      })
      if (boundary === 'sentinel') {
        const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
        let failed = false
        vi.spyOn(app.vault.adapter, 'writeBinary').mockImplementation(async (path, bytes) => {
          if (path === '.abele-script-context-hold' && !failed) {
            failed = true
            throw new Error('Synthetic sentinel failure')
          }
          return write(path, bytes)
        })
      } else {
        const save = app.saveLocalStorage.bind(app)
        let failed = false
        vi.spyOn(app, 'saveLocalStorage').mockImplementation((key, value) => {
          if (key === 'abele-sync-ledger-proof' && value === null && !failed) {
            failed = true
            throw new Error('Synthetic detach interruption')
          }
          save(key, value)
        })
      }
      await expect(prepareFixtureContext(app as unknown as App, 'FixtureRecovery')).rejects.toThrow(
        /Synthetic/
      )
      expect(app.loadLocalStorage('abele-script-execution-context-hold')).toBe(true)
      expect(await restoreFixtureContext(app as unknown as App)).toEqual({
        restored: true,
        errors: [],
      })
      expect(mock.forget).not.toHaveBeenCalled()
      expect(app.loadLocalStorage('abele-sync-ledger')).toEqual(saved)
      expect(app.loadLocalStorage('abele-script-execution-context-hold')).toBeNull()
      expect(app.loadLocalStorage('task14-isolated-fixture')).toBeNull()
      const db = await IndexedDbStateStore.open(factory, 'abele-sync-sample-original')
      expect(await db.getMeta('preserved')).toBe('original ledger bytes')
      db.close()
      await expect(
        prepareFixtureContext(app as unknown as App, 'FixtureRecoveryAgain')
      ).resolves.toBe(true)
    }
  )
  it('rehydrates absent connection using actual mobile defaults with no queued revoke', async () => {
    Platform.isMobile = true
    const app = await setup()
    await fixture(app)
    mock.keeper.read.mockImplementation(() => {
      mock.connection.value = readConnection(app, Platform.isMobile) as any
    })
    const result = await restoreFixtureContext(app as unknown as App)
    expect(result).toEqual({ restored: true, errors: [] })
    expect(app.loadLocalStorage('abele-sync-connection')).toBeNull()
    expect(mock.connection.value).toEqual(emptyConnection(true))
    expect(app.loadLocalStorage('task14-isolated-fixture')).toBeNull()
  })
  it('does not forget/delete an original database on a second restore after layout failure', async () => {
    const app = await setup()
    await fixture(app)
    ;(app.workspace as any).changeLayout.mockRejectedValueOnce(new Error('layout failure'))
    expect((await restoreFixtureContext(app as unknown as App)).restored).toBe(false)
    expect((await restoreFixtureContext(app as unknown as App)).restored).toBe(true)
    expect(mock.forget).toHaveBeenCalledTimes(1)
    expect((await factory.databases()).map((d) => d.name)).toContain('abele-sync-sample-original')
    const db = await IndexedDbStateStore.open(factory, 'abele-sync-sample-original')
    expect(await db.getMeta('preserved')).toBe('original ledger bytes')
    db.close()
  })
  it('keeps stored scripts execution-blocked between isolation and an unsuccessful join', async () => {
    const app = await setup()
    await expect(scriptForExecution(app as unknown as App, 'Scripts/sample.js')).rejects.toThrow(
      /provenance|recovery|blocked/
    )
    await prepareFixtureContext(app as unknown as App, 'FixtureRecovery')
    await expect(scriptForExecution(app as unknown as App, 'Scripts/sample.js')).rejects.toThrow(
      /fixture|context|blocked|recovery/i
    )
  })
  it('fences a previously captured local snapshot synchronously before compilation', async () => {
    const app = buildFakeVault([
      { path: 'Scripts/local.js', content: '// @name Local sample\nreturn "local"' },
    ])
    ;(app.workspace as any).getLayout = () => ({})
    ;(app.workspace as any).changeLayout = vi.fn(async () => {})
    const snapshot = await scriptForExecution(app as unknown as App, 'Scripts/local.js')
    await prepareFixtureContext(app as unknown as App, 'FixtureRecovery')
    expect(() => assertScriptContext(app as unknown as App, snapshot)).toThrow(/context|blocked/)
  })
  it('preserves the pending revoke queue when forget cannot reach the server', async () => {
    const app = await setup()
    await fixture(app)
    const original = {
      ...emptyConnection(),
      selective: { ...emptyConnection().selective, images: false },
      migrated: true,
    }
    app.saveLocalStorage('task14-test-original', original)
    // The original record was captured before isolation; replace its empty snapshot for this test.
    const backup = app.loadLocalStorage('task14-isolated-fixture') as any
    backup.local['abele-sync-connection'] = original
    app.saveLocalStorage('task14-isolated-fixture', backup)
    const pending = {
      serverUrl: 'https://sync.example',
      deviceId: 'sample-device',
      deviceName: 'Sample',
      tokenId: 'abele-sync-device-revoke-sample',
      since: '2026-01-01T00:00:00.000Z',
      plainHttp: false,
    }
    mock.forget.mockImplementation(async () => {
      mock.connection.value = { vaultId: '', deviceTokenId: '', pendingRevoke: [pending] }
      app.saveLocalStorage('abele-sync-connection', {
        ...emptyConnection(),
        pendingRevoke: [pending],
      })
      app.saveLocalStorage('abele-sync-ledger', null)
    })
    await restoreFixtureContext(app as unknown as App)
    expect(readConnection(app).pendingRevoke).toEqual([pending])
    expect(readConnection(app).selective.images).toBe(false)
    expect(mock.connection.value.pendingRevoke).toEqual([pending])
  })
  it('rehydrates the running keeper so the next settings save cannot overwrite originals', async () => {
    const app = await setup()
    const original = {
      ...emptyConnection(),
      selective: { ...emptyConnection().selective, images: false, audio: false },
      migrated: true,
    }
    app.saveLocalStorage('abele-sync-connection', original)
    await fixture(app)
    mock.connection.value = {
      ...emptyConnection(),
      selective: { ...emptyConnection().selective, images: true, audio: true },
    } as any
    expect((await restoreFixtureContext(app as unknown as App)).restored).toBe(true)
    expect(mock.keeper.read).toHaveBeenCalledWith(app)
    expect((mock.connection.value as any).selective.images).toBe(false)
    app.saveLocalStorage('abele-sync-connection', {
      ...mock.connection.value,
      deviceName: 'Changed only name',
    })
    expect(readConnection(app).selective.audio).toBe(false)
  })
})
