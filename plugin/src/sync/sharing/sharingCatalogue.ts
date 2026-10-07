import { normalizeServerUrl } from '@abele/sync-protocol'
import type { SyncSettings } from '../settings'
import { z } from 'zod'

/** Last acknowledged group management data; the server has no group list or ACL read route.
 * This is a CAS hint only. Names are checked against the live owner visibility route. */
export const GroupShareHintSchema = z
  .object({
    id: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
    rootId: z.string().min(1).max(200),
    role: z.enum(['reader', 'editor']),
    revision: z.number().int().nonnegative().safe(),
    state: z.enum(['active', 'preparing', 'unavailable']),
  })
  .strict()
export type GroupShareHint = z.infer<typeof GroupShareHintSchema>
export function groupHints(raw: unknown): GroupShareHint[] {
  const parsed = z
    .array(GroupShareHintSchema)
    .max(64)
    .safeParse(raw ?? [])
  return parsed.success ? parsed.data : []
}

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
      entry.grants.length <= 64 &&
      entry.grants.every(
        (id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 200
      )
  )
  if (!valid) return undefined
  return raw.map((entry) => ({
    issuer: entry.issuer,
    vaultId: entry.vaultId,
    grants: [...new Set<string>(entry.grants)],
    ...(entry.groups !== undefined ? { groups: groupHints(entry.groups) } : {}),
  }))
}
export interface SharingCatalogueEntry {
  issuer: string
  vaultId: string
  grants: string[]
  groups?: GroupShareHint[]
}
export function groupsFor(
  settings: SyncSettings,
  issuer: string,
  vaultId: string
): GroupShareHint[] {
  return groupHints(
    settings.sharing?.find((entry) => entry.issuer === issuer && entry.vaultId === vaultId)?.groups
  )
}
export function audiencesFor(settings: SyncSettings, issuer: string, vaultId: string): string[] {
  const entry = settings.sharing?.find(
    (entry) => entry.issuer === issuer && entry.vaultId === vaultId
  )
  return entry
    ? [...new Set([...entry.grants, ...groupHints(entry.groups).map((group) => group.id)])]
    : []
}
