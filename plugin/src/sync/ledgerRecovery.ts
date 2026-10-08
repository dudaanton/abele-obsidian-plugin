import type { StateStore } from '@abele/sync-core'
import type { LedgerId, LocalStorage } from './ledgerId'
import { SCOPE_KEY } from './scope'
import {
  assertNoExternalLifecycleMarker,
  EXTERNAL_ACTIVATION_KEY,
  ExternalRecoveryRequired,
} from './external/recovery'

export const LEDGER_BOOTSTRAP_KEY = 'abele-sync-ledger-bootstrap'
export const LEDGER_PROOF_KEY = 'abele-sync-ledger-proof'
export const LEDGER_IDENTITY_KEY = 'ledger-identity-v1'
export const RECOVERY_REQUIRED = 'Sync recovery required'
export class LedgerRecoveryRequired extends Error {
  constructor() {
    super(
      `${RECOVERY_REQUIRED}: this connection lost its ledger. No files will be uploaded or deleted. Restore this device's ledger backup, or use Forget and review a new join. Missing link baselines and script permissions must not be inferred from local files.`
    )
  }
}
const same = (value: unknown, ledger: LedgerId): boolean => {
  if (!value || typeof value !== 'object') return false
  const held = value as LedgerId
  return held.stateId === ledger.stateId && held.vaultId === ledger.vaultId
}

/** Only explicit enrolment authorizes a first empty ledger; ordinary startup never does. */
export function authorizeLedgerBootstrap(storage: LocalStorage, ledger: LedgerId): void {
  assertNoExternalLifecycleMarker(storage)
  storage.saveLocalStorage(LEDGER_BOOTSTRAP_KEY, { ...ledger })
  if (!same(storage.loadLocalStorage(LEDGER_BOOTSTRAP_KEY), ledger))
    throw new Error('Ledger bootstrap authorization was not persisted')
}

/** A durable header/sentinel distinguishes legitimate empty state from storage eviction. */
export async function requireLedger(
  storage: LocalStorage,
  store: StateStore,
  ledger: LedgerId
): Promise<void> {
  if (!ledger.stateId || !ledger.vaultId || !store.getMeta || !store.setMeta)
    throw new LedgerRecoveryRequired()
  if (
    storage.loadLocalStorage(EXTERNAL_ACTIVATION_KEY) != null &&
    (await store.getMeta('external-files')) === null
  )
    throw new ExternalRecoveryRequired('activated ledger lost its journal; bootstrap refused')
  const expected = JSON.stringify({ stateId: ledger.stateId, vaultId: ledger.vaultId })
  const header = await store.getMeta(LEDGER_IDENTITY_KEY)
  const fresh = same(storage.loadLocalStorage(LEDGER_BOOTSTRAP_KEY), ledger)
  if (header !== null && header !== expected) throw new LedgerRecoveryRequired()
  if (header === null) {
    let legacy = false
    // A missing header on a previously certified database is not a legacy upgrade.
    if (!same(storage.loadLocalStorage(LEDGER_PROOF_KEY), ledger) && !fresh) {
      legacy =
        (await store.getCursor()) > 0 ||
        (await store.getJournal()) !== null ||
        (await store.getMeta(SCOPE_KEY)) !== null
      if (!legacy) {
        for await (const _entry of store.all()) {
          legacy = true
          break
        }
      }
    }
    if (!fresh && !legacy) throw new LedgerRecoveryRequired()
    await store.setMeta(LEDGER_IDENTITY_KEY, expected)
    if ((await store.getMeta(LEDGER_IDENTITY_KEY)) !== expected)
      throw new Error('Ledger identity was not persisted')
  }
  storage.saveLocalStorage(LEDGER_PROOF_KEY, { ...ledger })
  if (!same(storage.loadLocalStorage(LEDGER_PROOF_KEY), ledger))
    throw new Error('Ledger recovery sentinel was not persisted')
  // Consume before constructing an engine: a lost database cannot replay a first-run grant.
  if (fresh) {
    storage.saveLocalStorage(LEDGER_BOOTSTRAP_KEY, null)
    if (storage.loadLocalStorage(LEDGER_BOOTSTRAP_KEY) != null)
      throw new Error('Ledger bootstrap authorization was not consumed')
  }
}
