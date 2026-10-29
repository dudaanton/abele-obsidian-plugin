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
  return trustedProjectionInspectionReason(app, path, prior) === 'hit'
}

/** Reasons are counted without paths in the connection's classification diagnostics. */
export function trustedProjectionInspectionReason(
  app: App,
  path: string,
  prior: InspectionIdentity
): string {
  if (!Number.isFinite(prior.ctime)) return 'saved-ctime-missing'
  if (path.split('/').some((part) => part.startsWith('.'))) return 'hidden-path'
  const indexed = app.vault.getFileByPath(path)
  if (!indexed || indexed.path !== path) return 'index-missing'
  if (!Number.isFinite(indexed.stat.ctime)) return 'index-ctime-missing'
  const cache = app.metadataCache as typeof app.metadataCache & {
    initialized?: boolean
    isCacheClean?: () => boolean
  }
  try {
    if (cache.initialized === false || cache.isCacheClean?.() !== true) return 'index-not-clean'
    if (indexed.stat.size !== prior.size) return 'size-mismatch'
    if (Math.max(0, Math.round(indexed.stat.mtime)) !== prior.mtime) return 'mtime-mismatch'
    if (indexed.stat.ctime !== prior.ctime) return 'ctime-mismatch'
    return 'hit'
  } catch {
    return 'index-not-clean'
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
  const metadata = app.metadataCache as typeof app.metadataCache & { isCacheClean?: () => boolean }
  // The host index's creation time is the one the SDK lists and persists. A native
  // identity separately includes status-change time, which must not replace it.
  const hostCtime =
    indexed?.path === path &&
    indexed.stat.size === stat.size &&
    Math.max(0, Math.round(indexed.stat.mtime)) === Math.max(0, Math.round(stat.mtime)) &&
    metadata?.isCacheClean?.() === true &&
    Number.isFinite(indexed.stat.ctime)
      ? indexed.stat.ctime
      : stat.ctime
  return {
    size: stat.size,
    mtime: Math.max(0, Math.round(stat.mtime)),
    ...(Number.isFinite(hostCtime) ? { ctime: hostCtime } : {}),
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
