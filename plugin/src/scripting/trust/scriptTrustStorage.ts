import type { App } from 'obsidian'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { storageOf } from '@/sync/vaultWrites'
import { newStateId } from '@/sync/ids'
import { CONNECTION_KEY } from '@/sync/connection'
import { LEDGER_KEY } from '@/sync/ledgerId'
import { ScriptProvenance, type ScriptBinding } from './ScriptProvenance'

export const SCRIPT_SENTINEL = '.abele-script-managed'
export const SCRIPT_TRUST_KEY = 'abele-script-provenance'
interface Descriptor {
  id: string
  binding: ScriptBinding
}
const database = (id: string) => `abele-script-provenance-${id}`

function descriptor(raw: unknown): Descriptor {
  if (!raw || typeof raw !== 'object') throw new Error('Script provenance descriptor is missing')
  const value = raw as Descriptor
  const b = value.binding
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    !b ||
    b.localVault !== value.id ||
    typeof b.endpoint !== 'string' ||
    !b.endpoint ||
    typeof b.vaultId !== 'string' ||
    !b.vaultId ||
    typeof b.principal !== 'string' ||
    !b.principal ||
    !['personal', 'scoped'].includes(b.facet) ||
    (b.grantId !== null && typeof b.grantId !== 'string')
  )
    throw new Error('Script provenance descriptor is unreadable')
  return { id: value.id, binding: { ...b } }
}

async function open(value: Descriptor, factory: IDBFactory, fresh: boolean) {
  const store = await IndexedDbStateStore.open(factory, database(value.id))
  try {
    return { store, provenance: await ScriptProvenance.open(store, value.binding, fresh) }
  } catch (error) {
    store.close()
    throw error
  }
}

/** The recovery marker is never a portable approval or a database ID to adopt on another vault. */
export async function activateScriptProvenance(
  app: App,
  binding: Omit<ScriptBinding, 'localVault'>,
  factory: IDBFactory
) {
  const storage = storageOf(app)
  if (!storage) throw new Error('Durable local script provenance storage is unavailable')
  const raw = storage.loadLocalStorage(SCRIPT_TRUST_KEY) ?? null
  const marker = await app.vault.adapter.exists(SCRIPT_SENTINEL)
  if (raw === null && marker) throw new Error('Script provenance is missing; recovery is required')
  const fresh = raw === null
  const id = fresh ? newStateId() : descriptor(raw).id
  const value: Descriptor = { id, binding: { ...binding, localVault: id } }
  storage.saveLocalStorage(SCRIPT_TRUST_KEY, value)
  if (JSON.stringify(storage.loadLocalStorage(SCRIPT_TRUST_KEY)) !== JSON.stringify(value))
    throw new Error('Script provenance descriptor was not persisted')
  await app.vault.adapter.writeBinary(
    SCRIPT_SENTINEL,
    new TextEncoder().encode('Managed script provenance required\n').buffer as ArrayBuffer
  )
  return open(value, factory, fresh)
}

/** Absence is local trust ONLY when there is no descriptor, connection, ledger or recovery marker. */
export async function scriptTrustFor(app: App, factory: IDBFactory = window.indexedDB) {
  const storage = storageOf(app)
  const raw = storage?.loadLocalStorage(SCRIPT_TRUST_KEY) ?? null
  if (raw === null) {
    const connection = storage?.loadLocalStorage(CONNECTION_KEY) as { vaultId?: string } | null
    const ledger = storage?.loadLocalStorage(LEDGER_KEY) as { stateId?: string } | null
    if (
      connection?.vaultId ||
      ledger?.stateId ||
      (await app.vault.adapter.exists(SCRIPT_SENTINEL))
    ) {
      throw new Error('Script provenance is missing; execution blocked until recovery')
    }
    return null
  }
  return open(descriptor(raw), factory, false)
}
