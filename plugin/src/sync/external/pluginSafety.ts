import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { CommitOpSchema } from '@abele/sync-protocol'
import { z } from 'zod'
import type { DeviceConnection } from '../connection'
import { readLedgerId } from '../ledgerId'
import { LEDGER_BOOTSTRAP_KEY, LEDGER_PROOF_KEY } from '../ledgerRecovery'
import { ledgerCleanupIds } from '../ledgerCleanup'
import { IGNORE_FILE } from '../scope'
import { wait, completion } from '../idbRequests'
import { IndexedDbStateStore, stateDatabaseName } from '../IndexedDbStateStore'
import { WriteJournal } from '../writeJournal'
import { SCOPED_CONNECTION_KEY, SCOPED_JOIN_KEY } from '../scoped/scopedJoin'
import { ConnectionBindingSchema, sameConnection, type ConnectionBinding } from './records'
import { decodeExternalDocument, ExternalState } from './state'
import { MAX_PROJECTION_BYTES, recognizeProjection } from './projection'
import {
  EXTERNAL_ACTIVATION_KEY,
  EXTERNAL_SWITCH_KEY,
  EXTERNAL_GENERATION_KEY,
  ExternalRecoveryRequired,
  externalInventory,
  RuntimeFence,
  type RecoveryStorage,
} from './recovery'

// Marker envelopes use the plugin's Zod version; binding semantics always use the
// canonical core parser, which may have a different Zod runtime.
const markerBinding = z.unknown().transform((input, ctx) => {
  const result = ConnectionBindingSchema.safeParse(input)
  if (!result.success) {
    ctx.addIssue({ code: 'custom', message: 'Invalid canonical connection binding' })
    return z.NEVER
  }
  return result.data
})
const activationSchema = z
  .object({
    schema: z.literal(1),
    ledgers: z
      .array(
        z
          .object({
            ledgerId: z.string().min(1),
            databaseName: z.string().min(1),
            databaseIdentity: z.string().min(1),
            binding: markerBinding,
            phase: z.enum(['preparing', 'active']),
          })
          .strict()
      )
      .min(1),
  })
  .strict()
type Activation = z.infer<typeof activationSchema>
function activation(storage: RecoveryStorage): Activation | null {
  const raw = storage.loadLocalStorage(EXTERNAL_ACTIVATION_KEY)
  if (raw == null) return null
  try {
    return activationSchema.parse(raw)
  } catch {
    throw new ExternalRecoveryRequired('activation marker is unreadable')
  }
}
function persist(storage: RecoveryStorage, key: string, value: unknown): void {
  storage.saveLocalStorage(key, value)
  if (JSON.stringify(storage.loadLocalStorage(key)) !== JSON.stringify(value))
    throw new ExternalRecoveryRequired('migration bookkeeping was not persisted')
}

/** Read-only inspection of an explicitly owned name. No global namespace enumeration,
 * schema upgrade, new identity, or empty database allocation is permitted. */
export async function inspectExistingLedger(
  factory: IDBFactory,
  name: string
): Promise<{
  version: number
  identity: string | null
  metadata: Map<string, unknown>
} | null> {
  const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = factory.open(name)
    let absent = false
    request.onupgradeneeded = () => {
      absent = true
      request.transaction.abort()
    }
    request.onerror = () => (absent ? resolve(null) : reject(request.error))
    request.onsuccess = () => resolve(request.result)
  })
  if (!db) return null
  try {
    const tx = db.transaction('meta', 'readonly')
    const done = completion(tx, 'cannot inspect external dependencies')
    const rows = await wait<{ key: string; value: unknown }[]>(tx.objectStore('meta').getAll())
    await done
    const metadata = new Map(rows.map((row) => [row.key, row.value]))
    const identity = metadata.get('database-identity-v1')
    return {
      version: db.version,
      identity: typeof identity === 'string' ? identity : null,
      metadata,
    }
  } finally {
    db.close()
  }
}

/** Missing activated databases are refused before even the ordinary open can allocate one. */
export async function checkExternalMigration(app: App, factory: IDBFactory): Promise<void> {
  if (app.loadLocalStorage(EXTERNAL_SWITCH_KEY) != null)
    throw new ExternalRecoveryRequired('connection replacement is unfinished')
  const marker = activation(app)
  for (const item of marker?.ledgers ?? []) {
    const found = await inspectExistingLedger(factory, item.databaseName)
    if (!found || found.identity !== item.databaseIdentity || found.version < 2)
      throw new ExternalRecoveryRequired(
        'activated ledger is missing or changed; empty bootstrap is refused'
      )
  }
}

