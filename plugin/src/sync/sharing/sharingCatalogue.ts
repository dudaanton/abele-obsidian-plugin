import { normalizeServerUrl } from '@abele/sync-protocol'
import type { SyncSettings } from '../settings'

/** Portable discovery hints only. Every question/add still needs fresh server visibility and
 * intrinsic sponsor proof; this list is never publication consent or an account credential. */
export function migrateSharingCatalogue(raw: unknown): SharingCatalogueEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length > 16) return undefined
  const valid = raw.every(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      typeof entry.issuer === 'string' &&
      normalizeServerUrl(entry.issuer) === entry.issuer &&
      typeof entry.vaultId === 'string' &&
      entry.vaultId.length > 0 &&
      entry.vaultId.length <= 200 &&
      Array.isArray(entry.grants) &&
      entry.grants.length <= 16 &&
      entry.grants.every(
        (id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 200
      )
  )
  if (!valid) return undefined
  return raw.map((entry) => ({
    issuer: entry.issuer,
    vaultId: entry.vaultId,
    grants: [...new Set<string>(entry.grants)],
  }))
}
export interface SharingCatalogueEntry {
  issuer: string
  vaultId: string
  grants: string[]
}
export function audiencesFor(settings: SyncSettings, issuer: string, vaultId: string): string[] {
  return (
    settings.sharing
      ?.find((entry) => entry.issuer === issuer && entry.vaultId === vaultId)
      ?.grants.slice() ?? []
  )
}
