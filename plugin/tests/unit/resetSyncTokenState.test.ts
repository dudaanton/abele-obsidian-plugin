import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Plugin } from 'obsidian'
import {
  resetSyncTokenState,
  captureSyncTokenOwnership,
} from '../../src/testing/resetSyncTokenState'
import { TokenConnectionRegistry } from '../../src/sync/tokenConnectionRegistry'
import { IndexedDbStateStore } from '../../src/sync/IndexedDbStateStore'
import { openDeviceReviews } from '../../src/sync/openDeviceReviews'
import { TokenUi } from '../../src/sync/tokenUi'
import { sha256 } from '@abele/sync-core'
vi.mock('../../src/sync/tokenEngines', () => ({
  TokenEngines: class {
    start() {}
  },
}))

it('removes owned credentials, ledgers, edit snapshots and all review decisions without touching notes or other vault data', async () => {
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
  const reviewId = crypto.randomUUID()
  local.set('abele-sync-device-review-id-v1', reviewId)
  const reviews = await openDeviceReviews(factory, reviewId)
  const ui = new TokenUi(registry, secrets, vi.fn(), reviews)
  const ledger = await IndexedDbStateStore.open(factory, record.ledgerId)
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
  const vault = {
    getName: () => 'leased-pool',
    configDir: '.obsidian',
    notes: new Map([['note.md', 'keep']]),
  }
  const close = vi.fn(async () => {
    ledger.close()
    snapshots.close()
  })
  const plugin = {
    app: { ...storage, vault },
    register: (callback: () => void) => registered.push(callback),
    tokenEngines: { ui, close, scriptsFolder: 'Scripts', key: secrets.get, deps: {} },
  } as unknown as Plugin
  try {
    await captureSyncTokenOwnership(plugin, 'leased-pool')
    await Promise.all([
      resetSyncTokenState(plugin, { vault: 'leased-pool', confirm: 'reset-sync-token-state' }),
      resetSyncTokenState(plugin, { vault: 'leased-pool', confirm: 'reset-sync-token-state' }),
    ])
    expect(close).toHaveBeenCalledOnce()
    expect(registry.records()).toEqual([])
    expect(keys).toEqual(new Map([['unrelated-key', 'keep']]))
    expect(local.get('other-plugin')).toEqual({ keep: true })
    expect(vault.notes).toEqual(new Map([['note.md', 'keep']]))
    expect(await unrelated.getMeta('keep')).toBe('yes')
    expect((await factory.databases()).map((one) => one.name)).not.toContain(record.ledgerId)
    expect((await factory.databases()).map((one) => one.name)).not.toContain(copyName)
    expect(await ui.reviews!.executables.pending()).toEqual([])
    expect(await ui.reviews!.attachments.pending()).toEqual([])
    const fresh = await IndexedDbStateStore.open(factory, 'abele-sync-reviews-' + reviewId)
    expect(await fresh.getMeta('token-attachment-consent-v1')).toBeNull()
    expect(await fresh.getMeta('token-executable-review-v1')).toBeNull()
    fresh.close()
  } finally {
    unrelated.close()
    reviews.close()
    for (const closeReview of registered) closeReview()
    if (descriptor) Object.defineProperty(window, 'indexedDB', descriptor)
    else Reflect.deleteProperty(window, 'indexedDB')
  }
})
