import { z } from 'zod'
import { normalizeServerUrl, serverUrlProblem } from '@abele/sync-protocol'
import { DEVICE_SECRET_PREFIX } from '@/secrets/deviceSecret'
import type { LocalStorage } from './ledgerId'
import { isLegacyAccessSlot } from './discardLegacyConnections'

export const TOKEN_REGISTRY_KEY = 'abele-sync-connections-v2'
const secretPrefix = DEVICE_SECRET_PREFIX + 'token-'
const id = z.string().min(1).max(200)
const scopeSchema = z
  .object({ kind: z.enum(['folder', 'group']), id, path: z.string().min(1).max(1024) })
  .strict()
export type TokenScope = z.infer<typeof scopeSchema>
/** Metadata from the frozen v2 contract; parsing/QR and HTTP adapters are separate stages. */
export interface ConnectionToken {
  v: 1
  address: string
  key: string
  scope: TokenScope
}
export interface TokenAuthority {
  protocol: 2
  token_id: string
  space_id: string
  scope: TokenScope
  status: 'active' | 'scope_unavailable' | 'scope_updating'
}
/** Only the device keychain may implement this port. Never pass the synced secret store. */
export interface DeviceTokenSecrets {
  get(reference: string): string | null
  set(reference: string, key: string): void
}
const bindingSchema = z
  .object({
    address: z.string(),
    spaceId: id,
    tokenId: id,
    scope: scopeSchema,
    secretReference: z.string().startsWith(secretPrefix),
    ledgerId: id,
  })
  .strict()
const recordSchema = z
  .object({
    id,
    kind: z.literal('token'),
    address: z.string(),
    spaceId: z.string(),
    tokenId: z.string(),
    scope: scopeSchema.nullable(),
    secretReference: z.string(),
    ledgerId: id,
    paused: z.boolean(),
    status: z.enum([
      'needs-token',
      'disconnected',
      'joining',
      'idle',
      'syncing',
      'paused',
      'offline',
      'error',
      'scope_unavailable',
      'scope_updating',
    ]),
    state: z.record(z.string(), z.unknown()),
    pending: bindingSchema.optional(),
  })
  .strict()
export type TokenConnectionRecord = z.infer<typeof recordSchema>
const documentSchema = z
  .object({ version: z.literal(2), selectedId: z.string(), records: z.array(recordSchema) })
  .strict()
type Document = z.infer<typeof documentSchema>
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const recovery = () => new Error('Token connection registry requires recovery')

/**
 * One credential kind. Legacy state is never imported. Writes are verified before
 * proceeding; a prepared token binding can resume after interrupted provisioning.
 */
