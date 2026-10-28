import type { NodeClientState } from './NodeClientStore'
import { frozen, plain, storeDraft } from './storeDraft'

type Artifacts = NonNullable<NodeClientState['artifactData']>
const read = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

/** Replaceable payloads do not belong to the metadata cloned by every idle poll. */
export class ClientArtifacts {
  private revision?: string
  private snapshot: Artifacts = {}

  async load(tx: IDBTransaction, state: NodeClientState, readonly = false) {
    const store = tx.objectStore('client')
    const legacy = state.artifactData
    const revision = (await read(store.get('artifact-revision'))) as string | undefined
    // Legacy metadata is a transaction draft. Detach it before freezing the cache;
    // freezing a proxy would make its empty target non-extensible.
    const snapshot = plain(
      legacy ??
        (revision === this.revision
          ? this.snapshot
          : (((await read(store.get('artifacts'))) ?? {}) as Artifacts))
    )
    frozen(snapshot)
    const draft = storeDraft(snapshot)
    let copy: Artifacts | undefined
    Object.defineProperty(state, 'artifactData', {
      configurable: true,
      enumerable: true,
      get: () => copy ?? (readonly ? snapshot : draft.value),
      set: readonly
        ? undefined
        : (value: Artifacts | undefined) => {
            copy = value ?? {}
          },
    })
    let nextRevision = revision
    let nextSnapshot = snapshot
    return {
      save: () => {
        if (!legacy && !copy && !draft.changed()) return
        nextSnapshot = frozen(copy ? plain(copy) : draft.finish())
        nextRevision = crypto.randomUUID()
        store.put(nextSnapshot, 'artifacts')
        store.put(nextRevision, 'artifact-revision')
      },
      committed: () => {
        this.revision = nextRevision
        this.snapshot = nextSnapshot
      },
    }
  }
}
