import type { NodeClientState } from './NodeClientStore'

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

  async load(tx: IDBTransaction, state: NodeClientState) {
    const store = tx.objectStore('client')
    const legacy = state.artifactData
    const revision = (await read(store.get('artifact-revision'))) as string | undefined
    const snapshot =
      legacy ??
      (revision === this.revision
        ? this.snapshot
        : (((await read(store.get('artifacts'))) ?? {}) as Artifacts))
    let copy: Artifacts | undefined
    Object.defineProperty(state, 'artifactData', {
      configurable: true,
      enumerable: true,
      get: () => (copy ??= structuredClone(snapshot)),
      set: (value: Artifacts | undefined) => {
        copy = value ?? {}
      },
    })
    let nextRevision = revision
    let nextSnapshot = snapshot
    return {
      save: () => {
        if (!legacy && (!copy || JSON.stringify(copy) === JSON.stringify(snapshot))) return
        nextSnapshot = structuredClone(copy ?? snapshot)
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
