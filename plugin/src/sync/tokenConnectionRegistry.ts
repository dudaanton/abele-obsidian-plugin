import { assertPhysicalPath } from './external/projection'
import { z } from 'zod'
import { Platform } from 'obsidian'
import type { SelectiveSettings } from '@abele/sync-sdk/core'
import { defaultSelective, selectiveProblem } from './connection'
import { normalizeServerUrl, serverUrlProblem, PathSchema } from '@abele/sync-sdk/protocol'
import { DEVICE_SECRET_PREFIX } from '@/secrets/deviceSecret'
import type { LocalStorage } from './ledgerId'
import { isLegacyAccessSlot } from './discardLegacyConnections'
import { LocalPlacementError } from './localFolderPlacement'

export const TOKEN_REGISTRY_KEY = 'abele-sync-connections-v2'
const secretPrefix = DEVICE_SECRET_PREFIX + 'token-'
const id = z.string().min(1).max(200)
const localRootSchema = z
  .string()
  .refine(
    (path) =>
      PathSchema.safeParse(path).success &&
      !path.includes('\\') &&
      path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  )
const physicalRootSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((path) => {
    try {
      if (path !== '/') assertPhysicalPath(path)
      return true
    } catch {
      return false
    }
  })
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
    trusted: z.boolean().optional(),
    localRoot: physicalRootSchema.optional(),
    serverRoot: localRootSchema.optional(),
    rootIssue: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('deleted') }).strict(),
        z
          .object({ kind: z.literal('server-renamed'), from: localRootSchema, to: localRootSchema })
          .strict(),
        z.object({ kind: z.literal('moved'), path: physicalRootSchema }).strict(),
      ])
      .optional(),
    selective: z
      .custom<SelectiveSettings>((value) => selectiveProblem(value, defaultSelective()) === null)
      .optional(),
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
  .object({
    version: z.literal(2),
    selectedId: z.string(),
    records: z.array(recordSchema),
    cleanup: z
      .array(z.object({ id, references: z.array(z.string().startsWith(secretPrefix)) }).strict())
      .optional(),
  })
  .strict()
type Document = z.infer<typeof documentSchema>
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const recovery = () => new Error('Token connection registry requires recovery')

/**
 * The last document validated per storage, with the exact stored text it was validated from.
 * Shared by every registry over the same storage; any write through a registry drops it, and
 * a stored text that differs in any way (a write from elsewhere) is validated again.
 */
const validatedDocuments = new WeakMap<LocalStorage, { text: string; doc: Document }>()

/**
 * One credential kind. Legacy state is never imported. Writes are verified before
 * proceeding; a prepared token binding can resume after interrupted provisioning.
 */
