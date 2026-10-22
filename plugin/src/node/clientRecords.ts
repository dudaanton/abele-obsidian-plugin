import type { NodeClientState } from './NodeClientStore'

export const RECORD_FIELDS = ['results', 'operationRequests', 'managerOperations'] as const
type Field = (typeof RECORD_FIELDS)[number]
type Snapshot = { revision: string; value: unknown }
const read = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

/** Immutable cached receipts, cloned only when inspected; each changed row commits separately. */
export class ClientRecords {
  private snapshots = new Map<string, Snapshot>()
  constructor(private readonly validate: (field: Field, value: unknown) => void) {}

  async load(tx: IDBTransaction, state: NodeClientState) {
    const store = tx.objectStore('client')
    const manifest = ((await read(store.get('record-revisions'))) ?? {}) as Record<string, string>
    const snapshots = new Map<string, Snapshot>()
    await Promise.all(
      Object.entries(manifest).map(async ([key, revision]) => {
        const cached = this.snapshots.get(key)
        if (cached?.revision === revision) snapshots.set(key, cached)
        else {
          const field = RECORD_FIELDS.find((field) => key.startsWith(`record:${field}:`))
          if (!field) throw new Error('Invalid node record collection')
          const value: unknown = await read(store.get(key))
          this.validate(field, value)
          snapshots.set(key, { revision, value })
        }
      })
    )
    const collections = RECORD_FIELDS.map((field) => {
      const legacy = state[field] as Record<string, unknown> | undefined
      const records: Record<string, unknown> = {}
      const touched = new Map<string, unknown>()
      const prefix = `record:${field}:`
      for (const [key, snapshot] of snapshots) {
        if (!key.startsWith(prefix)) continue
        const id = key.slice(prefix.length)
        Object.defineProperty(records, id, {
          configurable: true,
          enumerable: true,
          get: () => {
            if (!touched.has(id)) touched.set(id, structuredClone(snapshot.value))
            return touched.get(id)
          },
          set: (value) => {
            touched.set(id, value)
          },
        })
      }
      for (const [id, value] of Object.entries(legacy ?? {})) records[id] = value
      let current = records
      Object.defineProperty(state, field, {
        configurable: true,
        enumerable: true,
        get: () => current,
        set: (value) => {
          current = value ?? {}
        },
      })
      return { field, prefix, records, touched, current: () => current }
    })
    const changes = () =>
      collections.flatMap((collection) => {
        const { prefix, records, touched } = collection
        const current = collection.current()
        const changes: { key: string; value?: unknown; deleted?: boolean }[] = []
        for (const key of snapshots.keys()) {
          if (key.startsWith(prefix) && !Object.hasOwn(current, key.slice(prefix.length)))
            changes.push({ key, deleted: true })
        }
        for (const id of Object.keys(current)) {
          if (
            current === records &&
            Object.getOwnPropertyDescriptor(records, id)?.get &&
            !touched.has(id)
          )
            continue
          const key = prefix + id,
            value = current[id]
          if (
            !snapshots.has(key) ||
            JSON.stringify(value) !== JSON.stringify(snapshots.get(key)!.value)
          )
            changes.push({ key, value })
        }
        return changes
      })
    return {
      changed: () => changes().length > 0,
      save: () => {
        const updates = changes()
        for (const update of updates) {
          if (update.deleted) {
            store.delete(update.key)
            snapshots.delete(update.key)
            delete manifest[update.key]
          } else {
            const revision = crypto.randomUUID()
            manifest[update.key] = revision
            store.put(update.value, update.key)
            snapshots.set(update.key, { revision, value: structuredClone(update.value) })
          }
        }
        if (updates.length) store.put(manifest, 'record-revisions')
      },
      committed: () => {
        this.snapshots = snapshots
      },
    }
  }
}

/** Keep recovery and live-operation evidence regardless of age or size. */
export function uncertainReceiptError(error: string): boolean {
  return /outcome_unknown|delivery_unknown|idempotency_mismatch|disconnected|timeout|timed_out|connection|unreachable/.test(
    error
  )
}

export function pruneSettledRecords(state: NodeClientState): void {
  // Ordinary receipt updates must not inspect or clone the retained history.
  if (
    Object.keys(state.results).length <= 1000 &&
    Object.keys(state.managerOperations ?? {}).length <= 200
  )
    return
  const operations = Object.entries(state.managerOperations ?? {})
  const settled = operations.filter(([id, operation]) => {
    const receipt = state.results[id]
    const run = operation.run ?? (receipt?.result as { state?: string } | undefined)
    return (
      (operation.notified || operation.method === 'command.v1.cancel') &&
      ((run &&
        ['exited', 'applied', 'failed', 'cancelled', 'denied', 'timed_out'].includes(
          run.state ?? ''
        )) ||
        (receipt?.error && !uncertainReceiptError(receipt.error)))
    )
  })
  for (const [id, operation] of settled.slice(0, Math.max(0, settled.length - 200))) {
    // Admission may still say "running". Retire it with the latest terminal evidence
    // and the exact owner/request, so retained receipts remain safely retryable.
    state.results[id] = {
      ...state.results[id],
      ...(operation.run ? { result: operation.run } : {}),
      request: { method: operation.method, params: operation.params },
      managerParent: operation.parent,
    }
    delete state.managerOperations![id]
  }
  const protectedIds = new Set([
    ...state.outbox.map((entry) => entry.operation_id),
    ...Object.keys(state.managerOperations ?? {}),
    ...Object.keys(state.chatMutations ?? {}),
    ...Object.keys(state.nodePathIntents ?? {}),
    ...Object.keys(state.turnDrafts ?? {}),
    ...Object.keys(state.obsidianExecutions ?? {}),
    ...Object.keys(state.nodeLetters ?? {}),
    ...Object.keys(state.delegation?.tasks ?? {}),
    ...Object.values(state.fileDrafts ?? {}).flatMap((draft) =>
      draft.pending ? [draft.pending.operationId] : []
    ),
  ])
  const discardable = Object.keys(state.results).filter((id) => {
    const receipt = state.results[id]
    const result = receipt.result as { state?: string } | undefined
    return (
      !protectedIds.has(id) &&
      !receipt.input &&
      !receipt.answer &&
      !['pending', 'pending_approval', 'running', 'outcome_unknown'].includes(
        result?.state ?? ''
      ) &&
      !uncertainReceiptError(receipt.error ?? '')
    )
  })
  for (const id of discardable.slice(0, Math.max(0, discardable.length - 1000))) {
    delete state.results[id]
    delete state.operationRequests?.[id]
  }
}
