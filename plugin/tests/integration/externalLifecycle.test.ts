import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Enrolment } from '@/sync/enrolment'
import { ConnectionKeeper } from '@/sync/connectionKeeper'
import { SyncService } from '@/sync/SyncService'
import { emptyConnection, writeConnection, CONNECTION_KEY } from '@/sync/connection'
import { writeLedgerId, readLedgerId } from '@/sync/ledgerId'
import { authorizeLedgerBootstrap, requireLedger } from '@/sync/ledgerRecovery'
import { IndexedDbStateStore, stateDatabaseName } from '@/sync/IndexedDbStateStore'
import { rememberLedgerCleanup } from '@/sync/ledgerCleanup'
import { ExternalState } from '@/sync/external/state'
import { ScopedPluginHost } from '@/sync/scoped/scopedPluginHost'
import { SCOPED_CONNECTION_KEY, type ScopedLocalConnection } from '@/sync/scoped/scopedJoin'
import { scopedSecretPort } from '@/sync/scoped/scopedSecretSlots'
import { AbeleConfig } from '@/services/AbeleConfig'
import { bindDeviceToken } from '@/secrets/deviceSecret'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { useVault } from '../helpers/testEnv'

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
  vi.restoreAllMocks()
  setSecrets(null)
})
async function external(
  store: IndexedDbStateStore,
  id: string,
  mode: 'personal' | 'scoped' = 'personal',
  availability: 'active' | 'deleted' | 'detached' | 'unavailable' = 'active'
) {
  const binding = {
    endpoint: 'https://sync.example.invalid',
    vaultId: 'sample-vault',
    mode,
    principalId: 'sample-principal',
    principalType: mode === 'scoped' ? ('installation' as const) : ('device' as const),
    grantId: mode === 'scoped' ? 'sample-grant' : null,
    generation: 1,
    credentialAssociation: 'sample-slot',
  }
  const state = await ExternalState.open(store, id, binding)
  await state.commit({
    expectedRevision: 0,
    files: [
      {
        expectedRevision: null,
        next: {
          schema: 1,
          ledgerId: id,
          binding,
          fileId: 'sample-file',
          representation: 'remote-only',
          preference: 'on-demand',
          pinned: false,
          projectionPath: 'Media/sample.bin.abele-ref',
          projectionSha: 'b'.repeat(64),
          localRevision: 0,
          pendingOperationId: null,
          availability,
          blockingReason: 'recovery-required',
          lastProvenLocalBase: null,
          retained: [],
        },
      },
    ],
  })
  return state.snapshot()
}
async function personal(retired = false) {
  const app = useVault([])
  setSecrets(null)
  AbeleConfig.getInstance().applySettings()
  const factory = new IDBFactory()
  const own = {
    ...emptyConnection(),
    serverUrl: 'https://sync.example.invalid',
    enrolledUrl: 'https://sync.example.invalid',
    vaultId: 'sample-vault',
    deviceId: 'sample-principal',
    deviceTokenId: 'abele-sync-device-sample',
  }
  bindDeviceToken(secrets().device, own.deviceTokenId, 'absd_sample', own.serverUrl)
  writeConnection(app, own)
  const keeper = new ConnectionKeeper(() => {})
  keeper.read(app)
  const ledger = { stateId: 'sample-ledger', vaultId: own.vaultId }
  writeLedgerId(app, ledger)
  authorizeLedgerBootstrap(app, ledger)
  const store = await IndexedDbStateStore.open(factory, stateDatabaseName(ledger.stateId))
  await requireLedger(app, store, ledger)
  cleanup.push(() => store.close())
  let target = store
  if (retired) {
    target = await IndexedDbStateStore.open(factory, stateDatabaseName('sample-retired'))
    rememberLedgerCleanup(app, 'sample-retired')
    cleanup.push(() => target.close())
  }
  const before = await external(target, retired ? 'sample-retired' : ledger.stateId)
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ revoked: true })))
  const host = {
    app: () => app,
    factory: () => factory,
    transport: () => fetcher,
    note: () => {},
    connection: () => keeper.connection.value,
    saveConnection: keeper.save.bind(keeper),
    serialise: async <T>(fn: () => Promise<T>) => fn(),
    teardown: async () => {
      store.close()
      target.close()
    },
    reconcile: vi.fn(async () => {}),
  }
  const enrolment = new Enrolment(host as never)
  const enrol = vi.fn(async () => ({
    device_id: 'sample-new-device',
    device_token: 'absd_sample_new',
  }))
  ;(enrolment as any).account = { enrolDevice: enrol }
  ;(enrolment as any).accountUrl = own.serverUrl
  return { app, factory, own, ledger, keeper, target, before, fetcher, host, enrolment, enrol }
}

