import { objectOf, readConnection, type DeviceConnection } from './connection'
import { readLedgerId, type LedgerId, type LocalStorage } from './ledgerId'
import type { ScopedLocalConnection } from './scoped/scopedJoin'

export const REGISTRY_KEY = 'abele-sync-connections-v1'
export const CONNECTION_STORAGE = Symbol.for('abele.sync.connection-storage')

/** Local slots consumed by existing engines. Their contents and database identities stay intact. */
const LEGACY_KEYS = [
  'abele-sync-connection',
  'abele-sync-ledger',
  'abele-sync-ledger-proof',
  'abele-sync-ledger-bootstrap',
  'abele-sync-ledger-cleanup',
  'abele-sync-writes',
  'abele-sync-recovered-writes',
  'abele-sync-restore-keys',
  'abele-sync-scoped-connection',
  'abele-sync-scoped-join',
  'abele-scoped-paused',
  'abele-scoped-access-removed',
  'abele-scoped-display-name',
  'scoped-creation-journal-v1',
  'abele-sync-external-activation-v1',
  'abele-sync-external-connection-switch-v1',
  'abele-sync-external-generation-v1',
  'abele-sync-external-retired-v1',
  'abele-sync-external-inspection-v1',
  'abele-owner-publication',
  'abele-owner-publication-stores-v1',
  'owner-publication-audiences-v1',
] as const

type Kind = 'personal' | 'scoped'
export type ConnectionStatus =
  | 'disconnected'
  | 'joining'
  | 'idle'
  | 'syncing'
  | 'paused'
  | 'offline'
  | 'error'
interface StoredRecord {
  id: string
  kind: Kind
  slots: Record<string, unknown>
  status: ConnectionStatus
}
interface RegistryDocument {
  version: 1
  selectedId: string
  records: StoredRecord[]
}
interface RecordFields {
  id: string
  endpoint: string
  vaultId: string
  principalId: string
  secretReference: string
  paused: boolean
  status: ConnectionStatus
}
/** Keep the personal and scoped state models separate; never reinterpret one ledger as another. */
export type ConnectionRecord = RecordFields &
  (
    | {
        kind: 'personal'
        state: DeviceConnection
        ledger: LedgerId
        scope: DeviceConnection['selective']
      }
    | {
        kind: 'scoped'
        state: ScopedLocalConnection | null
        ledger: string
        scope: { grantId: string; rootFileId: string; role: string }
      }
  )

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const recovery = () => new Error('Connection registry requires recovery')

function inspect(raw: unknown): RegistryDocument {
  const o = objectOf(raw)
  if (o?.version !== 1 || typeof o.selectedId !== 'string' || !Array.isArray(o.records))
    throw recovery()
  const ids = new Set<string>()
  for (const item of o.records) {
    const record = objectOf(item)
    if (
      !record ||
      typeof record.id !== 'string' ||
      !record.id ||
      ids.has(record.id) ||
      typeof record.kind !== 'string' ||
      !['personal', 'scoped'].includes(record.kind) ||
      !objectOf(record.slots) ||
      typeof record.status !== 'string' ||
      !['disconnected', 'joining', 'idle', 'syncing', 'paused', 'offline', 'error'].includes(
        record.status
      )
    )
      throw recovery()
    ids.add(record.id)
  }
  if (o.selectedId ? !ids.has(o.selectedId) : ids.size !== 0) throw recovery()
  assertIndependent(o as unknown as RegistryDocument)
  return copy(o as unknown as RegistryDocument)
}

