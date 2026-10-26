import type { App } from 'obsidian'
import { nativeOf, vaultDisk } from '../vaultPathLinks'

export type InspectionIdentity = {
  size: number
  mtime: number
  ctime?: number
  identity?: string
}
export type InspectionEntry = InspectionIdentity & { path: string; marker: boolean }

/** Use the same disk metadata and native file identity as the scan fingerprint. */
export async function projectionInspectionIdentity(
  app: App,
  path: string
): Promise<InspectionIdentity | null> {
  const disk = vaultDisk(app.vault)
  const native = nativeOf(disk)
  // Portable scans use Obsidian's file index for ordinary vault files. Hidden/config
  // files are absent there and still need a direct adapter stat.
  const indexed = native ? null : app.vault.getFileByPath(path)
  const stat = indexed ? { type: 'file' as const, ...indexed.stat } : await disk.stat(path)
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
