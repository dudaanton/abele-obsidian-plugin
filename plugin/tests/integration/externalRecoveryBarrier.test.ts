import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { SyncEngine } from '@abele/sync-core'
import { AbeleConfig } from '@/services/AbeleConfig'
import { buildEngine, type EngineRecipe } from '@/sync/engineBuild'
import { EngineRunner } from '@/sync/engineRunner'
import { IndexedDbStateStore, stateDatabaseName } from '@/sync/IndexedDbStateStore'
import { emptyConnection, writeConnection } from '@/sync/connection'
import { authorizeLedgerBootstrap, requireLedger } from '@/sync/ledgerRecovery'
import { writeLedgerId } from '@/sync/ledgerId'
import { ExternalState } from '@/sync/external/state'
import { personalExternalBinding } from '@/sync/external/pluginSafety'
import { StatusBoard } from '@/sync/statusBoard'
import { useVault } from '../helpers/testEnv'
import { SCRIPT_SENTINEL, SCRIPT_TRUST_KEY } from '@/scripting/trust/scriptTrustStorage'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'

const ledger = { stateId: 'sample-ledger', vaultId: 'sample-vault' }
const bindings = {
  endpoint: 'https://sync.example.invalid',
  vaultId: ledger.vaultId,
  mode: 'personal' as const,
  principalId: 'sample-device',
  principalType: 'device' as const,
  grantId: null,
  generation: 1,
  credentialAssociation: 'sample-credential',
}
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})
async function fixture(extraPath?: string) {
  AbeleConfig.getInstance().applySettings()
  const app = useVault([
    { path: 'Media/sample.bin', content: 'sample original' },
    ...(extraPath ? [{ path: extraPath, content: 'ordinary bytes' }] : []),
  ])
  const factory = new IDBFactory()
  const fetcher = vi.fn(async () => {
    throw new Error('Unexpected network before recovery')
  })
  const connection = {
    ...emptyConnection(),
    serverUrl: bindings.endpoint,
    enrolledUrl: bindings.endpoint,
    vaultId: ledger.vaultId,
    deviceId: bindings.principalId,
    deviceTokenId: 'abele-sync-device-sample',
  }
  writeConnection(app, connection)
  writeLedgerId(app, ledger)
  authorizeLedgerBootstrap(app, ledger)
  const store = await IndexedDbStateStore.open(factory, stateDatabaseName(ledger.stateId))
  await requireLedger(app, store, ledger)
  cleanups.push(() => store.close())
  const host = {
    app: () => app,
    connection: () => connection,
    token: () => 'absd_sample',
    damage: () => null,
    deps: () => ({ indexedDB: factory, fetch: fetcher, WebSocket: class {} as never }),
    manifest: () => ({ id: 'abele' }),
    serialise: async <T>(fn: () => Promise<T>) => fn(),
    settingsArrived: () => {},
    settingsMeaning: async () => '{}',
    joined: () => {},
    synced: () => {},
  }
  const board = new StatusBoard()
  const recipe = {
    app,
    host,
    board,
    connection,
    token: 'absd_sample',
    ignoreText: null,
    join: null,
    noticed: () => {},
    closedElsewhere: () => {},
  } as unknown as EngineRecipe
  const build = async () => {
    const built = await buildEngine(recipe)
    cleanups.push(async () => {
      await built.engine.stop()
      built.store.close()
    })
    return built
  }
  return { app, factory, store, host, board, recipe, fetcher, build }
}
async function pending(s: Awaited<ReturnType<typeof fixture>>) {
  const binding = await personalExternalBinding(s.app, s.recipe.connection, s.recipe.token)
  const state = await ExternalState.open(s.store, ledger.stateId, binding)
  await state.commit({
    expectedRevision: 0,
    operations: [
      {
        expectedRevision: null,
        next: {
          schema: 1,
          operationId: 'sample-eviction',
          kind: 'eviction',
          phase: 'delete-ready',
          revision: 0,
          connectionGeneration: 1,
          expected: {
            fileId: 'sample-file',
            versionId: 'sample-version',
            path: 'Media/sample.bin',
            sha: 'a'.repeat(64),
            size: 15,
          },
          sourcePath: 'Media/sample.bin',
          targetPath: 'Media/sample.bin.abele-ref',
          previousRepresentation: 'hydrated',
          localBase: null,
          desiredRepresentation: 'remote-only',
          projectionDigest: 'b'.repeat(64),
          ownedArtifacts: [],
          unresolvedOutcome: 'delete outcome unknown',
          cleanupReason: null,
        },
      },
    ],
  })
}