/** A copied descriptor must never make Forget delete another connection's database or secret. */
function assertIndependent(doc: RegistryDocument): void {
  const owners = new Map<string, string>()
  const own = (record: StoredRecord, namespace: string, id: unknown) => {
    if (typeof id !== 'string' || !id) return
    const key = namespace + id
    if (owners.has(key) && owners.get(key) !== record.id)
      throw new Error('Connection identity is already owned by another record; recovery required')
    owners.set(key, record.id)
  }
  for (const record of doc.records) {
    const slots = record.slots
    for (const key of [
      'abele-sync-ledger',
      'abele-sync-ledger-proof',
      'abele-sync-ledger-bootstrap',
    ])
      ownDatabase(record, 'abele-sync-', objectOf(slots[key])?.stateId)
    const cleanup = slots['abele-sync-ledger-cleanup']
    if (Array.isArray(cleanup)) for (const id of cleanup) ownDatabase(record, 'abele-sync-', id)
    const personal = objectOf(slots['abele-sync-connection'])
    own(record, 'secret:', personal?.deviceTokenId)
    if (Array.isArray(personal?.pendingRevoke))
      for (const pending of personal.pendingRevoke)
        own(record, 'secret:', objectOf(pending)?.tokenId)
    const join = objectOf(slots['abele-sync-scoped-join'])
    own(record, 'secret:', join?.invitationId)
    for (const scoped of [
      objectOf(slots['abele-sync-scoped-connection']),
      objectOf(join?.connection),
    ]) {
      ownDatabase(record, 'abele-scoped-', scoped?.ledgerId)
      ownDatabase(record, 'abele-scoped-native-', scoped?.ledgerId)
      own(record, 'secret:', scoped?.tokenId)
    }
    for (const [key, value] of Object.entries(slots))
      if (key === 'abele-owner-publication' || key.startsWith('abele-owner-publication:'))
        ownDatabase(record, 'abele-link-snapshots-', objectOf(value)?.id)
    const retired = slots['abele-sync-external-retired-v1']
    const activations = [
      slots['abele-sync-external-activation-v1'],
      ...(Array.isArray(retired) ? retired : []),
    ]
    for (const activation of activations) {
      const ledgers = objectOf(activation)?.ledgers
      if (Array.isArray(ledgers))
        for (const ledger of ledgers) own(record, 'database:', objectOf(ledger)?.databaseName)
    }
  }
  function ownDatabase(record: StoredRecord, prefix: string, id: unknown) {
    if (typeof id === 'string' && id) own(record, 'database:', prefix + id)
  }
}

/**
 * Device-local registry behind a portable storage port. Migration is one verified write:
 * before it, all legacy slots remain authoritative; after it, only this document is read.
 * No token or IndexedDB data is copied, rewritten or re-enrolled. Legacy slots are retained
 * as recovery evidence, but never consulted again, including after Forget.
 */
export class ConnectionRegistry {
  private constructor(private readonly local: LocalStorage) {}

  static open(local: LocalStorage, extraLegacyKeys: string[] = []): ConnectionRegistry {
    const registry = new ConnectionRegistry(local)
    if (local.loadLocalStorage(REGISTRY_KEY) != null) {
      registry.document()
      return registry
    }
    const slots: Record<string, unknown> = {}
    const catalogue = local.loadLocalStorage('abele-owner-publication-stores-v1')
    const descriptors = Array.isArray(catalogue)
      ? catalogue.flatMap((entry: unknown) => {
          const key = objectOf(entry)?.key
          return typeof key === 'string' && key.startsWith('abele-owner-publication:') ? [key] : []
        })
      : []
    for (const key of new Set<string>([...LEGACY_KEYS, ...descriptors, ...extraLegacyKeys])) {
      if (!registry.owns(key)) throw recovery()
      const value = local.loadLocalStorage(key)
      if (value != null) slots[key] = copy(value)
    }
    const id = crypto.randomUUID()
    registry.persist({
      version: 1,
      selectedId: id,
      records: [
        {
          id,
          kind:
            slots['abele-sync-scoped-connection'] || slots['abele-sync-scoped-join']
              ? 'scoped'
              : 'personal',
          slots,
          status: 'disconnected',
        },
      ],
    })
    return registry
  }

  private document(): RegistryDocument {
    return inspect(this.local.loadLocalStorage(REGISTRY_KEY))
  }
  private persist(value: RegistryDocument): void {
    assertIndependent(value)
    this.local.saveLocalStorage(REGISTRY_KEY, copy(value))
    if (!equal(this.local.loadLocalStorage(REGISTRY_KEY), value)) throw recovery()
  }
  private record(id: string, doc = this.document()): StoredRecord {
    const record = doc.records.find((entry) => entry.id === id)
    if (!record) throw new Error('Connection was forgotten; recovery required')
    return record
  }
  private owns(key: string): boolean {
    return (
      (LEGACY_KEYS as readonly string[]).includes(key) ||
      key.startsWith('abele-owner-publication:') ||
      key.startsWith('abele-sync-runtime-owner-v1:')
    )
  }
  get selectedId(): string {
    return this.document().selectedId
  }

