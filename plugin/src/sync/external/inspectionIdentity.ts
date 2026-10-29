import type { App } from 'obsidian'
import { nativeOf, vaultDisk } from '../vaultPathLinks'

export type InspectionIdentity = {
  size: number
  mtime: number
  ctime?: number
  identity?: string
}
export type InspectionEntry = InspectionIdentity & { path: string; marker: boolean }

/** A settled host row can reuse a completed inspection without a native identity read. */
export function trustedProjectionInspectionIdentity(
  app: App,
  path: string,
  prior: InspectionIdentity
): boolean {
  if (!Number.isFinite(prior.ctime) || path.split('/').some((part) => part.startsWith('.')))
    return false
  const indexed = app.vault.getFileByPath(path)
  if (!indexed || indexed.path !== path || !Number.isFinite(indexed.stat.ctime)) return false
  const cache = app.metadataCache as typeof app.metadataCache & {
    initialized?: boolean
    isCacheClean?: () => boolean
  }
  try {
    return (
      cache.initialized !== false &&
      cache.isCacheClean?.() === true &&
      indexed.stat.size === prior.size &&
      Math.max(0, Math.round(indexed.stat.mtime)) === prior.mtime &&
      indexed.stat.ctime === prior.ctime
    )
  } catch {
    return false
  }
}

/** Use the same disk metadata and native file identity as the scan fingerprint. */
export async function projectionInspectionIdentity(
  app: App,
  path: string,
  prior?: InspectionIdentity
): Promise<InspectionIdentity | null> {
  const disk = vaultDisk(app.vault)
  const native = nativeOf(disk)
  if (prior && trustedProjectionInspectionIdentity(app, path, prior)) return prior
  const indexed = app.vault.getFileByPath(path)
  // Portable scans use Obsidian's file index for ordinary vault files. Hidden/config
  // files are absent there and still need a direct adapter stat.
  const ordinary = native ? null : indexed
  const stat = ordinary ? { type: 'file' as const, ...ordinary.stat } : await disk.stat(path)
  if (stat?.type !== 'file') return null
  const identity = native?.fileIdentity ? await native.fileIdentity(path) : undefined
  // A native port that cannot prove its identity cannot reuse an earlier byte decision.
  if (native?.fileIdentity && !identity) return null
  return {
    size: stat.size,
    mtime: Math.max(0, Math.round(stat.mtime)),
    ...(Number.isFinite(stat.ctime) ? { ctime: stat.ctime } : {}),
    ...(identity ? { identity } : {}),
  }
}

export function sameInspectionIdentity(
  cached: InspectionIdentity,
  current: InspectionIdentity
): boolean {
  return (
    cached.size === current.size &&
    cached.mtime === current.mtime &&
    cached.identity === current.identity &&
    cached.ctime === current.ctime
  )
}

export function cacheableInspectionIdentity(identity: InspectionIdentity): boolean {
  return identity.identity !== undefined || identity.ctime !== undefined
}

export function sameInspectionEntry(a: InspectionEntry, b: InspectionEntry): boolean {
  return a.path === b.path && a.marker === b.marker && sameInspectionIdentity(a, b)
}