export class TokenConnectionRegistry {
  private constructor(private readonly local: LocalStorage) {}
  static open(local: LocalStorage): TokenConnectionRegistry {
    const registry = new TokenConnectionRegistry(local)
    if (local.loadLocalStorage(TOKEN_REGISTRY_KEY) != null) {
      registry.validated()
      return registry
    }
    registry.write(TOKEN_REGISTRY_KEY, { version: 2, selectedId: '', records: [] })
    registry.validated()
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
      selective: defaultSelective(Platform.isMobile),
      status: 'needs-token',
      state: {},
    }
  }
  private write(key: string, value: unknown): void {
    if (key === TOKEN_REGISTRY_KEY) validatedDocuments.delete(this.local)
    this.local.saveLocalStorage(key, clone(value))
    if (!same(this.local.loadLocalStorage(key), value)) throw recovery()
  }
  /** A private copy to change and write back. */
  private document(): Document {
    return clone(this.validated())
  }
  /** The validated document, read-only: shared with later reads until the storage changes. */
  private validated(): Document {
    const raw = this.local.loadLocalStorage(TOKEN_REGISTRY_KEY)
    const text = JSON.stringify(raw)
    const known = validatedDocuments.get(this.local)
    if (known && known.text === text) return known.doc
    const doc = clone(this.check(raw))
    validatedDocuments.set(this.local, { text, doc })
    return doc
  }
  private check(raw: unknown): Document {
    const parsed = documentSchema.safeParse(raw)
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
    return this.validated().selectedId
  }
  records(): TokenConnectionRecord[] {
    return clone(this.validated().records)
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
  /** Remove authority and journal credential cleanup in one verified device-local write. */
  beginForget(localId: string): void {
    const doc = this.document(),
      record = this.record(doc, localId)
    const references = [
      ...new Set(
        [record.secretReference, record.pending?.secretReference].filter(
          (one): one is string => !!one
        )
      ),
    ]
    doc.cleanup = [...(doc.cleanup ?? []), { id: localId, references }]
    doc.records = doc.records.filter((one) => one.id !== localId)
    if (doc.selectedId === localId) doc.selectedId = doc.records[0]?.id ?? ''
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  finishForgotten(
    secrets: DeviceTokenSecrets & { remove(reference: string): void },
    only?: string
  ): void {
    const doc = this.document()
    for (const item of doc.cleanup ?? []) {
      if (only !== undefined && item.id !== only) continue
      if (
        doc.records.some(
          (one) =>
            one.id === item.id ||
            item.references.includes(one.secretReference) ||
            (!!one.pending && item.references.includes(one.pending.secretReference))
        )
      )
        throw recovery()
      for (const reference of item.references) {
        secrets.remove(reference)
        if (secrets.get(reference)) throw new Error('Credential cleanup failed')
      }
    }
    if (doc.cleanup?.length) {
      doc.cleanup = only === undefined ? [] : doc.cleanup.filter((one) => one.id !== only)
      this.write(TOKEN_REGISTRY_KEY, doc)
    }
  }
  setPaused(localId: string, paused: boolean): void {
    const doc = this.document(),
      record = this.record(doc, localId)
    record.paused = paused
    if (record.status === 'idle' || record.status === 'paused')
      record.status = paused ? 'paused' : 'idle'
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  /** Person-only preference; never part of selective settings or engine state. */
  setTrusted(localId: string, trusted: boolean): void {
    const doc = this.document()
    this.record(doc, localId).trusted = trusted
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  setRootIssue(localId: string, issue: TokenConnectionRecord['rootIssue']): void {
    const doc = this.document(),
      record = this.record(doc, localId)
    record.rootIssue = issue
    if (!issue) record.paused = false
    record.status = issue ? 'scope_unavailable' : 'paused'
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  private assertRoot(doc: Document, record: TokenConnectionRecord, path: string): void {
    const folded = (value: string) => value.normalize('NFC').toLowerCase()
    const root = folded(path)
    for (const other of doc.records) {
      const scope = other.scope ?? other.pending?.scope
      if (other.id === record.id || other.status === 'disconnected' || !scope) continue
      const roots = [
        other.localRoot ?? scope.path,
        ...(other.rootIssue?.kind === 'moved' ? [other.rootIssue.path] : []),
      ]
      if (
        roots.some((path) => {
          const effective = folded(path)
          return (
            root === '/' ||
            effective === '/' ||
            root === effective ||
            root.startsWith(effective + '/') ||
            effective.startsWith(root + '/')
          )
        })
      )
        throw new LocalPlacementError(
          'The folder overlaps another connection; sync remains stopped'
        )
    }
  }
  setServerRoot(localId: string, path: string): void {
    const doc = this.document(),
      record = this.record(doc, localId)
    if (record.scope?.kind !== 'folder' || record.scope.path === '/') throw recovery()
    record.serverRoot = localRootSchema.parse(path)
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  setLocalRoot(localId: string, path: string): void {
    const doc = this.document(),
      record = this.record(doc, localId)
    if (record.scope?.kind !== 'folder' || record.scope.path === '/') throw recovery()
    const parsed = physicalRootSchema.parse(path)
    this.assertRoot(doc, record, parsed)
    record.localRoot = parsed
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  setScopePath(localId: string, path: string): void {
    const doc = this.document(),
      record = this.record(doc, localId)
    if (!record.scope) throw new Error('Connection needs a scope')
    const needsPin =
      record.scope.kind === 'folder' && record.scope.path !== '/' && !record.localRoot
    if (needsPin) record.localRoot = record.scope.path
    if (record.scope.path === path && !needsPin) return
    record.scope.path = path
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  setSelective(localId: string, selective: SelectiveSettings): void {
    const doc = this.document(),
      record = this.record(doc, localId)
    const problem = selectiveProblem(
      selective,
      record.selective ?? defaultSelective(Platform.isMobile)
    )
    if (problem) throw new Error(problem)
    record.selective = clone(selective)
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  setAddress(localId: string, address: string): void {
    const problem = address === '' ? null : serverUrlProblem(address)
    if (problem) throw new Error(problem)
    const normal = address === '' ? '' : normalizeServerUrl(address)
    if (normal === null) throw new Error('Invalid server address')
    const doc = this.document(),
      record = this.record(doc, localId)
    if ((record.secretReference || record.pending) && normal !== record.address)
      throw new Error(
        'This token belongs to ' +
          record.address +
          '. Connect with a new token to use another server.'
      )
    record.address = normal
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
    record.status = record.rootIssue ? 'scope_unavailable' : status
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
  /** New engine state is device-only and permanently bound to this local ID. */
  storage(localId: string): LocalStorage {
    this.record(this.validated(), localId)
    return Object.assign(
      {
        loadLocalStorage: (key: string) => {
          const record = this.record(this.validated(), localId)
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
  pinLocalRoot(localId: string): string | undefined {
    const doc = this.document(),
      record = this.record(doc, localId)
    if (record.scope?.kind !== 'folder') return undefined
    if (!record.localRoot) {
      record.localRoot = record.scope.path
      this.write(TOKEN_REGISTRY_KEY, doc)
    }
    return record.localRoot
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
    if (token.scope.kind === 'folder') record.localRoot ??= record.scope?.path ?? token.scope.path
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
          scope: { kind: record.pending.scope.kind, id: record.pending.scope.id },
        },
        { ...identity, scope: { kind: authority.scope.kind, id: authority.scope.id } }
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
    Object.assign(record, pending, { scope: clone(authority.scope) })
    delete record.pending
    record.status = status
    this.write(TOKEN_REGISTRY_KEY, doc)
  }
}
