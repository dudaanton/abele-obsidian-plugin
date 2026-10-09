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
import { sha256 } from '@abele/sync-core'
import { AttachmentStore } from '@/sync/external/attachmentStore'
import { ExternalFileHost } from '@/sync/external/ObsidianExternalFileHost'
import { activateExternalFiles } from '@/sync/external/pluginSafety'
import { EXTERNAL_RETIRED_KEY } from '@/sync/external/connectionSwitch'
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
  it('scoped Leave retains its databases after materialized departure', async () => {
    const app = useVault([]),
      factory = new IDBFactory()
    setSecrets(null)
    AbeleConfig.getInstance().applySettings()
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
    const token = 'absi_' + 'a'.repeat(43),
      road = scopedSecretPort(secrets())
    road.set(c.tokenId, token)
    road.set(c.tokenId + ':binding', JSON.stringify({ connection: c, token }))
    app.saveLocalStorage(SCOPED_CONNECTION_KEY, c)
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ revoked: true })))
    const host = new ScopedPluginHost(app, fetcher as never, factory)
    cleanup.push(() => host.close())
    const r = await (host as any).open(c, true)
    const state = await activateExternalFiles(
      app,
      r.raw,
      c.ledgerId,
      'abele-scoped-' + c.ledgerId,
      r.binding,
      () => r.fence.assertReady()
    )
    const bytes = new TextEncoder().encode('sample materialized bytes'),
      path = 'Media/sample.bin'
    await app.vault.createFolder('Media')
    await app.vault.adapter.writeBinary(path, bytes.buffer)
    const base = {
      fileId: 'sample-file',
      versionId: 'sample-v1',
      path,
      sha: await sha256(bytes),
      size: bytes.length,
      mtime: 1000,
    }
    await r.raw.put({ ...base, wirePath: path })
    await state.commit({
      expectedRevision: 0,
      files: [
        {
          expectedRevision: null,
          next: {
            schema: 1,
            ledgerId: c.ledgerId,
            binding: r.binding,
            fileId: base.fileId,
            representation: 'hydrated',
            preference: 'on-demand',
            pinned: false,
            projectionPath: null,
            projectionSha: null,
            localRevision: 0,
            pendingOperationId: null,
            availability: 'active',
            blockingReason: null,
            lastProvenLocalBase: base,
            retained: [],
          },
        },
      ],
    })
    const api = await host.attachments()
    expect((await api.materializeForDisconnect({ operationId: 'sample-departure' })).status).toBe(
      'complete'
    )
    await host.leave()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(app.loadLocalStorage(SCOPED_CONNECTION_KEY)).toBeNull()
    expect(road.get(c.tokenId)).toBe('')
    expect(await factory.databases()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'abele-scoped-' + c.ledgerId }),
        expect.objectContaining({ name: 'abele-scoped-native-' + c.ledgerId }),
      ])
    )
    expect(new Uint8Array(await app.vault.adapter.readBinary(path))).toEqual(bytes)
  })
  it.each(['disconnect', 'chooseVault', 'import'] as const)(
    '%s completes after preparation while retaining the predecessor ledger',
    async (verb) => {
      const s = await personal()
      const document = s.before,
        file = document.files[0],
        path = 'Media/sample.bin'
      const bytes = new TextEncoder().encode('sample materialized bytes')
      await s.app.vault.createFolder('Media')
      await s.app.vault.adapter.writeBinary(path, bytes.buffer)
      const base = {
        fileId: file.fileId,
        versionId: 'sample-v1',
        path,
        sha: await sha256(bytes),
        size: bytes.length,
        mtime: 1000,
      }
      await s.target.put({ ...base, wirePath: path })
      const state = await activateExternalFiles(
        s.app,
        s.target,
        s.ledger.stateId,
        stateDatabaseName(s.ledger.stateId),
        document.binding,
        () => {}
      )
      await state.commit({
        expectedRevision: document.revision,
        files: [
          {
            expectedRevision: file.localRevision,
            next: {
              ...file,
              localRevision: file.localRevision + 1,
              representation: 'hydrated',
              projectionPath: null,
              projectionSha: null,
              blockingReason: null,
              lastProvenLocalBase: base,
            },
          },
        ],
      })
      const host = new ExternalFileHost(s.app, { platform: 'mobile', assertOwned: () => {} })
      cleanup.push(() => host.close())
      const api = new AttachmentStore({
        state,
        ledger: s.target,
        host,
        binding: document.binding,
        serial: { run: async (work) => work() },
        assertOwned: () => {},
        sync: async () => {},
        verify: async () => {
          throw Error('unexpected verification')
        },
        download: async () => {
          throw Error('unexpected download')
        },
        scriptsFolder: () => 'Scripts',
      })
      expect((await api.materializeForDisconnect({ operationId: 'sample-departure' })).status).toBe(
        'complete'
      )
      if (verb === 'disconnect') await s.enrolment.disconnect()
      else if (verb === 'chooseVault')
        await s.enrolment.chooseVault('sample-target', 'Sample device')
      else
        await s.enrolment.adoptTransferred(
          {
            serverUrl: s.own.serverUrl,
            vaultId: 'sample-target',
            vaultName: 'Sample vault',
            deviceId: 'sample-import',
            deviceName: 'Sample device',
          },
          'absd_sample_import',
          s.own.selective
        )
      expect(s.app.loadLocalStorage(EXTERNAL_RETIRED_KEY)).not.toBeNull()
      const reopened = await IndexedDbStateStore.open(
        s.factory,
        stateDatabaseName(s.ledger.stateId)
      )
      try {
        expect(JSON.parse((await reopened.getExternalState())!).files[0].representation).toBe(
          'hydrated'
        )
      } finally {
        reopened.close()
      }
      expect(new Uint8Array(await s.app.vault.adapter.readBinary(path))).toEqual(bytes)
      if (verb !== 'disconnect') {
        expect(s.keeper.connection.value.vaultId).toBe('sample-target')
        expect(s.keeper.connection.value.deviceTokenId).not.toBe(s.own.deviceTokenId)
        expect(s.keeper.connection.value.pendingRevoke.length).toBe(1)
        expect(s.fetcher).not.toHaveBeenCalled()
        expect(readLedgerId(s.app).stateId).not.toBe(s.ledger.stateId)
      }
    }
  )
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

  it('Forget without telling the server checks orphan projections before deleting the last pending token', async () => {
    const s = await personal()
    await s.target.setMeta('external-files', null)
    await s.app.vault.adapter.write('sample-moved.txt', '{"format":"abele.external", broken')
    const tokenId = 'abele-sync-device-revoke-sample'
    bindDeviceToken(secrets().device, tokenId, 'absd_sample_last', s.own.serverUrl)
    s.keeper.save({
      pendingRevoke: [
        {
          tokenId,
          serverUrl: s.own.serverUrl,
          deviceId: s.own.deviceId,
          deviceName: 'Sample device',
          since: new Date().toISOString(),
          plainHttp: false,
        },
      ],
    })
    secrets().device.remove(s.own.deviceTokenId)
    await expect(Promise.resolve().then(() => s.enrolment.revoker.forget(tokenId))).rejects.toThrow(
      /external|recovery/i
    )
    expect(secrets().device.get(tokenId)).toBe('absd_sample_last')
    expect(s.keeper.connection.value.pendingRevoke).toHaveLength(1)
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('runs one inventory per successful Disconnect rather than scanning four times', async () => {
    const s = await personal()
    await s.target.setMeta('external-files', null)
    await s.app.vault.adapter.write('sample.md', 'ordinary content')
    const list = vi.spyOn(s.app.vault.adapter, 'list'),
      read = vi.spyOn(s.app.vault.adapter, 'readBinary')
    await s.enrolment.disconnect()
    expect(list).toHaveBeenCalledTimes(2) // one evidence inventory plus publication catalogue listing
    expect(read).toHaveBeenCalledOnce()
  })

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
