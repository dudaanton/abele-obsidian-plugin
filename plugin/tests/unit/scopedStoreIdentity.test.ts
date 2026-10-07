import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ScopedPluginHost } from '@/sync/scoped/scopedPluginHost'
import { SCOPED_CONNECTION_KEY, type ScopedLocalConnection } from '@/sync/scoped/scopedJoin'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { useVault } from '../helpers/testEnv'

let host: ScopedPluginHost
setSecrets(null)
afterEach(async () => {
  await host?.close()
  setSecrets(null)
  vi.restoreAllMocks()
})
function setup() {
  const app = useVault([])
  setSecrets(null)
  AbeleConfig.getInstance().applySettings()
  const c: ScopedLocalConnection = {
    version: 4,
    facet: 'scoped',
    issuer: 'https://sync.example',
    vaultId: 'sample-vault',
    grantId: 'sample-grant',
    memberId: 'sample-member',
    principalId: 'sample-install',
    principalKind: 'installation',
    role: 'editor',
    rootFileId: 'sample-root',
    tokenId: 'abele-scoped-installation-sample',
    ledgerId: 'sample-ledger',
    scriptPolicy: 'refuse',
  }
  const token = 'absi_' + 'a'.repeat(43)
  secrets().setLocal(c.tokenId, token)
  secrets().setLocal(c.tokenId + '-binding', JSON.stringify({ connection: c, token }))
  app.saveLocalStorage(SCOPED_CONNECTION_KEY, c)
  const factory = new IDBFactory()
  host = new ScopedPluginHost(
    app as never,
    (() => {
      throw new Error('No network in store identity test')
    }) as never,
    factory
  )
  return { c, factory }
}

it.each(['raw', 'meta'] as const)(
  'persists the identity checked after a healthy WebKit-style %s reconnect',
  async (which) => {
    const { c } = setup()
    const r = await (host as any).open(c, true)
    const key = which === 'raw' ? 'scoped-plugin-identity-v4' : 'scoped-native-identity-v4'
    const store = r[which] as IndexedDbStateStore
    const expected = JSON.stringify({ connection: c, binding: r.client.binding })
    expect(await store.getMeta(key)).toBe(expected)
    await store.setMeta('sample-reconnect-data', 'sample retained value')
    const db = (store as any).connection.db as IDBDatabase
    vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
      db.close()
      throw new DOMException('Connection to Indexed Database server lost', 'UnknownError')
    })
    expect(await store.getMeta('sample-reconnect-data')).toBe('sample retained value')
    expect(store.permitsEngineEffects).toBe(true)
  }
)

it.each(['header', 'database'] as const)(
  'holds recovery when the native %s is lost beside a durable scoped CREATE journal',
  async (loss) => {
    const { c, factory } = setup()
    const r = await (host as any).open(c, true)
    const journal = {
      kind: 'scoped',
      binding: r.client.binding,
      request_id: 'sample-create-request',
      startedAt: new Date(0).toISOString(),
      ops: [
        { op: 'create', path: 'Shared/sample-note.md', sha: 'a'.repeat(64), size: 10, mtime: 1000 },
      ],
    }
    await r.state.setJournal(journal)
    if (loss === 'header') await r.meta.setMeta('scoped-native-identity-v4', null)
    await host.close()
    if (loss === 'database')
      await IndexedDbStateStore.delete(factory, 'abele-scoped-native-' + c.ledgerId)
    const fetcher = vi.fn(() => {
      throw new Error('Unexpected network effect')
    })
    host = new ScopedPluginHost((host as any).app, fetcher as never, factory)
    await expect((host as any).open(c, false)).rejects.toThrow(/recovery|identity/i)
    expect(fetcher).not.toHaveBeenCalled()
    const raw = await IndexedDbStateStore.open(factory, 'abele-scoped-' + c.ledgerId)
    const meta = await IndexedDbStateStore.open(factory, 'abele-scoped-native-' + c.ledgerId)
    try {
      expect(JSON.parse((await raw.getMeta('scoped-v4-state'))!).journal).toEqual(journal)
      expect(await meta.getMeta('scoped-native-identity-v4')).toBeNull()
    } finally {
      raw.close()
      meta.close()
    }
  }
)

it('never overwrites a changed identity header on a cold reopen', async () => {
  const { c, factory } = setup()
  const r = await (host as any).open(c, true)
  await r.meta.setMeta('scoped-native-identity-v4', 'invented-foreign-binding')
  await host.close()
  const app = (host as any).app
  host = new ScopedPluginHost(
    app,
    (() => {
      throw new Error('No network')
    }) as never,
    factory
  )
  await expect((host as any).open(c, false)).rejects.toThrow(/identity|binding/i)
  const meta = await IndexedDbStateStore.open(factory, 'abele-scoped-native-' + c.ledgerId)
  try {
    expect(await meta.getMeta('scoped-native-identity-v4')).toBe('invented-foreign-binding')
  } finally {
    meta.close()
  }
})
