import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { authorizeLedgerBootstrap, requireLedger, LEDGER_IDENTITY_KEY } from '@/sync/ledgerRecovery'
import { buildFakeVault } from '../helpers/fakeVault'

const ledger = { stateId: 'sample-state', vaultId: 'sample-vault' }
const value = JSON.stringify(ledger)
const row = {
  path: 'sample.md',
  wirePath: 'sample.md',
  fileId: 'sample-file',
  versionId: 'sample-version',
  sha: 'a'.repeat(64),
  size: 1,
  mtime: 1,
}

describe('strict identity before WebKit reconnect retry', () => {
  it.each(['read', 'write'])(
    'refuses recreated empty storage before retrying a %s or any side effect',
    async (mode) => {
      const app = buildFakeVault([])
      let factory = new IDBFactory()
      const facade = {
        open: (...args: Parameters<IDBFactory['open']>) => factory.open(...args),
      } as IDBFactory
      const store = await IndexedDbStateStore.open(facade, 'sample-identity', {
        identity: { key: LEDGER_IDENTITY_KEY, value },
      })
      const fileChange = vi.fn(),
        networkChange = vi.fn()
      try {
        authorizeLedgerBootstrap(app, ledger)
        await requireLedger(app, store, ledger)
        await store.put(row)
        await store.setCursor(7)
        const db = (store as unknown as { db: IDBDatabase }).db
        vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
          factory = new IDBFactory()
          throw new DOMException('Connection to Indexed Database server lost', 'UnknownError')
        })
        await expect(
          (async () => {
            if (mode === 'read') await store.getCursor()
            else await store.put({ ...row, path: 'pending.md', wirePath: 'pending.md' })
            fileChange()
            networkChange()
          })()
        ).rejects.toThrow('Sync recovery required')
        expect(fileChange).not.toHaveBeenCalled()
        expect(networkChange).not.toHaveBeenCalled()
        await expect(store.getCursor()).rejects.toThrow('Sync recovery required')
        await expect(store.put(row)).rejects.toThrow('Sync recovery required')
        const inspect = await IndexedDbStateStore.open(factory, 'sample-identity')
        try {
          expect(await inspect.getMeta(LEDGER_IDENTITY_KEY)).toBeNull()
          expect(await inspect.get('pending.md')).toBeNull()
          expect(await inspect.getCursor()).toBe(0)
        } finally {
          inspect.close()
        }
      } finally {
        store.close()
        vi.restoreAllMocks()
      }
    }
  )

  it('never uses an overlay header to validate a reopened database', async () => {
    const factory = new IDBFactory(),
      app = buildFakeVault([])
    const store = await IndexedDbStateStore.open(factory, 'sample-overlay', {
      identity: { key: LEDGER_IDENTITY_KEY, value },
    })
    try {
      authorizeLedgerBootstrap(app, ledger)
      await requireLedger(app, store, ledger)
      await store.setMeta(LEDGER_IDENTITY_KEY, 'wrong-raw-header')
      await expect(
        store.transaction(async () => {
          await store.setMeta(LEDGER_IDENTITY_KEY, value)
          const db = (store as unknown as { db: IDBDatabase }).db
          vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
            throw new DOMException('Connection to Indexed Database server lost', 'UnknownError')
          })
          await store.getCursor()
        })
      ).rejects.toThrow('Sync recovery required')
    } finally {
      store.close()
      vi.restoreAllMocks()
    }
  })

  it('rejects a changed ledger header even when the database instance identity survives', async () => {
    const factory = new IDBFactory(),
      app = buildFakeVault([])
    const store = await IndexedDbStateStore.open(factory, 'sample-header', {
      identity: { key: LEDGER_IDENTITY_KEY, value },
    })
    try {
      authorizeLedgerBootstrap(app, ledger)
      await requireLedger(app, store, ledger)
      await store.setMeta(LEDGER_IDENTITY_KEY, 'other-ledger')
      const fatal = vi.fn()
      store.onRecoveryRequired(fatal)
      const db = (store as unknown as { db: IDBDatabase }).db
      vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
        throw new DOMException('Connection to Indexed Database server lost', 'UnknownError')
      })
      await expect(store.getCursor()).rejects.toThrow('Sync recovery required')
      expect(fatal).toHaveBeenCalledOnce()
      expect(store.permitsEngineEffects).toBe(false)
    } finally {
      store.close()
      vi.restoreAllMocks()
    }
  })
})
