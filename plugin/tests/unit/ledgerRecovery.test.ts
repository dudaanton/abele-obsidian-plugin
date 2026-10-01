// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MemoryStateStore } from '@abele/sync-core'
import {
  authorizeLedgerBootstrap,
  requireLedger,
  LEDGER_BOOTSTRAP_KEY,
  LEDGER_IDENTITY_KEY,
  LEDGER_PROOF_KEY,
} from '@/sync/ledgerRecovery'
const ledger = { stateId: 'sample-state', vaultId: 'sample-vault' }
function storage() {
  const values = new Map<string, unknown>()
  return {
    loadLocalStorage: (key: string) => values.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, value)
    },
  }
}

describe('lost-ledger boundary', () => {
  it('initializes an explicitly enrolled empty vault and consumes the first-run grant', async () => {
    const local = storage(),
      store = new MemoryStateStore()
    authorizeLedgerBootstrap(local, ledger)
    await requireLedger(local, store, ledger)
    expect(local.loadLocalStorage(LEDGER_BOOTSTRAP_KEY)).toBeNull()
    expect(local.loadLocalStorage(LEDGER_PROOF_KEY)).toEqual(ledger)
    expect(await store.getMeta(LEDGER_IDENTITY_KEY)).toBe(JSON.stringify(ledger))
    await requireLedger(local, store, ledger)
  })
  it('refuses empty recreated storage after a legitimate first initialization', async () => {
    const local = storage()
    authorizeLedgerBootstrap(local, ledger)
    await requireLedger(local, new MemoryStateStore(), ledger)
    await expect(requireLedger(local, new MemoryStateStore(), ledger)).rejects.toThrow(/recovery/i)
  })
  it('does not reinterpret an existing descriptor as an initial join', async () => {
    await expect(requireLedger(storage(), new MemoryStateStore(), ledger)).rejects.toThrow(
      /recovery/i
    )
  })
  it('upgrades positive legacy state without altering progress or a pending journal', async () => {
    const local = storage(),
      store = new MemoryStateStore()
    const journal = {
      batchId: 'sample-batch',
      ops: [],
      idempotencyKey: 'sample-request',
      startedAt: 'sample-time',
    }
    await store.setCursor(7)
    await store.setJournal(journal)
    await requireLedger(local, store, ledger)
    expect(await store.getCursor()).toBe(7)
    expect(await store.getJournal()).toEqual(journal)
  })
  it('does not recreate a certified header even if other legacy-looking metadata survived', async () => {
    const local = storage(),
      store = new MemoryStateStore()
    local.saveLocalStorage(LEDGER_PROOF_KEY, ledger)
    await store.setCursor(7)
    await expect(requireLedger(local, store, ledger)).rejects.toThrow(/recovery/i)
  })
  it('rejects a wrong database header without clearing it', async () => {
    const store = new MemoryStateStore()
    await store.setMeta(LEDGER_IDENTITY_KEY, 'other-identity')
    await expect(requireLedger(storage(), store, ledger)).rejects.toThrow(/recovery/i)
    expect(await store.getMeta(LEDGER_IDENTITY_KEY)).toBe('other-identity')
  })
})
