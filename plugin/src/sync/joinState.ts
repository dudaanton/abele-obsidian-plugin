import type { JoinPrefer } from '@abele/sync-sdk/protocol'

/** Legacy join metadata retained for reading saved and transferred connections. */
export interface JoinState {
  /** The vault the legacy join targeted. */
  vaultId: string
  /**
   * `mine`: this device's copy becomes the head everywhere; `theirs`: the server's stays, and is
   * written here. Null is "merge both", which the engine does when it is told nothing.
   */
  prefer: JoinPrefer | null
  /** Whether the legacy join still awaited a choice. */
  ask: boolean
}

/**
 * The join a record holds, taken only whole. One that is there and does not read is taken as the
 * question asked again, on the vault the connection names — never as "merge", which is a choice
 * somebody would then not have made — and as nothing on a device with no vault to join.
 */
export function joinFrom(
  raw: unknown,
  vaultId: string
): { join: JoinState | null; damaged: boolean } {
  if (raw === undefined || raw === null) return { join: null, damaged: false }
  const o = typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  const prefer = o === null ? undefined : o.prefer === null ? null : preferOf(o.prefer)
  if (o !== null && typeof o.vaultId === 'string' && prefer !== undefined) {
    if (typeof o.ask === 'boolean') {
      return { join: { vaultId: o.vaultId, prefer, ask: o.ask }, damaged: false }
    }
  }
  return { join: vaultId === '' ? null : { vaultId, prefer: null, ask: true }, damaged: true }
}

/** A valid stored legacy preference, or undefined for malformed metadata. */
const preferOf = (raw: unknown): JoinPrefer | undefined =>
  raw === 'mine' || raw === 'theirs' ? raw : undefined
