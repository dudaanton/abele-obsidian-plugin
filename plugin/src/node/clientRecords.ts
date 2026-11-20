import type { NodeClientState } from './NodeClientStore'
import { frozen, plain, sameStoredValue, storeDraft } from './storeDraft'
import { DELETE_RECORD, RecordTable, tableOf } from './recordTable'
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
interface IndexRow {
  key: string
  order: number
  deleted?: boolean
}
interface Snapshot {
  value: unknown
  order: number
  toolsRef?: string
}
const RECORD_ORDER = 'record-order:'
const orderKey = (key: string, order: number) => RECORD_ORDER + order + ':' + key
const RECORD_LOG = 'record-log'
const RECORD_DELETED = 'record-deleted:'
export const RECORD_LOG_WINDOW = 1024

type Change = { key: string; value?: unknown; deleted?: boolean }
const fieldOf = (key: string): Field => {
  const field = RECORD_FIELDS.find((field) => key.startsWith('record:' + field + ':'))
  if (!field) throw new Error('Invalid node record collection')
  return field
}
const read = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

/** A bounded change log carries row revisions and deletions between warm handles.
 * Warm handles read just changed rows; immutable collection revisions share unchanged paths.
 * No committed cache is mutated until the enclosing IndexedDB transaction completes. */
export class ClientRecords {
  private snapshots = new Map<string, Snapshot>()
  private toolSnapshots = new Map<string, unknown>()
  private toolReferences = new Map<string, number>()
  private collections = new Map<Field, Record<string, unknown>>()
  private collectionLegacy = new Map<Field, unknown>()
  private backing = new Map<Field, RecordTable>()
  private legacyPending = new Map<Field, boolean>()
  private legacyPresent = new Map<Field, boolean>()
  private stamp?: string
  private version?: number
  private legacyKeys = new Set<string>()
  private deletedLegacy = new Set<string>()
  private orphanTools = new Map<string, string>()
  private orphanReferences = new Map<string, number>()
  constructor(private readonly validate: (field: Field, value: unknown) => void) {}

