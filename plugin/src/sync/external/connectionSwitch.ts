import { sha256 } from '@abele/sync-core'
import { z } from 'zod'
import { bindDeviceToken, boundDeviceToken, tokenServerId } from '@/secrets/deviceSecret'
import { CONNECTION_KEY, inspectConnection, type DeviceConnection } from '../connection'
import { LEDGER_KEY, readLedgerId, type LedgerId } from '../ledgerId'
import { LEDGER_BOOTSTRAP_KEY } from '../ledgerRecovery'
import { rememberLedgerCleanup } from '../ledgerCleanup'
import { newRevokeSecretId } from '../revoke'
import {
  SCOPED_CONNECTION_KEY,
  SCOPED_JOIN_KEY,
  type ScopedLocalConnection,
} from '../scoped/scopedJoin'
import {
  EXTERNAL_ACTIVATION_KEY,
  EXTERNAL_GENERATION_KEY,
  EXTERNAL_SWITCH_KEY,
  ExternalRecoveryRequired,
  type RecoveryStorage,
} from './recovery'

export const EXTERNAL_RETIRED_KEY = 'abele-sync-external-retired-v1'
type DeviceRoad = { get(id: string): string; set(id: string, value: string): void }
const ledger = z.object({ stateId: z.string(), vaultId: z.string() }).strict()
const connection = z.unknown().transform((raw, ctx) => {
  const result = inspectConnection({ loadLocalStorage: () => raw, saveLocalStorage: () => {} })
  if (result.damaged.length || JSON.stringify(result.connection) !== JSON.stringify(raw)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid switch connection' })
    return z.NEVER
  }
  return result.connection
})
const schema = z
  .object({
    schema: z.literal(1),
    phase: z.enum(['prepared', 'credential-staged', 'descriptor-written', 'connection-written']),
    old: connection,
    target: connection,
    oldLedger: ledger,
    targetLedger: ledger,
    credentialSha: z.string().regex(/^[a-f0-9]{64}$/),
    activation: z.unknown(),
  })
  .strict()