export const EXTERNAL_INSPECTION_KEY = 'abele-sync-external-inspection-v1'
const inspectionSchema = z
  .object({
    schema: z.literal(1),
    entries: z.array(
      z
        .object({
          path: z.string(),
          size: z.number().int().nonnegative(),
          mtime: z.number(),
          marker: z.boolean(),
        })
        .strict()
    ),
  })
  .strict()

/** Stat-first, persisted inspection. Recognition follows bounded content, not the extension. */
export async function projectionEvidence(
  app: App,
  assertOwned: () => void = () => {},
  includeControl = true
): Promise<string | null> {
  const paths = new Set(app.vault.getFiles().map((file) => file.path))
  const seen = new Set<string>()
  const walk = async (folder: string): Promise<void> => {
    assertOwned()
    // Bound alias loops by the protocol path budget, not an unrelated note-count or
    // configuration-directory depth limit that would restrict legitimate ordinary vaults.
    if (new TextEncoder().encode(folder.normalize('NFC')).byteLength > 1024 || seen.has(folder))
      throw new ExternalRecoveryRequired('projection inventory is incomplete')
    seen.add(folder)
    const listed = await app.vault.adapter.list(folder)
    for (const file of listed.files) paths.add(file)
    for (const child of listed.folders) await walk(child)
  }
  await walk('')
  const cached = inspectionSchema.safeParse(app.loadLocalStorage(EXTERNAL_INSPECTION_KEY))
  // The index is an optimization, never authority: damaged/missing cache triggers inspection.
  const previous = new Map(
    (cached.success ? cached.data.entries : []).map((entry) => [entry.path, entry])
  )
  const inspected: { path: string; size: number; mtime: number; marker: boolean }[] = []
  let evidence: string | null = null
  const stat = async (path: string) => {
    try {
      return await app.vault.adapter.stat(path)
    } catch (cause) {
      const code =
        typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : null
      if (code === 'ENOENT' || code === 'ENOTDIR') return null
      throw cause
    }
  }
  const adapter = app.vault.adapter as typeof app.vault.adapter & {
    readBinaryPrefix?(path: string, maximumBytes: number): Promise<ArrayBuffer | Uint8Array>
    getFullPath?(path: string): string
    fsPromises?: {
      open?(
        path: string,
        flags: string
      ): Promise<{
        read(
          buffer: Uint8Array,
          offset: number,
          length: number,
          position: number
        ): Promise<{ bytesRead: number }>
        close(): Promise<void>
      }>
    }
  }
  const readCandidate = async (path: string): Promise<ArrayBuffer | Uint8Array> => {
    if (adapter.readBinaryPrefix) return adapter.readBinaryPrefix(path, MAX_PROJECTION_BYTES)
    if (adapter.getFullPath && adapter.fsPromises?.open) {
      const handle = await adapter.fsPromises.open(adapter.getFullPath(path), 'r')
      try {
        const buffer = new Uint8Array(MAX_PROJECTION_BYTES)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        return buffer.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
    }
    return adapter.readBinary(path) // Stat-bounded portable/mobile candidate only.
  }
  for (const path of paths) {
    if (!includeControl && path === IGNORE_FILE) continue
    assertOwned()
    const before = await stat(path)
    assertOwned()
    if (!before || before.type !== 'file' || before.size > MAX_PROJECTION_BYTES) continue
    const old = previous.get(path)
    if (old && old.size === before.size && old.mtime === before.mtime) {
      inspected.push(old)
      if (old.marker) evidence ??= path
      continue
    }
    let bytes: Uint8Array
    try {
      const read = await readCandidate(path)
      bytes =
        read instanceof Uint8Array
          ? read.subarray(0, MAX_PROJECTION_BYTES)
          : new Uint8Array(read, 0, Math.min(read.byteLength, MAX_PROJECTION_BYTES))
    } catch (cause) {
      assertOwned()
      if ((await stat(path)) === null) continue
      throw cause
    }
    assertOwned()
    const marker = recognizeProjection(bytes)
    if (marker) evidence ??= path
    const after = await stat(path)
    assertOwned()
    if (after?.type === 'file' && after.size === before.size && after.mtime === before.mtime)
      inspected.push({ path, size: before.size, mtime: before.mtime, marker })
  }
  assertOwned()
  persist(app, EXTERNAL_INSPECTION_KEY, { schema: 1, entries: inspected })
  return evidence
}

/** A connection generation is device-local; same-vault endpoint/credential replacements are different. */
export function connectionGeneration(
  storage: RecoveryStorage,
  binding: Omit<ConnectionBinding, 'generation'>
): number {
  const key = JSON.stringify(binding)
  const raw = storage.loadLocalStorage(EXTERNAL_GENERATION_KEY) as {
    schema?: unknown
    key?: unknown
    generation?: number
  } | null
  if (
    raw != null &&
    (raw.schema !== 1 ||
      typeof raw.key !== 'string' ||
      !Number.isSafeInteger(raw.generation) ||
      raw.generation < 1)
  )
    throw new ExternalRecoveryRequired('connection generation is unreadable')
  if (raw?.key === key) return raw.generation
  if (storage.loadLocalStorage(EXTERNAL_ACTIVATION_KEY) != null)
    throw new ExternalRecoveryRequired('connection identity changed')
  const generation = (raw?.generation ?? 0) + 1
  persist(storage, EXTERNAL_GENERATION_KEY, { schema: 1, key, generation })
  return generation
}
export async function personalExternalBinding(
  storage: RecoveryStorage,
  c: DeviceConnection,
  token: string,
  assertOwned: () => void = () => {}
): Promise<ConnectionBinding> {
  const partial: Omit<ConnectionBinding, 'generation'> = {
    endpoint: c.serverUrl,
    vaultId: c.vaultId,
    mode: 'personal' as const,
    principalId: c.deviceId,
    principalType: 'device' as const,
    grantId: null,
    credentialAssociation: c.deviceTokenId + ':' + (await sha256(new TextEncoder().encode(token))),
  }
  const { generation: _initial, ...canonical } = ConnectionBindingSchema.parse({
    ...partial,
    generation: 0,
  })
  assertOwned()
  return { ...canonical, generation: connectionGeneration(storage, canonical) }
}
export function generationHeld(storage: RecoveryStorage, binding: ConnectionBinding): boolean {
  const { generation, ...partial } = binding
  const raw = storage.loadLocalStorage(EXTERNAL_GENERATION_KEY) as {
    key?: string
    generation?: number
  } | null
  return raw?.generation === generation && raw.key === JSON.stringify(partial)
}

/** Recovery inspection does not replay destructive external phases. Until later integration,
 * any nonempty external inventory establishes a connection-wide hold. */
export async function recoverExternalState(
  app: App,
  store: IndexedDbStateStore,
  ledgerId: string,
  databaseName: string,
  binding: ConnectionBinding,
  fence: RuntimeFence
): Promise<void> {
  fence.assertOwned()
  const marker = activation(app)
  const item = marker?.ledgers.find((value) => value.databaseName === databaseName)
  if (
    marker &&
    (!item ||
      item.ledgerId !== ledgerId ||
      item.databaseIdentity !== store.databaseIdentity ||
      !sameConnection(item.binding, binding))
  )
    throw new ExternalRecoveryRequired('activation binding changed')
  let raw = await store.getExternalState()
  fence.assertOwned()
  if (raw === null && item?.phase === 'preparing') {
    // This exact database instance never received active deletion permission. Complete only
    // its initial empty state; a missing active journal cannot use this migration grant.
    await ExternalState.open(store, ledgerId, binding)
    raw = await store.getExternalState()
  }
  if (raw === null && item) throw new ExternalRecoveryRequired('activated journal is missing')
  if (raw !== null) {
    const document = decodeExternalDocument(raw)
    if (document.ledgerId !== ledgerId || !sameConnection(document.binding, binding))
      throw new ExternalRecoveryRequired('external connection binding changed')
    if (externalInventory(document).blocked) throw new ExternalRecoveryRequired()
  }
  if (await projectionEvidence(app, () => fence.assertOwned()))
    throw new ExternalRecoveryRequired('projection evidence requires recovery before ordinary sync')
  // Inspect installation journals before their existing safe recovery, and publication
  // metadata before any constructor scope work or ordinary replay is permitted.
  new WriteJournal(app).entries()
  new WriteJournal(app).recovered()
  const publication = await store.getJournal()
  if (
    publication !== null &&
    (!publication.batchId ||
      !publication.idempotencyKey ||
      !publication.startedAt ||
      !Array.isArray(publication.ops) ||
      publication.ops.some((op) => !CommitOpSchema.safeParse(op).success) ||
      (publication.publicationPhase !== undefined &&
        !['prepared', 'submitted'].includes(publication.publicationPhase)))
  )
    throw new ExternalRecoveryRequired('publication journal is unreadable')
  await store.pluginMeta()
  fence.assertOwned()
  if (item?.phase === 'preparing') {
    item.phase = 'active'
    persist(app, EXTERNAL_ACTIVATION_KEY, marker)
  }
}

/** Trusted activation port for the later explicit eviction API; never called automatically.
 * The schema fence is already durable. Preparing intent precedes initialization and activation. */
export async function activateExternalFiles(
  app: App,
  store: IndexedDbStateStore,
  ledgerId: string,
  databaseName: string,
  binding: ConnectionBinding,
  assertOwned: () => void
): Promise<ExternalState> {
  assertOwned()
  if (store.databaseVersion < 2 || !store.databaseIdentity)
    throw new ExternalRecoveryRequired('durable downgrade fence missing')
  if (app.loadLocalStorage(EXTERNAL_SWITCH_KEY) != null) throw new ExternalRecoveryRequired()
  const previous = activation(app)
  const existing = previous?.ledgers.find((item) => item.databaseName === databaseName)
  if (
    existing &&
    (existing.databaseIdentity !== store.databaseIdentity ||
      !sameConnection(existing.binding, binding))
  )
    throw new ExternalRecoveryRequired('activation binding changed')
  if (!existing) {
    const marker: Activation = {
      schema: 1,
      ledgers: [
        ...(previous?.ledgers ?? []),
        {
          ledgerId,
          databaseName,
          databaseIdentity: store.databaseIdentity,
          binding,
          phase: 'preparing',
        },
      ],
    }
    persist(app, EXTERNAL_ACTIVATION_KEY, marker)
  }
  const marker = activation(app)
  const item = marker?.ledgers.find((value) => value.databaseName === databaseName)
  if (!marker || !item) throw new ExternalRecoveryRequired('activation marker lost')
  if (item.phase === 'active' && (await store.getExternalState()) === null)
    throw new ExternalRecoveryRequired('active journal lost')
  assertOwned()
  const state = await ExternalState.open(store, ledgerId, binding)
  assertOwned()
  item.phase = 'active'
  persist(app, EXTERNAL_ACTIVATION_KEY, marker)
  return state
}

/** One read-only safety inventory for replacement, enrollment, departure and delayed cleanup.
 * Activation is conservatively retained until the explicit preparation API exists. */
export async function requireExternalLifecycleSafety(
  app: App,
  factory: IDBFactory,
  database?: string
): Promise<void> {
  if (app.loadLocalStorage(EXTERNAL_SWITCH_KEY) != null) throw new ExternalRecoveryRequired()
  const marker = activation(app)
  if (marker) throw new ExternalRecoveryRequired()
  const installation = new WriteJournal(app)
  if (installation.entries().length || installation.recovered().length)
    throw new ExternalRecoveryRequired('installation or retained-byte recovery is unfinished')
  const names = new Set<string>(database ? [database] : [])
  for (const key of [undefined, LEDGER_PROOF_KEY, LEDGER_BOOTSTRAP_KEY]) {
    const held = readLedgerId(app, key)
    if (held.stateId) names.add(stateDatabaseName(held.stateId))
  }
  for (const id of ledgerCleanupIds(app)) names.add(stateDatabaseName(id))
  const scoped = app.loadLocalStorage(SCOPED_CONNECTION_KEY) as { ledgerId?: string } | null
  const pending = app.loadLocalStorage(SCOPED_JOIN_KEY) as {
    connection?: { ledgerId?: string }
  } | null
  for (const id of [scoped?.ledgerId, pending?.connection?.ledgerId])
    if (id) {
      names.add('abele-scoped-' + id)
      names.add('abele-scoped-native-' + id)
    }
  for (const name of names) {
    const found = await inspectExistingLedger(factory, name)
    const raw = found?.metadata.get('plugin:external-files')
    if (raw != null) {
      if (typeof raw !== 'string' || externalInventory(decodeExternalDocument(raw)).blocked)
        throw new ExternalRecoveryRequired()
    }
  }
  if (await projectionEvidence(app, () => {}, false))
    throw new ExternalRecoveryRequired('unresolved projection evidence')
}
