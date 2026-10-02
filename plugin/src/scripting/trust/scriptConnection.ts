import type { LocalStorage } from '@/sync/ledgerId'
import { CONNECTION_KEY, inspectConnection } from '@/sync/connection'
import type { ScriptBinding } from './ScriptProvenance'

/** Read the real connection, not the descriptor last written by an engine that may be old. */
export function hasScriptConnection(storage: LocalStorage | null): boolean {
  const raw = storage?.loadLocalStorage(CONNECTION_KEY) as { vaultId?: unknown } | null
  return !!raw?.vaultId
}
export function assertCurrentScriptConnection(
  storage: LocalStorage | null,
  binding: ScriptBinding
): void {
  const raw = storage?.loadLocalStorage(CONNECTION_KEY)
  if (!raw || typeof raw !== 'object')
    throw new Error('Script connection changed; execution blocked')
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