  add(kind: Kind): string {
    const doc = this.document()
    const id = crypto.randomUUID()
    doc.records.push({ id, kind, slots: {}, status: 'disconnected' })
    if (!doc.selectedId) doc.selectedId = id
    this.persist(doc)
    return id
  }

  /** Only the runtime owner may change selection, after stopping the current engine. */
  select(id: string): void {
    const doc = this.document()
    this.record(id, doc)
    doc.selectedId = id
    this.persist(doc)
  }

  /** Metadata removal only. The caller must first finish credential/database teardown. */
  forget(id: string): void {
    const doc = this.document()
    this.record(id, doc)
    doc.records = doc.records.filter((entry) => entry.id !== id)
    if (doc.selectedId === id) doc.selectedId = doc.records[0]?.id ?? ''
    this.persist(doc)
  }

  setStatus(id: string, status: ConnectionStatus): void {
    const doc = this.document()
    const record = this.record(id, doc)
    if (record.status === status) return
    record.status = status
    this.persist(doc)
  }

  records(): ConnectionRecord[] {
    return this.document().records.map((record) => {
      const storage = this.storage(record.id)
      if (record.kind === 'scoped') {
        const state = storage.loadLocalStorage(
          'abele-sync-scoped-connection'
        ) as ScopedLocalConnection | null
        return {
          id: record.id,
          kind: 'scoped',
          state,
          endpoint: state?.issuer ?? '',
          vaultId: state?.vaultId ?? '',
          principalId: state?.principalId ?? '',
          secretReference: state?.tokenId ?? '',
          ledger: state?.ledgerId ?? '',
          paused: storage.loadLocalStorage('abele-scoped-paused') === true,
          status: record.status,
          scope: {
            grantId: state?.grantId ?? '',
            rootFileId: state?.rootFileId ?? '',
            role: state?.role ?? '',
          },
        }
      }
      const state = readConnection(storage)
      return {
        id: record.id,
        kind: 'personal',
        state,
        endpoint: state.serverUrl,
        vaultId: state.vaultId,
        principalId: state.deviceId,
        secretReference: state.deviceTokenId,
        ledger: readLedgerId(storage),
        paused: state.paused,
        status: record.status,
        scope: state.selective,
      }
    })
  }

  /** A view permanently bound to its ID; selecting or forgetting another record cannot redirect it. */
  storage(id: string): LocalStorage {
    this.record(id)
    return Object.assign(
      {
        loadLocalStorage: (key: string) => {
          const record = this.record(id)
          return this.owns(key) ? copy(record.slots[key] ?? null) : this.local.loadLocalStorage(key)
        },
        saveLocalStorage: (key: string, value: unknown) => {
          const doc = this.document()
          const record = this.record(id, doc)
          if (!this.owns(key)) {
            this.local.saveLocalStorage(key, value)
            return
          }
          record.slots[key] = copy(value)
          if (key === 'abele-sync-scoped-connection' && value != null) record.kind = 'scoped'
          if (key === 'abele-sync-scoped-join' && value != null) record.kind = 'scoped'
          if (key === 'abele-sync-connection' && objectOf(value)?.deviceTokenId)
            record.kind = 'personal'
          this.persist(doc)
        },
      },
      { [CONNECTION_STORAGE]: id }
    )
  }
}

/** Compatibility port for existing dialogs which receive the original App local storage. */
export function selectedConnectionStorage(local: LocalStorage): LocalStorage {
  if ((local as LocalStorage & { [CONNECTION_STORAGE]?: string })[CONNECTION_STORAGE]) return local
  if (local.loadLocalStorage(REGISTRY_KEY) == null) return local
  const registry = ConnectionRegistry.open(local)
  return registry.storage(registry.selectedId)
}

/** Recovery sentinels are vault files; only the record owning their local descriptor may retire them. */
export function otherConnectionOwnsSlot(local: LocalStorage, key: string): boolean {
  const raw = local.loadLocalStorage(REGISTRY_KEY)
  if (raw == null) return false
  const doc = inspect(raw)
  const id =
    (local as LocalStorage & { [CONNECTION_STORAGE]?: string })[CONNECTION_STORAGE] ??
    doc.selectedId
  return doc.records.some(
    (record) =>
      record.id !== id &&
      (record.slots[key] != null ||
        (Array.isArray(record.slots['abele-owner-publication-stores-v1']) &&
          record.slots['abele-owner-publication-stores-v1'].some(
            (entry: unknown) => objectOf(entry)?.key === key
          )))
  )
}