function persist(storage: RecoveryStorage, key: string, value: unknown) {
  storage.saveLocalStorage(key, value)
  if (JSON.stringify(storage.loadLocalStorage(key) ?? null) !== JSON.stringify(value ?? null))
    throw new ExternalRecoveryRequired('connection switch write was not kept')
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const scopedConnection = z
  .object({
    version: z.literal(4),
    facet: z.literal('scoped'),
    issuer: z.string().url(),
    vaultId: z.string().min(1),
    grantId: z.string().min(1),
    memberId: z.string().min(1),
    principalId: z.string().min(1),
    principalKind: z.literal('installation'),
    role: z.enum(['reader', 'editor']),
    rootFileId: z.string().min(1),
    tokenId: z.string().min(1),
    ledgerId: z.string().min(1),
    scriptPolicy: z.literal('refuse'),
  })
  .strict()
const scopedDeparture = z
  .object({
    schema: z.literal(1),
    kind: z.literal('scoped-departure'),
    phase: z.enum(['prepared', 'connection-written']),
    old: scopedConnection,
    credentialSha: z.string().regex(/^[a-f0-9]{64}$/),
    activation: z.unknown(),
  })
  .strict()
function retireActivation(storage: RecoveryStorage, saved: unknown) {
  if (saved == null) return
  const retired = storage.loadLocalStorage(EXTERNAL_RETIRED_KEY) ?? []
  if (!Array.isArray(retired))
    throw new ExternalRecoveryRequired('retired ledger inventory is unreadable')
  if (!retired.some((item) => equal(item, saved)))
    persist(storage, EXTERNAL_RETIRED_KEY, [...retired, saved])
  const active = storage.loadLocalStorage(EXTERNAL_ACTIVATION_KEY)
  if (active != null && !equal(active, saved))
    throw new ExternalRecoveryRequired('activation changed during departure')
  persist(storage, EXTERNAL_ACTIVATION_KEY, null)
  persist(storage, EXTERNAL_GENERATION_KEY, null)
}

/** The active token slot is never overwritten. An unfinished record fences startup until
 * its exact staged credential and old/target descriptors are reconciled. */
export async function stageConnectionSwitch(
  storage: RecoveryStorage,
  road: DeviceRoad,
  target: DeviceConnection,
  targetLedger: LedgerId,
  token: string,
  before: () => Promise<void>
): Promise<void> {
  await before()
  if (storage.loadLocalStorage(EXTERNAL_SWITCH_KEY) != null) throw new ExternalRecoveryRequired()
  const old = inspectConnection(storage).connection
  if (target.deviceTokenId === old.deviceTokenId || !token.startsWith('absd_'))
    throw new ExternalRecoveryRequired('replacement must use a separately staged device credential')
  const oldToken = boundDeviceToken(road, old.deviceTokenId, old.serverUrl)
  const retirementId = oldToken ? newRevokeSecretId() : null
  if (retirementId)
    target = {
      ...target,
      pendingRevoke: [
        ...target.pendingRevoke,
        {
          serverUrl: old.serverUrl,
          deviceId: old.deviceId,
          deviceName: old.deviceName,
          tokenId: retirementId,
          since: new Date().toISOString(),
          plainHttp: false,
        },
      ],
    }
  const record = schema.parse({
    schema: 1,
    phase: 'prepared',
    old,
    target,
    oldLedger: readLedgerId(storage),
    targetLedger,
    credentialSha: await sha256(new TextEncoder().encode(token)),
    activation: storage.loadLocalStorage(EXTERNAL_ACTIVATION_KEY) ?? null,
  })
  persist(storage, EXTERNAL_SWITCH_KEY, record)
  if (retirementId && oldToken) bindDeviceToken(road, retirementId, oldToken, old.serverUrl)
  bindDeviceToken(road, target.deviceTokenId, token, target.serverUrl)
  await recoverConnectionSwitch(storage, road)
}

/** Application-restart reconciliation only uses the recorded target. It cannot derive a
 * new connection from matching vault IDs, files or whatever credential is currently held. */
export async function recoverConnectionSwitch(
  storage: RecoveryStorage,
  road: DeviceRoad
): Promise<void> {
  const raw = storage.loadLocalStorage(EXTERNAL_SWITCH_KEY)
  if (raw == null) return
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new ExternalRecoveryRequired('connection switch is unreadable')
  const record = parsed.data
  const credential = record.target.serverUrl ? record.target : record.old
  const token = boundDeviceToken(road, credential.deviceTokenId, credential.serverUrl)
  if (!token || (await sha256(new TextEncoder().encode(token))) !== record.credentialSha)
    throw new ExternalRecoveryRequired('staged credential is incomplete or changed')
  for (const entry of record.target.pendingRevoke)
    if (
      !record.old.pendingRevoke.some((old) => old.tokenId === entry.tokenId) &&
      !boundDeviceToken(road, entry.tokenId, entry.serverUrl)
    )
      throw new ExternalRecoveryRequired('old credential retirement staging is incomplete')
  const current = storage.loadLocalStorage(CONNECTION_KEY),
    descriptor = readLedgerId(storage)
  if (
    (!equal(current, record.old) && !equal(current, record.target)) ||
    (!equal(descriptor, record.oldLedger) && !equal(descriptor, record.targetLedger))
  )
    throw new ExternalRecoveryRequired('connection switch binding changed')
  if (record.phase === 'prepared') {
    record.phase = 'credential-staged'
    persist(storage, EXTERNAL_SWITCH_KEY, record)
  }
  if (record.activation != null) {
    retireActivation(storage, record.activation)
  }
  if (record.oldLedger.stateId && record.oldLedger.stateId !== record.targetLedger.stateId)
    rememberLedgerCleanup(storage, record.oldLedger.stateId)
  persist(storage, LEDGER_KEY, record.targetLedger)
  if (record.targetLedger.stateId !== record.oldLedger.stateId)
    persist(storage, LEDGER_BOOTSTRAP_KEY, record.targetLedger)
  record.phase = 'descriptor-written'
  persist(storage, EXTERNAL_SWITCH_KEY, record)
  persist(storage, CONNECTION_KEY, record.target)
  record.phase = 'connection-written'
  persist(storage, EXTERNAL_SWITCH_KEY, record)
  if (
    !equal(storage.loadLocalStorage(CONNECTION_KEY), record.target) ||
    !equal(readLedgerId(storage), record.targetLedger) ||
    boundDeviceToken(road, credential.deviceTokenId, credential.serverUrl) !== token
  )
    throw new ExternalRecoveryRequired('target binding was not confirmed')
  // Old credentials and databases remain recoverable. Their existing retirement paths
  // recheck inventory; this receipt never authorizes deleting retained material.
  if (record.target.serverUrl && record.old.deviceTokenId !== record.target.deviceTokenId) {
    road.set(record.old.deviceTokenId, '')
    road.set(tokenServerId(record.old.deviceTokenId), '')
    if (road.get(record.old.deviceTokenId) || road.get(tokenServerId(record.old.deviceTokenId)))
      throw new ExternalRecoveryRequired('old active credential slot was not retired')
  }
  persist(storage, EXTERNAL_SWITCH_KEY, null)
}

export async function stageScopedDeparture(
  storage: RecoveryStorage,
  road: DeviceRoad,
  old: ScopedLocalConnection,
  before: () => Promise<void>
): Promise<void> {
  await before()
  if (
    storage.loadLocalStorage(EXTERNAL_SWITCH_KEY) != null ||
    !equal(storage.loadLocalStorage(SCOPED_CONNECTION_KEY), old)
  )
    throw new ExternalRecoveryRequired('scoped departure binding changed')
  const token = road.get(old.tokenId)
  if (!token) throw new ExternalRecoveryRequired('scoped credential is missing')
  const record = scopedDeparture.parse({
    schema: 1,
    kind: 'scoped-departure',
    phase: 'prepared',
    old,
    credentialSha: await sha256(new TextEncoder().encode(token)),
    activation: storage.loadLocalStorage(EXTERNAL_ACTIVATION_KEY) ?? null,
  })
  persist(storage, EXTERNAL_SWITCH_KEY, record)
  await recoverScopedDeparture(storage, road)
}

export async function recoverScopedDeparture(
  storage: RecoveryStorage,
  road: DeviceRoad
): Promise<void> {
  const raw = storage.loadLocalStorage(EXTERNAL_SWITCH_KEY)
  if (raw == null || (raw as { kind?: unknown }).kind !== 'scoped-departure') return
  const parsed = scopedDeparture.safeParse(raw)
  if (!parsed.success) throw new ExternalRecoveryRequired('scoped departure is unreadable')
  const record = parsed.data,
    current = storage.loadLocalStorage(SCOPED_CONNECTION_KEY)
  if (current != null && !equal(current, record.old))
    throw new ExternalRecoveryRequired('scoped departure identity changed')
  const token = road.get(record.old.tokenId)
  if (
    (record.phase === 'prepared' && !token) ||
    (token && (await sha256(new TextEncoder().encode(token))) !== record.credentialSha)
  )
    throw new ExternalRecoveryRequired('scoped departure credential changed')
  retireActivation(storage, record.activation)
  persist(storage, SCOPED_CONNECTION_KEY, null)
  persist(storage, SCOPED_JOIN_KEY, null)
  record.phase = 'connection-written'
  persist(storage, EXTERNAL_SWITCH_KEY, record)
  for (const key of [record.old.tokenId, record.old.tokenId + ':binding']) {
    road.set(key, '')
    if (road.get(key)) throw new ExternalRecoveryRequired('scoped credential could not be retired')
  }
  persist(storage, EXTERNAL_SWITCH_KEY, null)
}

/** Called only after successful preparation and the revoke/retained-revoke outcome.
 * Keep the old credential until the empty connection write is confirmed. */
export async function stageConnectionDeparture(
  storage: RecoveryStorage,
  road: DeviceRoad,
  target: DeviceConnection,
  before: () => Promise<void>
): Promise<void> {
  await before()
  if (storage.loadLocalStorage(EXTERNAL_SWITCH_KEY) != null || target.serverUrl || target.vaultId)
    throw new ExternalRecoveryRequired('departure binding changed')
  const old = inspectConnection(storage).connection
  const token = boundDeviceToken(road, old.deviceTokenId, old.serverUrl)
  if (!token) throw new ExternalRecoveryRequired('departure credential is missing')
  persist(
    storage,
    EXTERNAL_SWITCH_KEY,
    schema.parse({
      schema: 1,
      phase: 'credential-staged',
      old,
      target,
      oldLedger: readLedgerId(storage),
      targetLedger: readLedgerId(storage),
      credentialSha: await sha256(new TextEncoder().encode(token)),
      activation: storage.loadLocalStorage(EXTERNAL_ACTIVATION_KEY) ?? null,
    })
  )
  await recoverConnectionSwitch(storage, road)
}