  async load(tx: IDBTransaction, state: NodeClientState, readonly = false) {
    const store = tx.objectStore('client')
    const [rawStamp, rawVersion, rawOrder] = await Promise.all([
      read(store.get('records-stamp')),
      read(store.get('records-version')),
      read(store.get('records-order')),
    ])
    let stamp = rawStamp as string | undefined
    let version = (rawVersion ?? 0) as number
    let order = (rawOrder ?? 0) as number
    // Readers outside the bounded log rebuild once from live rows and legacy maps.
    const cold =
      this.version === undefined ||
      version - this.version > RECORD_LOG_WINDOW ||
      (this.stamp !== stamp && version <= this.version)
    const legacyKeys = cold ? new Set<string>() : this.legacyKeys
    const deletedLegacy = cold ? new Set<string>() : this.deletedLegacy
    const markers = new Map<string, boolean>()
    const isDeleted = (key: string) =>
      markers.has(key) ? markers.get(key)! : deletedLegacy.has(key)
    const orphans = new Map<string, string | undefined>()
    const orphanReferences = new Map<string, number>()
    const orphanCount = (ref: string) =>
      orphanReferences.get(ref) ?? (cold ? 0 : (this.orphanReferences.get(ref) ?? 0))
    const orphan = (key: string, next?: string) => {
      const before = orphans.has(key)
        ? orphans.get(key)
        : cold
          ? undefined
          : this.orphanTools.get(key)
      if (before === next) return
      if (before) orphanReferences.set(before, orphanCount(before) - 1)
      if (next) orphanReferences.set(next, orphanCount(next) + 1)
      orphans.set(key, next)
    }
    const base = cold ? new Map<string, Snapshot>() : this.snapshots
    const updates = new Map<string, Snapshot | undefined>()
    const tools = new Map<string, unknown>()
    const references = new Map<string, number>()
    const referenceBase = cold ? new Map<string, number>() : this.toolReferences
    const count = (ref: string) => references.get(ref) ?? referenceBase.get(ref) ?? 0
    const get = (key: string) => (updates.has(key) ? updates.get(key) : base.get(key))
    const set = (key: string, next?: Snapshot) => {
      const before = get(key)
      if (before?.toolsRef !== next?.toolsRef) {
        if (before?.toolsRef) references.set(before.toolsRef, count(before.toolsRef) - 1)
        if (next?.toolsRef) references.set(next.toolsRef, count(next.toolsRef) + 1)
      }
      updates.set(key, next)
    }
    const loadingTools = new Map<string, Promise<unknown>>()
    const loadTools = async (reference: string) => {
      if (tools.has(reference)) return tools.get(reference)
      if (this.toolSnapshots.has(reference)) {
        tools.set(reference, this.toolSnapshots.get(reference))
        return tools.get(reference)
      }
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
    let rows: IndexRow[] = []
    const missingLegacy: string[] = []
    if (cold) {
      const allKeys = await read(store.getAllKeys())
      const ordered = new Map<string, IndexRow>()
      for (const key of allKeys) {
        if (typeof key === 'string' && key.startsWith(RECORD_DELETED)) {
          deletedLegacy.add(key.slice(RECORD_DELETED.length))
          continue
        }
        if (typeof key !== 'string' || !key.startsWith(RECORD_ORDER)) continue
        const at = key.indexOf(':', RECORD_ORDER.length)
        const row = { key: key.slice(at + 1), order: Number(key.slice(RECORD_ORDER.length, at)) }
        if (!ordered.has(row.key) || ordered.get(row.key)!.order < row.order)
          ordered.set(row.key, row)
      }
      rows = [...ordered.values()]
      const indexed = new Set(rows.map((row) => row.key))
      const legacy = Object.assign(
        {},
        ...(await Promise.all(
          ['record-revisions', 'delegation-revisions', 'extra-record-revisions'].map(
            async (key) => {
              const value = await read(store.get(key))
              if (!value) missingLegacy.push(key)
              return value ?? {}
            }
          )
        ))
      ) as Record<string, string>
      let legacyOrder = -Object.keys(legacy).length
      for (const key of Object.keys(legacy)) {
        legacyKeys.add(key)
        if (!indexed.has(key)) rows.push({ key, order: legacyOrder })
        ++legacyOrder
      }
    } else if (this.stamp !== stamp) {
      const logs = (await Promise.all(
        Array.from({ length: version - this.version! }, (_, i) =>
          read(store.get([RECORD_LOG, this.version! + i + 1]))
        )
      )) as { version: number; changes: IndexRow[] }[]
      const changed = new Map<string, IndexRow>()
      for (const log of logs) {
        if (!log) throw new Error('Missing node record revision log')
        for (const row of log.changes) changed.set(row.key, row)
      }
      rows = [...changed.values()]
    }
    if (cold) rows.sort((a, b) => a.order - b.order)
    const loaded = await Promise.all(
      rows.map(async (row): Promise<[string, Snapshot | undefined]> => {
        if (row.deleted && !legacyKeys.has(row.key)) return [row.key, undefined]
        if (!cold && !row.deleted && isDeleted(row.key)) {
          markers.set(row.key, false)
          orphan(row.key)
        }
        if (row.deleted) markers.set(row.key, true)
        const field = fieldOf(row.key)
        let value = await read(store.get(row.key))
        if (isDeleted(row.key)) {
          const ref = (value as { toolsRef?: unknown } | undefined)?.toolsRef
          orphan(row.key, typeof ref === 'string' ? ref : undefined)
          return [row.key, undefined]
        }
        if (value === undefined) return [row.key, undefined]
        let toolsRef: string | undefined
        if (
          field === 'delegationTasks' &&
          value &&
          typeof value === 'object' &&
          'toolsRef' in value
        ) {
          const { toolsRef: reference, ...task } = value as {
            toolsRef: string
            request: Record<string, unknown>
          }
          toolsRef = reference
          value = {
            ...task,
            request: { ...task.request, obsidian_tools: await loadTools(reference) },
          }
        }
        if (field === 'chatMutations') value = unpackMutation(value)
        this.validate(field, value)
        return [row.key, { value: frozen(value), order: row.order, toolsRef }]
      })
    )
    for (const [key, snapshot] of loaded) set(key, snapshot)
    const changedByField = new Map<Field, [string, Snapshot | undefined][]>()
    for (const [key, snapshot] of updates) {
      const field = fieldOf(key)
      const list = changedByField.get(field) ?? []
      list.push([key.slice(('record:' + field + ':').length), snapshot])
      changedByField.set(field, list)
    }
    const collections = RECORD_FIELDS.map((field) => {
      const legacy = (field === 'delegationTasks' ? state.delegation?.tasks : state[field]) as
        | Record<string, unknown>
        | undefined
      const rawLegacy = legacy ? plain(legacy) : undefined
      const hasLegacy =
        !!rawLegacy &&
        (this.collectionLegacy.get(field) === rawLegacy
          ? (this.legacyPresent.get(field) ?? false)
          : Object.keys(rawLegacy).length > 0)
      const legacySnapshot =
        hasLegacy || (field === 'delegationTasks' && rawLegacy) ? rawLegacy : undefined
      const prefix = 'record:' + field + ':'
      const changed = (changedByField.get(field) ?? []).map(
        ([id, snapshot]) => [id, snapshot ? snapshot.value : DELETE_RECORD] as const
      )
      const backing = (
        cold ? new RecordTable() : (this.backing.get(field) ?? new RecordTable())
      ).patch(changed)
      const legacyChanged = cold || this.collectionLegacy.get(field) !== legacySnapshot
      let records = cold ? undefined : this.collections.get(field)
      let table = records ? tableOf(records)! : backing
      if (legacyChanged) {
        table = field === 'delegationTasks' && rawLegacy ? new RecordTable() : backing
        const legacyRows: [string, unknown][] = []
        for (const [id, value] of Object.entries(rawLegacy ?? {})) {
          const retained = get(prefix + id)?.value
          const current = plain(value)
          legacyRows.push([
            id,
            retained && sameStoredValue(retained, current) ? retained : frozen(current),
          ])
        }
        table = table.patch(legacyRows)
      } else table = records === this.backing.get(field)?.view ? backing : table.patch(changed)
      const legacyImport =
        legacySnapshot !== undefined && (legacyChanged || this.legacyPending.get(field))
      records = table.view
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
      return {
        field,
        prefix,
        records,
        draft,
        legacy: legacyImport,
        hasLegacy,
        legacySnapshot,
        backing,
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
    const checked = new Map<Field, { source: unknown; revision: number; changes: Change[] }>()
    const changes = () =>
      collections.flatMap((collection) => {
        const { prefix, records, draft } = collection
        const source = collection.current()
        if (
          !collection.legacy &&
          (source === records || (source === draft.value && !draft.changed()))
        )
          return []
        const revision = draft.revision()
        const sparse = !collection.legacy && source === draft.value
        const before = checked.get(collection.field)
        if (sparse && before?.source === source && before.revision === revision)
          return before.changes
        const changes: Change[] = []
        const current = sparse ? source : plain(source)
        const ids = sparse
          ? [...draft.editedKeys()].map(String)
          : [
              ...new Set([
                ...Object.keys(records),
                ...Object.keys(current),
                ...(collection.legacy ? Object.keys(collection.backing.view) : []),
              ]),
            ]
        for (const id of ids) {
          const key = prefix + id,
            value = plain(current[id])
          if (!Object.hasOwn(current, id)) {
            if (get(key)) changes.push({ key, deleted: true })
          } else if (!get(key) || !sameStoredValue(value, get(key)!.value))
            changes.push({ key, value })
        }
        checked.set(collection.field, { source, revision, changes })
        return changes
      })
    const savedChanges: Change[] = []
    let saved = false
    const edited = (field?: Field) =>
      collections.some(
        (c) =>
          (!field || c.field === field) &&
          (c.draft.changed() || (c.current() !== c.records && c.current() !== c.draft.value))
      )
    return {
      edited,
      changed: (field?: Field) =>
        changes().some((c) => !field || c.key.startsWith('record:' + field + ':')),
      delegationChanged: () => changes().some((c) => c.key.startsWith('record:delegationTasks:')),
      delegationSnapshot: () => frozen(plain({ tasks: state.delegation.tasks })),
      save: () => {
        saved = true
        for (const key of missingLegacy) store.put({}, key)
        const pending = changes()
        savedChanges.push(...pending)
        if (!pending.length) {
          if (!stamp) {
            stamp = crypto.randomUUID()
            store.put(stamp, 'records-stamp')
          }
          return
        }
        return (async () => {
          const log: IndexRow[] = []
          ++version
          for (const [i, update] of pending.entries()) {
            if (i && i % 4 === 0) await read(store.count('state'))
            const previous = get(update.key)
            if (update.deleted) {
              if (legacyKeys.has(update.key)) {
                // Older readers still resolve these immutable manifest entries. Keep
                // their payloads on disk while current readers honor the tombstone.
                markers.set(update.key, true)
                store.put(0, RECORD_DELETED + update.key)
                orphan(update.key, previous?.toolsRef)
              } else store.delete(update.key)
              if (previous) store.delete(orderKey(update.key, previous.order))
              log.push({ key: update.key, order: previous?.order ?? 0, deleted: true })
              set(update.key)
              continue
            }
            const field = fieldOf(update.key)
            if (isDeleted(update.key)) {
              markers.set(update.key, false)
              store.delete(RECORD_DELETED + update.key)
              orphan(update.key)
            }
            this.validate(field, update.value)
            let stored = update.value,
              value = update.value
            let toolsRef: string | undefined
            if (field === 'delegationTasks') {
              const task = value as NonNullable<NodeClientState['delegationTasks']>[string]
              const snapshot = task.request.obsidian_tools
              if (snapshot) {
                toolsRef =
                  'delegation-tools:' +
                  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(snapshot))))
                if (!tools.has(toolsRef) && !this.toolSnapshots.has(toolsRef)) {
                  store.put(snapshot, toolsRef)
                  tools.set(toolsRef, frozen(snapshot))
                }
                const { obsidian_tools: _tools, ...request } = task.request
                stored = { ...task, request, toolsRef }
                value = {
                  ...task,
                  request: {
                    ...task.request,
                    obsidian_tools: tools.get(toolsRef) ?? this.toolSnapshots.get(toolsRef),
                  },
                }
              }
            }
            if (field === 'chatMutations') stored = packMutation(stored as NodeMutationRecord)
            const rowOrder = previous?.order ?? ++order
            store.put(stored, update.key)
            store.put(0, orderKey(update.key, rowOrder))
            log.push({ key: update.key, order: rowOrder })
            set(update.key, { value: frozen(value), toolsRef, order: rowOrder })
          }
          // Only references owned by changed rows can become unreferenced.
          for (const reference of new Set([...references.keys(), ...orphanReferences.keys()]))
            if (count(reference) === 0 && orphanCount(reference) === 0) store.delete(reference)
          store.put({ version, changes: log }, [RECORD_LOG, version])
          store.delete([RECORD_LOG, version - RECORD_LOG_WINDOW])
          store.put(order, 'records-order')
          store.put(version, 'records-version')
          stamp = crypto.randomUUID()
          store.put(stamp, 'records-stamp')
        })()
      },
      committed: () => {
        if (cold) {
          this.snapshots = new Map()
          this.collections = new Map()
          this.backing = new Map()
          this.legacyPending = new Map()
          this.legacyPresent = new Map()
          this.toolReferences = new Map()
          this.toolSnapshots = new Map()
          this.orphanTools = new Map()
          this.orphanReferences = new Map()
        }
        this.legacyKeys = legacyKeys
        this.deletedLegacy = deletedLegacy
        for (const [key, deleted] of markers)
          if (deleted) this.deletedLegacy.add(key)
          else this.deletedLegacy.delete(key)
        for (const [key, reference] of orphans)
          if (reference) this.orphanTools.set(key, reference)
          else this.orphanTools.delete(key)
        for (const [reference, count] of orphanReferences)
          if (count) this.orphanReferences.set(reference, count)
          else this.orphanReferences.delete(reference)
        for (const [key, snapshot] of updates)
          if (snapshot) this.snapshots.set(key, snapshot)
          else this.snapshots.delete(key)
        for (const [reference, value] of tools) this.toolSnapshots.set(reference, value)
        for (const [reference, count] of references) {
          if (count) this.toolReferences.set(reference, count)
          else {
            this.toolReferences.delete(reference)
            this.toolSnapshots.delete(reference)
          }
        }
        this.stamp = stamp
        this.version = version
        for (const c of collections) {
          let table = tableOf(c.records)!
          // Only saved rows change the cached immutable collection. Reads retain even
          // metadata-only legacy views without publishing transaction drafts.
          const patches: [string, unknown][] = []
          for (const change of savedChanges) {
            if (!change.key.startsWith(c.prefix)) continue
            const id = change.key.slice(c.prefix.length)
            const snapshot = get(change.key)
            patches.push([id, snapshot ? snapshot.value : DELETE_RECORD])
          }
          table = table.patch(patches)
          this.backing.set(c.field, c.records === c.backing.view ? table : c.backing.patch(patches))
          this.legacyPending.set(c.field, !!c.legacy && !saved)
          this.legacyPresent.set(c.field, c.hasLegacy)
          this.collections.set(c.field, table.view)
          this.collectionLegacy.set(c.field, c.legacySnapshot)
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
