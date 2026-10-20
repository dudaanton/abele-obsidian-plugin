import { z } from 'zod'
import type { LocalStorage } from './ledgerId'

/** Kept apart from the strict single-scope registry so downgrades can still open it. */
export const SETS_KEY = 'abele-sync-connection-sets-v1'
const id = z.string().min(1).max(200)
const itemSchema = z
  .object({
    id,
    scopeId: id,
    kind: z.enum(['folder', 'group', 'file']),
    path: z.string().min(1).max(1024),
    detached: z.boolean(),
    paused: z.boolean(),
    recordId: id.optional(),
  })
  .strict()
const connectionSchema = z
  .object({ id, label: z.string().max(200), items: z.array(itemSchema) })
  .strict()
const documentSchema = z
  .object({ version: z.literal(1), connections: z.array(connectionSchema) })
  .strict()
type Document = z.infer<typeof documentSchema>
export type StoredSetItem = z.infer<typeof itemSchema>
export type SetItem = Omit<StoredSetItem, 'detached' | 'paused' | 'recordId'>
export type ConnectionSet = z.infer<typeof connectionSchema>
const clone = <T>(value: T): T => structuredClone(value)
export function itemUploader(
  items: readonly StoredSetItem[],
  path: string,
  covers: (itemId: string, path: string) => boolean
): string | null {
  const candidates = items.filter((one) => !one.detached && !one.paused && covers(one.id, path))
  const rank = (item: StoredSetItem) =>
    item.kind === 'file'
      ? Number.MAX_SAFE_INTEGER
      : item.kind === 'folder'
        ? item.path.split('/').length
        : 0
  candidates.sort((a, b) => rank(b) - rank(a))
  return candidates[0]?.id ?? null
}

/** Refuse both orders of nested folders; groups may overlap dynamically. */
export function assertItemSet(items: SetItem[]): void {
  if (items.length > 20) throw new Error('A share holds up to 20 items')
  const ids = new Set<string>()
  for (const item of items) {
    itemSchema.parse({ ...item, paused: false, detached: false })
    if (ids.has(item.id)) throw new Error('Duplicate share item')
    ids.add(item.id)
    const covering = items.find(
      (one) =>
        one.id !== item.id &&
        one.kind === 'folder' &&
        (one.path === '/' ||
          (item.kind !== 'group' &&
            (item.path === one.path || item.path.startsWith(one.path + '/'))))
    )
    if (covering) throw new Error(`Already included in folder ${covering.path}`)
  }
}

/** Durable item membership. Detaching preserves the item and its ledger identity. */
export class ConnectionSets {
  private readonly pending = new Map<string, Promise<boolean>>()
  constructor(private readonly storage: LocalStorage) {}

