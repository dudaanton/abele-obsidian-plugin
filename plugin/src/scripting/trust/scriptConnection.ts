import type { LocalStorage } from '@/sync/ledgerId'
import { CONNECTION_KEY, inspectConnection } from '@/sync/connection'
import type { ScriptBinding } from './ScriptProvenance'
import { caseKey } from '@abele/sync-sdk/protocol'
import { LEDGER_KEY } from '@/sync/ledgerId'
import { SCOPED_CONNECTION_KEY } from '@/sync/scoped/scopedJoin'
import {
  selectedConnectionStorage,
  ConnectionRegistry,
  REGISTRY_KEY,
  CONNECTION_STORAGE,
} from '@/sync/connectionRegistry'

function currentToken(storage: LocalStorage | null) {
  if (!storage || storage.loadLocalStorage(REGISTRY_KEY) == null) return undefined
  const registry = ConnectionRegistry.open(storage)
  const id =
    (storage as LocalStorage & { [CONNECTION_STORAGE]?: string })[CONNECTION_STORAGE] ??
    registry.selectedId
  return registry.records().find((record) => record.id === id) ?? null
}

/** The identity portion only: pausing and selective settings do not change execution authority. */
export function scriptConnectionKey(storage: LocalStorage | null): string {
  const token = currentToken(storage)
  if (token !== undefined)
    return token
      ? JSON.stringify([
          token.id,
          token.address,
          token.spaceId,
          token.tokenId,
          token.scope?.kind ?? null,
          token.scope?.id ?? null,
          !!token.pending,
        ])
      : 'absent'
  storage = storage && selectedConnectionStorage(storage)
  const raw = storage?.loadLocalStorage(CONNECTION_KEY) as Record<string, unknown> | null
  if (!raw) return 'absent'
  const inspected = inspectConnection(storage!)
  const c = inspected.connection
  return JSON.stringify([
    c.serverUrl,
    c.enrolledUrl,
    c.vaultId,
    c.deviceId,
    raw.facet ?? 'personal',
    raw.grantId ?? null,
    inspected.damaged,
  ])
}

/** A retained personal installation after Disconnect, not a partial/unknown connection or
 * the empty namespace created by explicit lost-store recovery. */
export function isDisconnectedPersonalScriptContext(
  storage: LocalStorage | null,
  binding: ScriptBinding
): boolean {
  storage = storage && selectedConnectionStorage(storage)
  const raw = storage?.loadLocalStorage(CONNECTION_KEY) as Record<string, unknown> | null
  if (
    !raw ||
    !storage ||
    binding.facet !== 'personal' ||
    binding.grantId !== null ||
    binding.endpoint === 'local:'
  )
    return false
  const inspected = inspectConnection(storage)
  const c = inspected.connection
  return (
    !inspected.damaged.length &&
    !c.serverUrl &&
    !c.enrolledUrl &&
    !c.vaultId &&
    !c.deviceId &&
    (raw.facet === undefined || raw.facet === 'personal') &&
    raw.grantId == null
  )
}

/** Read the real connection, not the descriptor last written by an engine that may be old. */
export function hasScriptConnection(storage: LocalStorage | null): boolean {
  const token = currentToken(storage)
  if (token !== undefined)
    return !!token?.secretReference && !token.pending && token.status !== 'needs-token'
  storage = storage && selectedConnectionStorage(storage)
  const raw = storage?.loadLocalStorage(CONNECTION_KEY) as { vaultId?: unknown } | null
  return !!raw?.vaultId
}
export function assertCurrentScriptConnection(
  storage: LocalStorage | null,
  binding: ScriptBinding
): void {
  storage = storage && selectedConnectionStorage(storage)
  const raw = storage?.loadLocalStorage(CONNECTION_KEY)
  if (!raw || typeof raw !== 'object') {
    if (
      raw == null &&
      binding.endpoint === 'local:' &&
      binding.vaultId === 'local' &&
      binding.principal === 'local' &&
      binding.facet === 'personal' &&
      binding.grantId === null
    )
      return
    throw new Error('Script connection changed; execution blocked')
  }
  const extras = raw as Record<string, unknown>
  // Use the same supported legacy normalization as the connection keeper. Only a genuinely
  // absent enrolledUrl inherits serverUrl; malformed explicit values remain damaged.
  const inspected = inspectConnection(storage!)
  if (inspected.damaged.length) throw new Error('Script connection changed; execution blocked')
  const current = inspected.connection
  // Current supported device connections are personal. A grant must carry an explicit facet;
  // an unknown/malformed facet cannot be interpreted as personal authority.
  const facet = extras.facet === undefined && extras.grantId == null ? 'personal' : extras.facet
  const grant = extras.grantId ?? null
  // Disconnect clears the remote identity, not this device's exact-byte approvals.
  // Only a wholly disconnected PERSONAL context may use its retained personal store.
  if (
    !current.serverUrl &&
    !current.enrolledUrl &&
    !current.vaultId &&
    !current.deviceId &&
    facet === 'personal' &&
    grant === null &&
    binding.facet === 'personal'
  )
    return
  if (
    current.serverUrl !== binding.endpoint ||
    current.enrolledUrl !== binding.endpoint ||
    current.vaultId !== binding.vaultId ||
    current.deviceId !== binding.principal ||
    facet !== binding.facet ||
    grant !== binding.grantId ||
    (facet === 'scoped' && (typeof grant !== 'string' || !grant))
  ) {
    throw new Error('Script connection changed; execution blocked')
  }
}

/**
 * True only when every token connection is a folder connection whose folder does not hold
 * this script, and no whole-vault (legacy) connection or ledger exists. Such a script is
 * the owner's own local file: connections elsewhere in the vault do not govern it.
 * Anything uncertain (a group scope, the root folder, no scope yet) counts as covering it.
 */
export function scriptOutsideEverySyncScope(storage: LocalStorage | null, path: string): boolean {
  if (!storage || storage.loadLocalStorage(REGISTRY_KEY) == null) return false
  const legacy = storage.loadLocalStorage(CONNECTION_KEY) as { vaultId?: unknown } | null
  const ledger = storage.loadLocalStorage(LEDGER_KEY) as { stateId?: unknown } | null
  if (legacy?.vaultId || ledger?.stateId || storage.loadLocalStorage(SCOPED_CONNECTION_KEY) != null)
    return false
  let records: ReturnType<ConnectionRegistry['records']>
  try {
    records = ConnectionRegistry.open(storage).records()
  } catch {
    return false
  }
  if (!records.length) return false
  const trim = (value: string) => value.replace(/^\/+|\/+$/g, '')
  const file = caseKey(trim(path))
  const outside = (root: string | undefined) => {
    if (root === undefined) return true
    const folder = caseKey(trim(root))
    return !!folder && file !== folder && !file.startsWith(folder + '/')
  }
  return records.every((record) => {
    const scopes = [record.scope, record.pending?.scope]
    if (!record.scope && !record.pending) return false
    if (scopes.some((scope) => scope && scope.kind !== 'folder')) return false
    return (
      outside(record.scope?.path) &&
      outside(record.pending?.scope.path) &&
      outside(record.localRoot) &&
      outside(record.rootIssue?.kind === 'moved' ? record.rootIssue.path : undefined)
    )
  })
}
