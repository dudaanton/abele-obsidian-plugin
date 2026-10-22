import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Plugin } from 'obsidian'
import {
  resetSyncTokenState,
  captureSyncTokenOwnership,
} from '../../src/testing/resetSyncTokenState'
import { TokenConnectionRegistry, TOKEN_REGISTRY_KEY } from '../../src/sync/tokenConnectionRegistry'
import { IndexedDbStateStore } from '../../src/sync/IndexedDbStateStore'
import { openDeviceReviews } from '../../src/sync/openDeviceReviews'
import { TokenUi } from '../../src/sync/tokenUi'
import { sha256 } from '@abele/sync-sdk/core'
import { EXTERNAL_ACTIVATION_KEY } from '@/sync/external/recovery'
import { tokenExternalBinding } from '@/sync/tokenExternalBinding'
import { buildFakeVault } from '../helpers/fakeVault'
import { projectionEvidence } from '@/sync/external/pluginSafety'
import { EXTERNAL_STATE_KEY } from '@/sync/external/state'
import { tokenOffloadsOf } from '@/sync/tokenOffloadCoordinator'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import { HostSyncStorage, inheritHostStorage } from '@/sync/hostSyncStorage'
import { SETS_KEY } from '@/sync/connectionSets'
vi.mock('../../src/sync/tokenEngines', () => ({
  TokenEngines: class {
    start() {}
  },
}))

const cases = [false, true, 'unresolved'] as const
it('refuses to clear offload state while a provider still owns it', () => {
  const vault = {}
  const manager = tokenOffloadsOf(vault, pathCoordinatorOf(vault))
  manager.remember('sample', [{ path: 'Media/sample.pdf', size: 1, mtime: 1 }], [])
  const close = manager.register('sample', {} as never)
  expect(() => manager.clearDrainedState()).toThrow('must be drained')
  expect(manager.files()).toHaveLength(1)
  close()
  manager.clearDrainedState()
  expect(manager.files()).toEqual([])
})