describe('external dependency lifecycle refusals', () => {
  it.each(['disconnect', 'forget', 'chooseVault', 'import'] as const)(
    '%s preserves credentials, descriptor and durable inventory before any revoke/enrol',
    async (verb) => {
      const s = await personal()
      const descriptor = s.app.loadLocalStorage(CONNECTION_KEY)
      const run =
        verb === 'chooseVault'
          ? s.enrolment.chooseVault('other-vault', 'Sample device')
          : verb === 'import'
            ? s.enrolment.adoptTransferred(
                {
                  serverUrl: s.own.serverUrl,
                  vaultId: 'other-vault',
                  vaultName: 'Sample vault',
                  deviceId: 'sample-import',
                  deviceName: 'Sample device',
                },
                'absd_sample_import',
                s.own.selective
              )
            : s.enrolment[verb]()
      await expect(run).rejects.toThrow(/external|recovery|preparation/i)
      expect(s.fetcher).not.toHaveBeenCalled()
      expect(s.enrol).not.toHaveBeenCalled()
      expect(secrets().device.get(s.own.deviceTokenId)).toBe('absd_sample')
      expect(s.app.loadLocalStorage(CONNECTION_KEY)).toEqual(descriptor)
      expect(readLedgerId(s.app)).toEqual(s.ledger)
      const reopened = await IndexedDbStateStore.open(
        s.factory,
        stateDatabaseName(s.ledger.stateId)
      )
      try {
        expect(JSON.parse((await reopened.getExternalState())!)).toEqual(s.before)
      } finally {
        reopened.close()
      }
    }
  )

  it('retained installation evidence is part of the shared inventory even without an external document', async () => {
    const s = await personal()
    await s.target.setMeta('external-files', null)
    s.app.saveLocalStorage('abele-sync-recovered-writes', [
      { target: 'Media/sample.bin', backup: 'Media/.abele-sync-abcd1234.old' },
    ])
    await expect(s.enrolment.forget()).rejects.toThrow(/external|recovery|preparation/i)
    expect(s.fetcher).not.toHaveBeenCalled()
    expect(secrets().device.get(s.own.deviceTokenId)).toBe('absd_sample')
    expect(s.app.loadLocalStorage('abele-sync-recovered-writes')).not.toBeNull()
  })

  it('does not install credentials from an enrollment that returns after its host was retired', async () => {
    const s = await personal()
    await s.target.setMeta('external-files', null)
    let active = true,
      answer = (_value: { device_id: string; device_token: string }) => {}
    ;(s.host as any).stillCurrent = () => active
    s.enrol.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    const choosing = s.enrolment.chooseVault('other-vault', 'Sample device')
    await vi.waitFor(() => expect(s.enrol).toHaveBeenCalledOnce())
    active = false
    answer({ device_id: 'other-device', device_token: 'absd_other' })
    await expect(choosing).rejects.toThrow(/closed|changed|recovery/i)
    expect(secrets().device.get(s.own.deviceTokenId)).toBe('absd_sample')
    expect(readLedgerId(s.app)).toEqual(s.ledger)
    expect((s.app.loadLocalStorage(CONNECTION_KEY) as any).deviceId).toBe(s.own.deviceId)
  })

  it('includes deferred-retirement ledgers in the same gate before Forget revokes the current connection', async () => {
    const s = await personal(true)
    await expect(s.enrolment.forget()).rejects.toThrow(/external|recovery|preparation/i)
    expect(s.fetcher).not.toHaveBeenCalled()
    expect(secrets().device.get(s.own.deviceTokenId)).toBe('absd_sample')
    expect(await s.factory.databases()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: stateDatabaseName('sample-retired') }),
      ])
    )
  })

  it('service-level vault replacement cannot save a new binding over unresolved state', async () => {
    const s = await personal()
    s.target.close()
    const service = SyncService.getInstance()
    service.init(
      s.app as never,
      { manifest: { id: 'abele' }, registerDomEvent: () => {} } as never,
      { indexedDB: s.factory, fetch: s.fetcher as never, WebSocket: class {} as never }
    )
    cleanup.push(() => service.destroy())
    await expect(
      service.updateConnection({ vaultId: 'other-vault', deviceId: 'other-device' })
    ).rejects.toThrow(/external|recovery|preparation/i)
    expect(readLedgerId(s.app)).toEqual(s.ledger)
    expect((s.app.loadLocalStorage(CONNECTION_KEY) as any).vaultId).toBe(s.own.vaultId)
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('a retained activation/switch marker also fences synchronous connection edits before a replacement can be saved', async () => {
    const s = await personal()
    for (const key of [
      'abele-sync-external-activation-v1',
      'abele-sync-external-connection-switch-v1',
    ]) {
      s.app.saveLocalStorage(key, { interrupted: true })
      expect(() => s.keeper.save({ vaultId: 'other-vault' })).toThrow(
        /external|recovery|preparation/i
      )
      s.app.saveLocalStorage(key, null)
    }
    expect(s.keeper.connection.value.vaultId).toBe(s.own.vaultId)
  })

  it.each(['active', 'deleted', 'detached', 'unavailable'] as const)(
    'scoped Leave retains %s dependencies even when the host was closed or access was removed',
    async (availability) => {
      const app = useVault([])
      setSecrets(null)
      AbeleConfig.getInstance().applySettings()
      const factory = new IDBFactory()
      const c: ScopedLocalConnection = {
        version: 4,
        facet: 'scoped',
        issuer: 'https://sync.example.invalid',
        vaultId: 'sample-vault',
        grantId: 'sample-grant',
        memberId: 'sample-member',
        principalId: 'sample-principal',
        principalKind: 'installation',
        role: 'reader',
        rootFileId: 'sample-root',
        tokenId: 'abele-scoped-installation-sample',
        ledgerId: 'sample-scoped-ledger',
        scriptPolicy: 'refuse',
      }
      const token = 'absi_' + 'a'.repeat(43)
      const road = scopedSecretPort(secrets())
      road.set(c.tokenId, token)
      road.set(c.tokenId + ':binding', JSON.stringify({ connection: c, token }))
      app.saveLocalStorage(SCOPED_CONNECTION_KEY, c)
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ revoked: true })))
      const host = new ScopedPluginHost(app as never, fetcher as never, factory)
      cleanup.push(() => host.close())
      const r = await (host as any).open(c, true)
      const before = await external(r.raw, c.ledgerId, 'scoped', availability)
      await host.close()
      const cold = new ScopedPluginHost(app as never, fetcher as never, factory)
      cleanup.push(() => cold.close())
      if (availability !== 'active') cold.accessRemoved.value = 'Sample access unavailable'
      await expect(cold.leave()).rejects.toThrow(/external|recovery|preparation/i)
      expect(fetcher).not.toHaveBeenCalled()
      expect(road.get(c.tokenId)).toBe(token)
      expect(app.loadLocalStorage(SCOPED_CONNECTION_KEY)).toEqual(c)
      const raw = await IndexedDbStateStore.open(factory, 'abele-scoped-' + c.ledgerId)
      try {
        expect(JSON.parse((await raw.getExternalState())!)).toEqual(before)
      } finally {
        raw.close()
      }
    }
  )
})
