import type { NodeClientState } from './NodeClientStore'
import { frozen, plain, storeDraft } from './storeDraft'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

export const RECORD_FIELDS = [
  'results',
  'operationRequests',
  'managerOperations',
  'delegationTasks',
] as const
type Field = (typeof RECORD_FIELDS)[number]
type Snapshot = { revision: string; value: unknown; toolsRef?: string }
const read = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

/** Immutable cached receipts, cloned only when inspected; each changed row commits separately. */
export class ClientRecords {
  private snapshots = new Map<string, Snapshot>()
  private toolSnapshots = new Map<string, unknown>()
  constructor(private readonly validate: (field: Field, value: unknown) => void) {}

  async load(tx: IDBTransaction, state: NodeClientState, readonly = false) {
    const store = tx.objectStore('client')
    const manifest = ((await read(store.get('record-revisions'))) ?? {}) as Record<string, string>
    const snapshots = new Map<string, Snapshot>()
    const tools = new Map(this.toolSnapshots)
    const loadingTools = new Map<string, Promise<unknown>>()
    const toolSnapshot = (reference: string) => {
      if (tools.has(reference)) return Promise.resolve(tools.get(reference))
      let loading = loadingTools.get(reference)
      if (!loading) {
        loading = read(store.get(reference)).then((value) => {
          if (!value) throw new Error('Missing delegation tool snapshot')
          tools.set(reference, frozen(value))
          return value
        })
        loadingTools.set(reference, loading)
      }
      return loading
    }
    await Promise.all(
      Object.entries(manifest).map(async ([key, revision]) => {
        const cached = this.snapshots.get(key)
        if (cached?.revision === revision) snapshots.set(key, cached)
        else {
          const field = RECORD_FIELDS.find((field) => key.startsWith(`record:${field}:`))
          if (!field) throw new Error('Invalid node record collection')
          let value: unknown = await read(store.get(key))
          let reference: string | undefined
          if (
            field === 'delegationTasks' &&
            value &&
            typeof value === 'object' &&
            'toolsRef' in value
          ) {
            const { toolsRef, ...task } = value as {
              toolsRef: string
              request: Record<string, unknown>
            }
            reference = toolsRef
            value = {
              ...task,
              request: { ...task.request, obsidian_tools: await toolSnapshot(toolsRef) },
            }
          }
          this.validate(field, value)
          snapshots.set(key, { revision, value: frozen(value), toolsRef: reference })
        }
      })
    )
    const collections = RECORD_FIELDS.map((field) => {
      const legacy = (field === 'delegationTasks' ? state.delegation?.tasks : state[field]) as
        | Record<string, unknown>
        | undefined
      const records: Record<string, unknown> = {}
      const touched = new Map<string, ReturnType<typeof storeDraft>>()
      const prefix = `record:${field}:`
      for (const [key, snapshot] of snapshots) {
        if (!key.startsWith(prefix)) continue
        const id = key.slice(prefix.length)
        Object.defineProperty(records, id, {
          configurable: true,
          enumerable: true,
          get: () => {
            if (readonly) return snapshot.value
            if (!touched.has(id)) touched.set(id, storeDraft(snapshot.value as object))
            return touched.get(id)!.value
          },
          set: readonly
            ? undefined
            : (value) => {
                delete records[id]
                records[id] = value
              },
        })
      }
      for (const [id, value] of Object.entries(legacy ?? {})) records[id] = value
      let current = records
      Object.defineProperty(state, field, {
        configurable: true,
        enumerable: true,
        get: () => current,
        set: readonly
          ? undefined
          : (value) => {
              current = value ?? {}
            },
      })
      if (readonly) Object.freeze(records)
      return { field, prefix, records, touched, current: () => current }
    })
    const delegation = {
      get tasks() {
        return state.delegationTasks!
      },
    }
    if (readonly) Object.freeze(delegation)
    Object.defineProperty(state, 'delegation', {
      configurable: true,
      enumerable: true,
      get: () => delegation,
      set: readonly
        ? undefined
        : (value) => {
            state.delegationTasks = value?.tasks ?? {}
          },
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
          const accessor = current === records && Object.getOwnPropertyDescriptor(records, id)?.get
          if (accessor && !touched.get(id)?.changed()) continue
          const key = prefix + id,
            value = accessor ? touched.get(id)!.finish() : plain(current[id])
          if (!snapshots.has(key) || value !== snapshots.get(key)!.value)
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
            const field = RECORD_FIELDS.find((field) => update.key.startsWith(`record:${field}:`))!
            this.validate(field, update.value)
            const revision = crypto.randomUUID()
            manifest[update.key] = revision
            let stored = update.value
            let cachedValue = update.value
            let reference: string | undefined
            if (field === 'delegationTasks') {
              const task = update.value as NonNullable<NodeClientState['delegationTasks']>[string]
              const snapshot = task.request.obsidian_tools
              if (snapshot) {
                const toolsRef =
                  'delegation-tools:' +
                  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(snapshot))))
                reference = toolsRef
                if (!tools.has(toolsRef)) {
                  store.put(snapshot, toolsRef)
                  tools.set(toolsRef, frozen(snapshot))
                }
                const { obsidian_tools: _tools, ...request } = task.request
                stored = { ...task, request, toolsRef }
                cachedValue = {
                  ...task,
                  request: { ...task.request, obsidian_tools: tools.get(toolsRef) },
                }
              }
            }
            store.put(stored, update.key)
            snapshots.set(update.key, { revision, value: frozen(cachedValue), toolsRef: reference })
          }
        }
        if (updates.length) {
          const referenced = new Set([...snapshots.values()].map((snapshot) => snapshot.toolsRef))
          for (const reference of tools.keys())
            if (!referenced.has(reference)) {
              store.delete(reference)
              tools.delete(reference)
            }
          store.put(manifest, 'record-revisions')
        }
      },
      committed: () => {
        this.snapshots = snapshots
        this.toolSnapshots = tools
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
  const tasks = state.delegation?.tasks ?? {}
  if (Object.keys(tasks).length > 200) {
    const settled = Object.keys(tasks).filter((id) => {
      const task = tasks[id]
      const pending = state.outbox.some((entry) => {
        const params = entry.params as {
          delegation_key?: string
          delegation_id?: string
          session_id?: string
        }
        return (
          params.delegation_key === task.request.delegation_key ||
          (!!task.child &&
            (params.delegation_id === task.child.delegation_id ||
              params.session_id === task.child.session_id))
        )
      })
      return (
        !pending &&
        !task.awaitingResult &&
        !task.ownerStopped &&
        !(task.cancelled && !task.cancelSettled) &&
        ['completed', 'failed', 'cancelled'].includes(task.status?.state ?? '')
      )
    })
    for (const id of settled.slice(0, Math.max(0, settled.length - 200))) delete tasks[id]
  }
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