const resetCases = cases.flatMap((retry) => [false, true].map((durable) => ({ retry, durable })))
it.each(resetCases)('resets owned state ($retry/$durable)', async ({ retry, durable }) => {
  const factory = new IDBFactory()
  const descriptor = Object.getOwnPropertyDescriptor(window, 'indexedDB')
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: factory })
  const local = new Map<string, unknown>([['other-plugin', { keep: true }]])
  const keys = new Map<string, string>([['unrelated-key', 'keep']])
  const storage = {
    loadLocalStorage: (key: string) => local.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      local.set(key, structuredClone(value))
    },
  }
  let host = durable ? await HostSyncStorage.open(factory, 'sample-reset', storage) : undefined
  const registry = TokenConnectionRegistry.open(storage)
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, value: string) => {
      keys.set(id, value)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const id = registry.add()
  const scope = { kind: 'folder' as const, id: 'root', path: '/' }
  registry.attach(
    id,
    { v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope },
    { protocol: 2, token_id: 'token', space_id: 'space', status: 'active', scope },
    secrets
  )
  const record = registry.records()[0]
  await registry.flush()
  // Model a migrated installation whose compatibility copy still contains a connection.
  if (durable)
    storage.saveLocalStorage(TOKEN_REGISTRY_KEY, host!.loadLocalStorage(TOKEN_REGISTRY_KEY))
  local.set(EXTERNAL_ACTIVATION_KEY, {
    schema: 1,
    ledgers: [
      {
        ledgerId: record.ledgerId,
        databaseName: record.ledgerId,
        databaseIdentity: record.ledgerId,
        binding: await tokenExternalBinding(record, keys.get(record.secretReference)!),
        phase: 'active',
      },
    ],
  })
  const reviewId = crypto.randomUUID()
  local.set('abele-sync-device-review-id-v1', reviewId)
  const reviews = await openDeviceReviews(factory, reviewId)
  const ui = new TokenUi(registry, secrets, vi.fn(), reviews)
  registry.localStorage.saveLocalStorage(SETS_KEY, {
    version: 1,
    connections: [{ id, label: 'Sample share', items: [] }],
  })
  await registry.flush()
  const ledger = await IndexedDbStateStore.open(factory, record.ledgerId)
  const staging = '.obsidian/plugins/abele/sync-staging/.abele-external-sample-reset.incoming'
  const markerBytes = new TextEncoder().encode('{"format":"abele.external"}')
  await ledger.setMeta(
    EXTERNAL_STATE_KEY,
    JSON.stringify({
      schema: 1,
      revision: 1,
      ledgerId: record.ledgerId,
      binding: await tokenExternalBinding(record, keys.get(record.secretReference)!),
      files: [],
      operations: [
        {
          schema: 1,
          operationId: 'sample-reset',
          kind: 'disconnect-preparation',
          phase: retry === 'unresolved' ? 'disconnect-preparing' : 'complete',
          revision: 0,
          connectionGeneration: 1,
          expected: null,
          sourcePath: null,
          targetPath: null,
          previousRepresentation: null,
          localBase: null,
          desiredRepresentation: 'hydrated',
          projectionDigest: null,
          unresolvedOutcome: null,
          cleanupReason: null,
          ownedArtifacts: [
            {
              operationId: 'sample-reset',
              path: staging,
              role: 'projection',
              sha: await sha256(markerBytes),
              size: markerBytes.length,
            },
            {
              operationId: 'sample-reset',
              path: 'Notes/retained.bin',
              role: 'incoming',
              sha: await sha256(new TextEncoder().encode('keep retained')),
              size: 13,
            },
          ],
        },
      ],
    })
  )
  const copyName =
    'abele-local-edit-copies-' +
    id +
    '-' +
    (await sha256(
      new TextEncoder().encode(
        JSON.stringify([record.address, record.spaceId, record.tokenId, record.ledgerId])
      )
    ))
  const snapshots = await IndexedDbStateStore.open(factory, copyName)
  const reviewData = await IndexedDbStateStore.open(factory, 'abele-sync-reviews-' + reviewId)
  await reviewData.setMeta('token-attachment-consent-v1', 'stored accepted and denied decisions')
  await reviewData.setMeta('token-executable-review-v1', 'stored immutable pending bytes')
  reviewData.close()
  const unrelated = await IndexedDbStateStore.open(factory, 'another-vault-ledger')
  await unrelated.setMeta('keep', 'yes')
  const registered: (() => void)[] = []
  const fake = buildFakeVault([
    { path: 'note.md', content: 'keep' },
    { path: 'Notes/retained.bin', content: 'keep retained' },
    {
      path: staging,
      content:
        retry === 'unresolved' ? 'sample unique late edit' : new TextDecoder().decode(markerBytes),
    },
    {
      path: '.obsidian/plugins/abele/sync-staging/orphan.incoming',
      content: new TextDecoder().decode(markerBytes),
    },
    { path: '.obsidian/plugins/abele/sync-staging/unowned.bin', content: 'sample orphan bytes' },
  ])
  const vault = {
    ...fake.vault,
    getName: () => 'leased-pool',
    configDir: '.obsidian',
    notes: new Map([['note.md', 'keep']]),
  }
  let startupActive = true
  registry.setStatus(id, 'joining')
  ui.publish(id, { inspection: { completed: 0, total: 12000 } })
  const cancelStartup = vi.fn(() => {
    startupActive = false
  })
  const close = vi.fn(async () => {
    expect(startupActive).toBe(false)
    expect(registry.records()).toHaveLength(1)
    ledger.close()
    snapshots.close()
  })
  const plugin = {
    app: inheritHostStorage({ ...storage, vault }, storage),
    register: (callback: () => void) => registered.push(callback),
    tokenEngines: {
      ui,
      close,
      cancelStartup,
      scriptsFolder: 'Scripts',
      key: secrets.get,
      deps: {},
    },
  } as unknown as Plugin
  const manager = tokenOffloadsOf(vault, pathCoordinatorOf(vault))
  manager.remember('sample-old', [{ path: 'Media/sample.pdf', size: 1, mtime: 1 }], [])
  try {
    await captureSyncTokenOwnership(plugin, 'leased-pool')
    if (retry === true) {
      vi.spyOn(vault.adapter, 'rename').mockRejectedValueOnce(
        new Error('sample preservation failed')
      )
      await expect(
        resetSyncTokenState(plugin, { vault: 'leased-pool', confirm: 'reset-sync-token-state' })
      ).rejects.toThrow('sample preservation failed')
      expect((await factory.databases()).map((one) => one.name)).toContain(record.ledgerId)
      expect(registry.records()).toHaveLength(1)
      expect(local.get(EXTERNAL_ACTIVATION_KEY)).not.toBeNull()
      expect(await vault.adapter.exists(staging)).toBe(true)
    }
    await Promise.all([
      resetSyncTokenState(plugin, { vault: 'leased-pool', confirm: 'reset-sync-token-state' }),
      resetSyncTokenState(plugin, { vault: 'leased-pool', confirm: 'reset-sync-token-state' }),
    ])
    expect(cancelStartup).toHaveBeenCalledTimes(retry === true ? 2 : 1)
    expect(close).toHaveBeenCalledTimes(retry === true ? 2 : 1)
    expect(ui.activity.value).toEqual({})
    expect(tokenOffloadsOf(vault, pathCoordinatorOf(vault))).toBe(manager)
    expect(manager.files()).toEqual([])
    expect(ui.rows.value).toEqual([])
    expect(registry.records()).toEqual([])
    expect(ui.itemSets.store.all()).toEqual([])
    expect(storage.loadLocalStorage(TOKEN_REGISTRY_KEY)).toMatchObject({
      version: 2,
      selectedId: '',
      records: [],
    })
    expect(
      (storage.loadLocalStorage(TOKEN_REGISTRY_KEY) as { cleanup?: unknown[] }).cleanup ?? []
    ).toEqual([])
    expect(local.get(EXTERNAL_ACTIVATION_KEY)).toBeNull()
    expect(keys).toEqual(new Map([['unrelated-key', 'keep']]))
    expect(local.get('other-plugin')).toEqual({ keep: true })
    expect(vault.notes).toEqual(new Map([['note.md', 'keep']]))
    // A completed native offload leaves its hard-linked staging projection behind.
    // Resetting ownership without its bytes makes the next startup refuse recovery.
    await expect(projectionEvidence(plugin.app)).resolves.toBeNull()
    expect(await vault.adapter.exists(staging)).toBe(false)
    expect(await vault.adapter.read('note.md')).toBe('keep')
    expect(await vault.adapter.read('Notes/retained.bin')).toBe('keep retained')
    expect(await vault.adapter.exists('.obsidian/plugins/abele/sync-staging/unowned.bin')).toBe(
      false
    )
    expect(await vault.adapter.exists('.obsidian/plugins/abele/sync-staging/orphan.incoming')).toBe(
      false
    )
    if (retry === 'unresolved')
      expect(await vault.adapter.read(staging.replace('/sync-staging/', '/sync-recovery/'))).toBe(
        'sample unique late edit'
      )
    expect(await unrelated.getMeta('keep')).toBe('yes')
    expect((await factory.databases()).map((one) => one.name)).not.toContain(record.ledgerId)
    expect((await factory.databases()).map((one) => one.name)).not.toContain(copyName)
    expect(await ui.reviews!.executables.pending()).toEqual([])
    expect(await ui.reviews!.attachments.pending()).toEqual([])
    const fresh = await IndexedDbStateStore.open(factory, 'abele-sync-reviews-' + reviewId)
    expect(await fresh.getMeta('token-attachment-consent-v1')).toBeNull()
    expect(await fresh.getMeta('token-executable-review-v1')).toBeNull()
    fresh.close()
    if (host) {
      host.close()
      host = await HostSyncStorage.open(factory, 'sample-reset', storage)
      expect(TokenConnectionRegistry.open(storage).records()).toEqual([])
      expect(await host.readValue(SETS_KEY)).toEqual({ version: 1, connections: [] })
    }
  } finally {
    host?.close()
    unrelated.close()
    reviews.close()
    for (const closeReview of registered) closeReview()
    if (descriptor) Object.defineProperty(window, 'indexedDB', descriptor)
    else Reflect.deleteProperty(window, 'indexedDB')
  }
})