describe('external recovery before ordinary engine activation', () => {
  it('does not impose a configuration-directory depth limit on ordinary content folders', async () => {
    const s = await fixture('Nested/'.repeat(40) + 'sample.md')
    s.store.close()
    const built = await s.build()
    expect(built.store.permitsEngineEffects).toBe(true)
    expect(s.fetcher).not.toHaveBeenCalled()
  })
  it('does not overwrite successor provenance when a first build loses ownership during sentinel inspection', async () => {
    const s = await fixture()
    s.store.close()
    let resume = () => {},
      inspected = () => {},
      first = true
    const waiting = new Promise<void>((resolve) => {
        resume = resolve
      }),
      entered = new Promise<void>((resolve) => {
        inspected = resolve
      })
    const exists = s.app.vault.adapter.exists.bind(s.app.vault.adapter)
    vi.spyOn(s.app.vault.adapter, 'exists').mockImplementation(async (path, ...args) => {
      if (path === SCRIPT_SENTINEL && first) {
        first = false
        inspected()
        await waiting
      }
      return exists(path, ...args)
    })
    const writes = vi.spyOn(s.app.vault.adapter, 'writeBinary')
    const firstBuild = s.build().then(
      () => null,
      (error) => error
    )
    await entered
    await s.build()
    const descriptor = s.app.loadLocalStorage(SCRIPT_TRUST_KEY)
    resume()
    expect(await firstBuild).toBeInstanceOf(Error)
    expect(s.app.loadLocalStorage(SCRIPT_TRUST_KEY)).toEqual(descriptor)
    expect(writes.mock.calls.filter(([path]) => path === SCRIPT_SENTINEL)).toHaveLength(1)
  })

  it('completes installation recovery before creating script provenance state or sentinel', async () => {
    const s = await fixture()
    s.store.close()
    const recover = vi
      .spyOn(ObsidianFileSystem.prototype, 'recover')
      .mockImplementation(async () => {
        expect(s.app.loadLocalStorage(SCRIPT_TRUST_KEY)).toBeNull()
        expect(await s.app.vault.adapter.exists(SCRIPT_SENTINEL)).toBe(false)
        throw new Error('sample installation recovery hold')
      })
    await expect(s.build()).rejects.toThrow('sample installation recovery hold')
    expect(recover).toHaveBeenCalledOnce()
    expect(s.app.loadLocalStorage(SCRIPT_TRUST_KEY)).toBeNull()
  })

  it('does not construct scope work or activate publication/replay over an unresolved external journal', async () => {
    const s = await fixture()
    await pending(s)
    s.store.close()
    const scope = vi.spyOn(SyncEngine.prototype, 'recordScope')
    const publication = vi.fn()
    s.host.deps = () => ({
      indexedDB: s.factory,
      fetch: s.fetcher,
      WebSocket: class {} as never,
      ownerPublication: publication,
    })
    await expect(s.build()).rejects.toThrow(/recovery|external/i)
    expect(scope).not.toHaveBeenCalled()
    expect(publication).not.toHaveBeenCalled()
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('holds every runner mutation, including rescan, delete decisions and deferred apply/keep, before recovery', async () => {
    const s = await fixture()
    await pending(s)
    s.store.close()
    const scope = vi.spyOn(SyncEngine.prototype, 'recordScope')
    const runner = new EngineRunner(s.host as never, s.board)
    cleanups.push(() => runner.teardown())
    await runner.reconcile()
    expect(runner.client()).toBeNull()
    expect(runner.isRunning()).toBe(false)
    await runner.rescan()
    expect(await runner.decideDeletes('restore', ['sample-file'])).toBeNull()
    expect(await runner.applyDeferred(['sample-version'])).toBeNull()
    expect(await runner.keepLocal(undefined, ['sample-version'])).toBeNull()
    expect(scope).not.toHaveBeenCalled()
    expect(s.board.status.value.lastError).toMatch(/recovery|external/i)
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('fences a retained Restore client after the runtime ledger loses ownership', async () => {
    const s = await fixture()
    s.store.close()
    const built = await s.build()
    built.store.close()
    await expect(built.vault.restore('sample-file', 'sample-version')).rejects.toThrow(
      /ownership|held|recovery/i
    )
    await expect(built.vault.restoreDeleted('sample-file')).rejects.toThrow(
      /ownership|held|recovery/i
    )
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('rechecks ownership after awaited inspection immediately before a filesystem removal', async () => {
    const s = await fixture()
    s.store.close()
    const built = await s.build()
    const original = s.app.vault.adapter.stat.bind(s.app.vault.adapter)
    vi.spyOn(s.app.vault.adapter, 'stat').mockImplementation(async (path) => {
      const value = await original(path)
      if (path === 'Media/sample.bin') built.store.close()
      return value
    })
    await expect(
      Promise.resolve().then(() => (built.engine as any).opts.fs.remove('Media/sample.bin'))
    ).rejects.toThrow(/ownership|held|recovery/i)
    expect(await s.app.vault.adapter.read('Media/sample.bin')).toBe('sample original')
  })

  it('a successor claim fences an older runtime even while both database handles remain open', async () => {
    const s = await fixture()
    s.store.close()
    const first = await s.build()
    const next = await s.build()
    await expect(first.vault.restore('sample-file', 'sample-version')).rejects.toThrow(
      /ownership|held|recovery/i
    )
    await expect(
      Promise.resolve().then(() => (first.engine as any).opts.fs.remove('Media/sample.bin'))
    ).rejects.toThrow(/ownership|held|recovery/i)
    expect(next.store.permitsEngineEffects).toBe(true)
    expect(s.fetcher).not.toHaveBeenCalled()
    expect(await s.app.vault.adapter.read('Media/sample.bin')).toBe('sample original')
  })

  it('does not issue later upload parts after ownership is lost during an earlier request', async () => {
    const s = await fixture()
    s.store.close()
    let built: Awaited<ReturnType<typeof buildEngine>>
    s.fetcher.mockImplementation(async (input: any) => {
      if (String(input).endsWith('/upload'))
        return new Response(
          JSON.stringify({ upload_id: 'sample-upload', part_size: 8 * 1024 * 1024, parts: 2 })
        )
      if (String(input).endsWith('/0')) built.store.close()
      return new Response('{}')
    })
    built = await s.build()
    await expect(
      built.vault.putBlob('a'.repeat(64), new Uint8Array(9 * 1024 * 1024))
    ).rejects.toThrow()
    expect(s.fetcher).toHaveBeenCalledTimes(2)
  })

  it('holds an unreadable publication journal before constructor scope changes', async () => {
    const s = await fixture()
    await s.store.setJournal({ batchId: '', ops: [], idempotencyKey: '', startedAt: '' })
    s.store.close()
    const scope = vi.spyOn(SyncEngine.prototype, 'recordScope')
    await expect(s.build()).rejects.toThrow(/journal|recovery|external/i)
    expect(scope).not.toHaveBeenCalled()
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('uses the durable connection descriptor at each effect, not a stale host snapshot', async () => {
    const s = await fixture()
    s.store.close()
    const built = await s.build()
    writeConnection(s.app, { ...s.recipe.connection, deviceId: 'sample-other-principal' })
    await expect(built.vault.restore('sample-file', 'sample-version')).rejects.toThrow(
      /ownership|held|recovery/i
    )
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('never spends a fresh bootstrap grant over a recognizable renamed projection', async () => {
    const s = await fixture()
    s.store.close()
    await IndexedDbStateStore.delete(s.factory, stateDatabaseName(ledger.stateId))
    authorizeLedgerBootstrap(s.app, ledger)
    await s.app.vault.adapter.write(
      'Media/sample-moved.txt',
      JSON.stringify({
        format: 'abele.external',
        schema: 1,
        vaultId: ledger.vaultId,
        fileId: 'sample-file',
        path: 'Media/sample.bin',
        observedVersionId: 'sample-version',
        sha256: 'a'.repeat(64),
        size: 15,
        mime: 'application/octet-stream',
        mtime: 1000,
      })
    )
    await expect(s.build()).rejects.toThrow(/recovery|external|projection/i)
    expect(s.fetcher).not.toHaveBeenCalled()
  })
})
