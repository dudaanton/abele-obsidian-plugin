import type { NodeClientState } from './NodeClientStore'
import { frozen, plain, sameStoredValue, storeDraft } from './storeDraft'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { packMutation, unpackMutation } from './mutationRecord'
import type { NodeMutationRecord } from '@/ai/tools/node/mutations'

export const RECORD_FIELDS = [
  'results',
  'operationRequests',
  'managerOperations',
  'delegationTasks',
  'chatMutations',
  'fileDrafts',
  'chatDrafts',
  'turnDrafts',
  'nodePathIntents',
  'nodeLetters',
  'obsidianExecutions',
  'obsidianSessions',
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
  private collections = new Map<Field, Record<string, unknown>>()
  private collectionLegacy = new Map<Field, unknown>()
  private manifestCache?: {
    stamp: string | undefined
    manifest: Record<string, string>
    keys: string[]
  }
  constructor(private readonly validate: (field: Field, value: unknown) => void) {}

  async load(tx: IDBTransaction, state: NodeClientState, readonly = false) {
    const store = tx.objectStore('client')
    let stamp = (await read(store.get('records-stamp'))) as string | undefined
    const cachedManifest = this.manifestCache?.stamp === stamp ? this.manifestCache : undefined
    const manifestOf = async (key: string) =>
      ((await read(store.get(key))) ?? {}) as Record<string, string>
    // Every new handle imports the persisted maps, including unstamped legacy data.
    // Once open, all writers must use this protocol; record writes and their stamp
    // commit together under the IndexedDB transaction lock.
    let manifest: Record<string, string> =
      cachedManifest?.manifest ??
      Object.assign(
        {},
        ...(await Promise.all([
          manifestOf('record-revisions'),
          manifestOf('delegation-revisions'),
          manifestOf('extra-record-revisions'),
        ]))
      )
    let keys = cachedManifest?.keys ?? Object.keys(manifest)
    const previousSnapshots = this.snapshots
    let snapshots = previousSnapshots
    const editSnapshots = () => {
      if (snapshots === previousSnapshots) snapshots = new Map(previousSnapshots)
      return snapshots
    }
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
    const changedFields = new Set<Field>()
    const pending: Promise<void>[] = []
    for (const key of cachedManifest ? [] : keys) {
      const revision = manifest[key]
      const cached = previousSnapshots.get(key)
      if (cached?.revision !== revision) {
        const field = RECORD_FIELDS.find((field) => key.startsWith(`record:${field}:`))
        if (!field) throw new Error('Invalid node record collection')
        changedFields.add(field)
        pending.push(
          (async () => {
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
            if (field === 'chatMutations') value = unpackMutation(value)
            this.validate(field, value)
            editSnapshots().set(key, { revision, value: frozen(value), toolsRef: reference })
          })()
        )
      }
    }
    if (pending.length || keys.length !== previousSnapshots.size)
      for (const key of previousSnapshots.keys()) {
        if (!Object.hasOwn(manifest, key)) {
          const field = RECORD_FIELDS.find((field) => key.startsWith(`record:${field}:`))
          changedFields.add(field)
          editSnapshots().delete(key)
        }
      }
    await Promise.all(pending)
    const collections = RECORD_FIELDS.map((field) => {
      const legacy = (field === 'delegationTasks' ? state.delegation?.tasks : state[field]) as
        | Record<string, unknown>
        | undefined
      const prefix = `record:${field}:`
      const cached = this.collections.get(field)
      const hasLegacy = !!legacy && Object.keys(legacy).length > 0
      const legacySnapshot =
        hasLegacy || (field === 'delegationTasks' && legacy) ? plain(legacy) : undefined
      let records = cached
      if (
        !records ||
        changedFields.has(field) ||
        this.collectionLegacy.get(field) !== legacySnapshot
      ) {
        const values: Record<string, unknown> = {}
        // Manifest order also determines retention order.
        for (const key of keys) {
          if (!key.startsWith(prefix)) continue
          if (field === 'delegationTasks' && legacy) continue
          if (legacy && Object.hasOwn(legacy, key.slice(prefix.length))) continue
          values[key.slice(prefix.length)] = snapshots.get(key).value
        }
        for (const [id, value] of Object.entries(legacy ?? {})) {
          const retained = snapshots.get(prefix + id)?.value
          const current = plain(value)
          // Rollback-compatible snapshots can be read by another handle without
          // becoming fresh writes. Actual legacy edits still replace their rows.
          values[id] = retained && sameStoredValue(retained, current) ? retained : current
        }
        records = frozen(values)
      }
      const draft = storeDraft(records)
      let current = readonly ? records : draft.value
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
      return {
        field,
        prefix,
        records,
        draft,
        legacy: hasLegacy,
        legacySnapshot,
        current: () => current,
      }
    })
    const delegation = {
      get tasks() {
        return state.delegationTasks
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
    const savedFields = new Set<Field>()
    const changes = () =>
      collections.flatMap((collection) => {
        const { prefix, records, draft } = collection
        const source = collection.current()
        if (
          !collection.legacy &&
          (source === records || (source === draft.value && !draft.changed()))
        )
          return []
        const current = plain(source)
        const changes: { key: string; value?: unknown; deleted?: boolean }[] = []
        for (const key of snapshots.keys()) {
          if (key.startsWith(prefix) && !Object.hasOwn(current, key.slice(prefix.length)))
            changes.push({ key, deleted: true })
        }
        for (const id of Object.keys(current)) {
          const key = prefix + id,
            value = current[id]
          if (!snapshots.has(key) || !sameStoredValue(value, snapshots.get(key).value))
            changes.push({ key, value })
        }
        return changes
      })
    return {
      edited: () =>
        collections.some(
          (collection) =>
            collection.draft.changed() ||
            (collection.current() !== collection.records &&
              collection.current() !== collection.draft.value)
        ),
      changed: (field?: Field) =>
        changes().some((change) => !field || change.key.startsWith(`record:${field}:`)),
      delegationChanged: () =>
        changes().some((change) => change.key.startsWith('record:delegationTasks:')),
      delegationSnapshot: () => frozen(plain({ tasks: state.delegation.tasks })),
      save: () => {
        const updates = changes()
        if (!updates.length) {
          if (!stamp) {
            stamp = crypto.randomUUID()
            store.put(stamp, 'records-stamp')
          }
          return
        }
        // An aborted transaction must not mutate the last committed cache.
        manifest = { ...manifest }
        for (const update of updates) savedFields.add(update.key.split(':')[1] as Field)
        return (async () => {
          for (const [index, update] of updates.entries()) {
            // Large legacy image migrations remain one atomic transaction, but each
            // small batch yields through IndexedDB before cloning the next payloads.
            if (index && index % 4 === 0) await read(store.count('state'))
            if (update.deleted) {
              store.delete(update.key)
              editSnapshots().delete(update.key)
              delete manifest[update.key]
            } else {
              const field = RECORD_FIELDS.find((field) => update.key.startsWith(`record:${field}:`))
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
              if (field === 'chatMutations') stored = packMutation(stored as NodeMutationRecord)
              store.put(stored, update.key)
              editSnapshots().set(update.key, {
                revision,
                value: frozen(cachedValue),
                toolsRef: reference,
              })
            }
          }
          if (updates.length) {
            const referenced = new Set([...snapshots.values()].map((snapshot) => snapshot.toolsRef))
            for (const reference of tools.keys())
              if (!referenced.has(reference)) {
                store.delete(reference)
                tools.delete(reference)
              }
            // Older clients reject unknown collections in their shared manifest.
            store.put(
              Object.fromEntries(
                Object.entries(manifest).filter(([key]) =>
                  ['results', 'operationRequests', 'managerOperations'].some((field) =>
                    key.startsWith(`record:${field}:`)
                  )
                )
              ),
              'record-revisions'
            )
            store.put(
              Object.fromEntries(
                Object.entries(manifest).filter(([key]) =>
                  key.startsWith('record:delegationTasks:')
                )
              ),
              'delegation-revisions'
            )
            store.put(
              Object.fromEntries(
                Object.entries(manifest).filter(
                  ([key]) =>
                    !['results', 'operationRequests', 'managerOperations', 'delegationTasks'].some(
                      (field) => key.startsWith(`record:${field}:`)
                    )
                )
              ),
              'extra-record-revisions'
            )
            keys = Object.keys(manifest)
            stamp = crypto.randomUUID()
            store.put(stamp, 'records-stamp')
          }
        })()
      },
      committed: () => {
        this.manifestCache = { stamp, manifest, keys }
        this.snapshots = snapshots
        this.toolSnapshots = tools
        for (const collection of collections) {
          if (savedFields.has(collection.field)) this.collections.delete(collection.field)
          else this.collections.set(collection.field, collection.records)
          this.collectionLegacy.set(collection.field, collection.legacySnapshot)
        }
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
    delete state.managerOperations[id]
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