it.each([false, true])(
  'does not resurrect a disconnected durable connection (item=%s)',
  async (item) => {
    const factory = new IDBFactory()
    const local = new Map<string, unknown>()
    const storage = {
      loadLocalStorage: (key: string) => local.get(key) ?? null,
      saveLocalStorage: (key: string, value: unknown) => local.set(key, structuredClone(value)),
    }
    let host = await HostSyncStorage.open(factory, 'sample-disconnect', storage)
    try {
      const registry = TokenConnectionRegistry.open(storage)
      const removed = registry.add(item)
      const retained = registry.add(!item)
      const keys = new Map<string, string>()
      const secrets = {
        get: (reference: string) => keys.get(reference) ?? null,
        set: (reference: string, value: string) => keys.set(reference, value),
        remove: vi.fn((reference: string) => keys.delete(reference)),
      }
      const scope = { kind: 'folder' as const, id: 'sample-root', path: '/' }
      await registry.attachDurably(
        removed,
        { v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope },
        {
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          status: 'active',
          scope,
        },
        secrets
      )
      const ui = new TokenUi(registry, secrets, vi.fn())
      await ui.disconnect(removed)
      expect(keys.size).toBe(0)
      expect(secrets.remove).toHaveBeenCalledTimes(1)
      host.close()
      host = await HostSyncStorage.open(factory, 'sample-disconnect', storage)
      expect(
        TokenConnectionRegistry.open(storage)
          .records()
          .map((record) => record.id)
      ).toEqual([retained])
    } finally {
      host.close()
    }
  }
)
