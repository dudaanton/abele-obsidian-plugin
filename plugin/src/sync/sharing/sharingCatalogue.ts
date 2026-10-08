import { normalizeServerUrl } from '@abele/sync-protocol'
import type { SyncSettings } from '../settings'
import { z } from 'zod'

/** Offline discovery cache only. Signed-in server inventories replace these hints. */
export class DiscoveryCatalogueError extends Error {
  constructor() {
    super('Sharing discovery data is invalid and needs review')
  }
}
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
    .safeParse(raw === undefined ? [] : raw)
  if (!parsed.success) throw new DiscoveryCatalogueError()
  return parsed.data
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
    // Keep malformed entries visible to the consumer; never translate corruption into
    // an empty group inventory or destroy good entries beside a damaged one.
    ...(entry.groups !== undefined ? { groups: JSON.parse(JSON.stringify(entry.groups)) } : {}),
  }))
}
export interface SharingCatalogueEntry {
  issuer: string
  vaultId: string
  grants: string[]
  groups?: GroupShareHint[]
}
function entryFor(
  settings: SyncSettings,
  issuer: string,
  vaultId: string
): SharingCatalogueEntry | undefined {
  if (settings.sharing === undefined) return undefined
  const catalogue = migrateSharingCatalogue(settings.sharing)
  if (!catalogue) throw new DiscoveryCatalogueError()
  return catalogue.find((entry) => entry.issuer === issuer && entry.vaultId === vaultId)
}
export function groupsFor(
  settings: SyncSettings,
  issuer: string,
  vaultId: string
): GroupShareHint[] {
  return groupHints(entryFor(settings, issuer, vaultId)?.groups)
}
export function audiencesFor(settings: SyncSettings, issuer: string, vaultId: string): string[] {
  const entry = entryFor(settings, issuer, vaultId)
  return entry
    ? [...new Set([...entry.grants, ...groupHints(entry.groups).map((group) => group.id)])]
    : []
}