  private read(): Document {
    const raw = this.storage.loadLocalStorage(SETS_KEY)
    if (raw == null) return { version: 1, connections: [] }
    const result = documentSchema.safeParse(raw)
    if (!result.success) throw new Error('Connection sets require recovery')
    const connections = new Set<string>()
    for (const connection of result.data.connections) {
      if (
        connections.has(connection.id) ||
        new Set(connection.items.map((one) => one.id)).size !== connection.items.length
      )
        throw new Error('Connection sets require recovery')
      connections.add(connection.id)
    }
    return result.data
  }
  private save(doc: Document): void {
    const value = documentSchema.parse(doc)
    this.storage.saveLocalStorage(SETS_KEY, clone(value))
    if (JSON.stringify(this.read()) !== JSON.stringify(value))
      throw new Error('Connection sets could not be saved')
  }
  get(connectionId: string): ConnectionSet | null {
    return clone(this.read().connections.find((one) => one.id === connectionId) ?? null)
  }
  all(): ConnectionSet[] {
    return clone(this.read().connections)
  }
  forRecord(recordId: string): { connection: ConnectionSet; item: StoredSetItem } | null {
    for (const connection of this.all()) {
      const item = connection.items.find((one) => one.recordId === recordId)
      if (item) return { connection, item }
    }
    return null
  }
  bind(connectionId: string, itemId: string, recordId: string): void {
    const doc = this.read()
    const item = doc.connections
      .find((one) => one.id === connectionId)
      ?.items.find((one) => one.id === itemId)
    if (!item) throw new Error('Unknown share item')
    if (
      doc.connections.some((one) =>
        one.items.some((other) => other.recordId === recordId && other !== item)
      )
    )
      throw new Error('Item engine already belongs to another share')
    item.recordId = recordId
    this.save(doc)
  }
  forget(connectionId: string): void {
    const doc = this.read()
    doc.connections = doc.connections.filter((one) => one.id !== connectionId)
    this.save(doc)
  }
  recoverLeader(connectionId: string, present: ReadonlySet<string>): string {
    const doc = this.read(),
      connection = doc.connections.find((one) => one.id === connectionId)
    if (!connection) throw new Error('Unknown connection set')
    const next = connection.items.find(
      (item) => item.recordId && present.has(item.recordId)
    )?.recordId
    if (!next) throw new Error('Connection set has no remaining records')
    connection.id = next
    for (const item of connection.items) {
      item.paused = true
      if (item.recordId && !present.has(item.recordId)) {
        delete item.recordId
        item.detached = true
      }
    }
    this.save(doc)
    return next
  }
  create(
    connectionId: string,
    label: string,
    items: SetItem[],
    records: Record<string, string> = {}
  ): void {
    if (!items.length) throw new Error('Choose at least one share item')
    assertItemSet(items)
    const doc = this.read()
    if (doc.connections.some((one) => one.id === connectionId))
      throw new Error('Connection set already exists')
    doc.connections.push({
      id: connectionId,
      label,
      items: items.map((one) => ({
        ...one,
        detached: false,
        paused: false,
        ...(records[one.id] ? { recordId: records[one.id] } : {}),
      })),
    })
    this.save(doc)
  }
  reconcile(connectionId: string, current: SetItem[]): { added: string[]; detached: string[] } {
    assertItemSet(current)
    const doc = this.read()
    const connection = doc.connections.find((one) => one.id === connectionId)
    if (!connection) throw new Error('Unknown connection set')
    const added: string[] = [],
      detached: string[] = []
    for (const item of connection.items) {
      const live = current.find((one) => one.id === item.id)
      if (live && (live.scopeId !== item.scopeId || live.kind !== item.kind))
        throw new Error('Share item identity changed')
      if (!live && !item.detached) detached.push(item.id)
      if (live && item.detached) added.push(item.id)
      item.detached = !live
      if (live) item.path = live.path
    }
    for (const item of current)
      if (!connection.items.some((one) => one.id === item.id)) {
        connection.items.push({ ...item, detached: false, paused: false })
        added.push(item.id)
      }
    this.save(doc)
    return { added, detached }
  }
  pause(connectionId: string, itemId: string, paused: boolean): void {
    const doc = this.read()
    const item = doc.connections
      .find((one) => one.id === connectionId)
      ?.items.find((one) => one.id === itemId)
    if (!item) throw new Error('Unknown share item')
    item.paused = paused
    this.save(doc)
  }
  /** A failed request is never an empty set. Only a missing route means unsupported. */
  refresh(connectionId: string, read: () => Promise<SetItem[] | null>): Promise<boolean> {
    const pending = this.pending.get(connectionId)
    if (pending !== undefined) return pending
    const work = Promise.resolve()
      .then(read)
      .then((items) => {
        if (items === null) return false
        this.reconcile(connectionId, items)
        return true
      })
      .finally(() => {
        this.pending.delete(connectionId)
      })
    this.pending.set(connectionId, work)
    return work
  }
  /** Coverage comes from each live engine, including dynamic group membership. */
  uploader(
    connectionId: string,
    path: string,
    covers: (itemId: string, path: string) => boolean
  ): string | null {
    return itemUploader(this.get(connectionId)?.items ?? [], path, covers)
  }
}
