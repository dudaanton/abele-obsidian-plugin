import { IndexedDbStateStore } from './IndexedDbStateStore'
import { TokenConnectionRegistry, type TokenConnectionRecord } from './tokenConnectionRegistry'

const IDENTITY = 'token-engine-identity-v2'
const PROOF = 'abele-sync-token-state:ledger-proof-v2'
/** Bootstrap completes before an engine can run; a certified missing ledger never restarts empty. */
export async function openTokenLedger(
  factory: IDBFactory,
  registry: TokenConnectionRegistry,
  record: TokenConnectionRecord,
  assertHeld: () => void
) {
  const binding = JSON.stringify([
    record.id,
    record.ledgerId,
    record.address,
    record.spaceId,
    record.tokenId,
    record.scope?.kind,
    record.scope?.id,
  ])
  const storage = registry.storage(record.id)
  const store = await IndexedDbStateStore.open(factory, record.ledgerId, {
    identity: { key: IDENTITY, value: binding },
    effectGuard: assertHeld,
  })
  try {
    const prior = await store.getMeta(IDENTITY)
    if (prior !== binding && (prior !== null || storage.loadLocalStorage(PROOF) != null))
      throw new Error('Sync recovery required: token ledger identity lost')
    if (prior === null) await store.setMeta(IDENTITY, binding)
    if ((await store.getMeta(IDENTITY)) !== binding)
      throw new Error('Sync recovery required: token ledger identity not stored')
    storage.saveLocalStorage(PROOF, binding)
    if (storage.loadLocalStorage(PROOF) !== binding)
      throw new Error('Sync recovery required: token ledger proof not stored')
    return store
  } catch (error) {
    store.close()
    throw error
  }
}
