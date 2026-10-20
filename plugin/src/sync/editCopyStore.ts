import { sha256 } from './external/hash'
import { type StateStore } from '@abele/sync-sdk/core'
import { IndexedDbStateStore } from './IndexedDbStateStore'
import type { EditCopies } from './editCopies'

const IDENTITY = 'local-edit-copy-identity-v1'
/** Independent metadata writer: captures must never join an engine's uncommitted overlay. */
export async function registerDurableEditCopies(
  factory: IDBFactory,
  copies: EditCopies,
  id: string,
  binding: string,
  base: Pick<StateStore, 'get'>,
  accepts: (path: string, size: number) => boolean | Promise<boolean>,
  assertHeld: () => void = () => {},
  storageId = id
) {
  const identity = JSON.stringify({ id, binding })
  const raw = await IndexedDbStateStore.open(factory, 'abele-local-edit-copies-' + storageId, {
    identity: { key: IDENTITY, value: identity },
    effectGuard: assertHeld,
  })
  try {
    const prior = await raw.getMeta(IDENTITY)
    if (prior !== null && prior !== identity)
      throw new Error('Local edit copy binding requires recovery')
    if (prior === null) await raw.setMeta(IDENTITY, identity)
    const store = {
      get: (path: string) => base.get(path),
      getMeta: raw.getMeta.bind(raw),
      setMeta: raw.setMeta.bind(raw),
      transaction: raw.transaction.bind(raw),
    }
    const unregister = copies.register(id, store, accepts)
    return {
      store,
      close: () => {
        unregister()
        raw.close()
      },
    }
  } catch (error) {
    raw.close()
    throw error
  }
}

/** A reviewed re-enrolment uses a fresh namespace; predecessor evidence remains untouched. */
export async function registerConnectionEditCopies(
  factory: IDBFactory,
  copies: EditCopies,
  id: string,
  binding: string,
  base: Pick<StateStore, 'get'>,
  accepts: (path: string, size: number) => boolean | Promise<boolean>,
  assertHeld: () => void = () => {}
) {
  const storageId = id + '-' + (await sha256(new TextEncoder().encode(binding)))
  return registerDurableEditCopies(
    factory,
    copies,
    id,
    binding,
    base,
    accepts,
    assertHeld,
    storageId
  )
}