export class TokenConnectionRegistry {
  private constructor(private readonly local: LocalStorage) {}
  static open(local: LocalStorage): TokenConnectionRegistry {
    const registry = new TokenConnectionRegistry(local)
    if (local.loadLocalStorage(TOKEN_REGISTRY_KEY) != null) {
      registry.document()
      return registry
    }
    registry.write(TOKEN_REGISTRY_KEY, { version: 2, selectedId: '', records: [] })
    registry.document()
    return registry
  }
  private empty(localId: string): TokenConnectionRecord {
    return {
      id: localId,
      kind: 'token',
      address: '',
      spaceId: '',
      tokenId: '',
      scope: null,
      secretReference: '',
      ledgerId: crypto.randomUUID(),
      paused: false,
      status: 'needs-token',
      state: {},
    }
  }
  private write(key: string, value: unknown): void {
    this.local.saveLocalStorage(key, clone(value))
    if (!same(this.local.loadLocalStorage(key), value)) throw recovery()
  }
  private document(): Document {
    const parsed = documentSchema.safeParse(this.local.loadLocalStorage(TOKEN_REGISTRY_KEY))
    if (!parsed.success) throw recovery()
    const doc = parsed.data,
      ids = new Set<string>(),
      owned = new Set<string>()
    for (const record of doc.records) {
      if (ids.has(record.id)) throw recovery()
      ids.add(record.id)
      const claim = (namespace: string, identity: string) => {
        if (!identity) return
        const key = namespace + identity
        if (owned.has(key)) throw recovery()
        owned.add(key)
      }
      claim('ledger:', record.ledgerId)
      claim('secret:', record.secretReference)
      if (record.pending) {
        if (record.pending.ledgerId !== record.ledgerId) claim('ledger:', record.pending.ledgerId)
        if (record.pending.secretReference !== record.secretReference)
          claim('secret:', record.pending.secretReference)
      }
      if (
        (record.secretReference ||
          record.scope ||
          record.tokenId ||
          ['idle', 'syncing', 'paused', 'scope_unavailable', 'scope_updating'].includes(
            record.status
          )) &&
        (!record.secretReference.startsWith(secretPrefix) ||
          !record.scope ||
          !record.tokenId ||
          !record.spaceId ||
          serverUrlProblem(record.address))
      )
        throw recovery()
    }
    if (doc.selectedId ? !ids.has(doc.selectedId) : ids.size > 0) throw recovery()
    return doc
  }
  get selectedId(): string {
    return this.document().selectedId
  }
  records(): TokenConnectionRecord[] {
    return clone(this.document().records)
  }
  private record(doc: Document, localId: string): TokenConnectionRecord {
    const record = doc.records.find((entry) => entry.id === localId)
    if (!record) throw recovery()
    return record
  }
  add(): string {
    const doc = this.document(),
      localId = crypto.randomUUID()
    doc.records.push(this.empty(localId))
    if (!doc.selectedId) doc.selectedId = localId
    this.write(TOKEN_REGISTRY_KEY, doc)
    return localId
  }
  select(localId: string): void {
    const doc = this.document()
    this.record(doc, localId)
    doc.selectedId = localId
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  /** Metadata removal only. Independent credential/database teardown belongs to the runtime. */
  forget(localId: string): void {
    const doc = this.document()
    this.record(doc, localId)
    doc.records = doc.records.filter((entry) => entry.id !== localId)
    if (doc.selectedId === localId) doc.selectedId = doc.records[0]?.id ?? ''
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  setPaused(localId: string, paused: boolean): void {
    const doc = this.document(),
      record = this.record(doc, localId)
    record.paused = paused
    if (record.status === 'idle' || record.status === 'paused')
      record.status = paused ? 'paused' : 'idle'
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  setStatus(localId: string, status: TokenConnectionRecord['status']): void {
    const doc = this.document(),
      record = this.record(doc, localId)
    if (
      ['idle', 'syncing', 'paused', 'scope_unavailable', 'scope_updating'].includes(status) &&
      (!record.secretReference || record.pending)
    )
      throw new Error('Connection needs a token')
    record.status = status
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  /** New engine state is device-only and permanently bound to this local ID. */
  storage(localId: string): LocalStorage {
    this.record(this.document(), localId)
    return Object.assign(
      {
        loadLocalStorage: (key: string) => {
          const record = this.record(this.document(), localId)
          if (isLegacyAccessSlot(key)) return null
          return key.startsWith('abele-sync-token-state:')
            ? clone(record.state[key] ?? null)
            : this.local.loadLocalStorage(key)
        },
        saveLocalStorage: (key: string, value: unknown) => {
          if (isLegacyAccessSlot(key)) throw new Error('Legacy access slot is retired')
          const doc = this.document(),
            record = this.record(doc, localId)
          if (!key.startsWith('abele-sync-token-state:')) {
            this.local.saveLocalStorage(key, value)
            return
          }
          record.state[key] = clone(value)
          this.write(TOKEN_REGISTRY_KEY, doc)
        },
      },
      { [Symbol.for('abele.sync.connection-storage')]: localId }
    )
  }
  /** Caller must obtain authority via GET /v2/connection using this exact key. */
  attach(
    localId: string,
    token: ConnectionToken,
    authority: TokenAuthority,
    secrets: DeviceTokenSecrets
  ): void {
    const address = normalizeServerUrl(token.address)
    if (
      token.v !== 1 ||
      !address ||
      serverUrlProblem(token.address) ||
      !/^[A-Za-z0-9_-]{43}$/.test(token.key) ||
      authority.protocol !== 2 ||
      !id.safeParse(authority.token_id).success ||
      !id.safeParse(authority.space_id).success ||
      !scopeSchema.safeParse(authority.scope).success ||
      !scopeSchema.safeParse(token.scope).success ||
      token.scope.kind !== authority.scope.kind ||
      token.scope.id !== authority.scope.id ||
      !['active', 'scope_unavailable', 'scope_updating'].includes(authority.status)
    )
      throw new Error('Invalid v2 token connection')
    const doc = this.document(),
      record = this.record(doc, localId)
    const status =
      authority.status === 'active' ? (record.paused ? 'paused' : 'idle') : authority.status
    if (
      !record.pending &&
      record.secretReference &&
      record.address === address &&
      record.spaceId === authority.space_id &&
      record.tokenId === authority.token_id &&
      record.scope?.kind === authority.scope.kind &&
      record.scope.id === authority.scope.id &&
      secrets.get(record.secretReference) === token.key
    ) {
      record.scope = clone(authority.scope)
      record.status = status
      this.write(TOKEN_REGISTRY_KEY, doc)
      return
    }
    if (record.secretReference)
      throw new Error(
        'A different token requires a new local connection; existing state is retained'
      )
    const identity = {
      address,
      spaceId: authority.space_id,
      tokenId: authority.token_id,
      scope: authority.scope,
    }
    if (
      record.pending &&
      !same(
        {
          address: record.pending.address,
          spaceId: record.pending.spaceId,
          tokenId: record.pending.tokenId,
          scope: record.pending.scope,
        },
        identity
      )
    )
      throw recovery()
    if (!record.pending) {
      record.pending = {
        ...identity,
        secretReference: secretPrefix + crypto.randomUUID(),
        ledgerId: record.ledgerId,
      }
      record.status = 'needs-token'
      this.write(TOKEN_REGISTRY_KEY, doc)
    }
    const pending = record.pending
    const saved = secrets.get(pending.secretReference)
    if (saved != null && saved !== token.key) throw recovery()
    if (saved == null) secrets.set(pending.secretReference, token.key)
    if (secrets.get(pending.secretReference) !== token.key) throw recovery()
    Object.assign(record, pending)
    delete record.pending
    record.status = status
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
}
