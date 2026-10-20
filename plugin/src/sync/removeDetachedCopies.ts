import { fingerprintFile, type FileSystem, type StateStore } from '@abele/sync-sdk/core'
import { sha256 } from './external/hash'

export interface DetachedCopyPort {
  fs: FileSystem
  state: StateStore
  detached(): boolean
  covered(path: string): boolean
  /** The host holds its path coordinator and runtime fence throughout the callback. */
  lease<T>(path: string, work: () => Promise<T>): Promise<T>
}

/** Explicit device-only removal. No network client, scan, or server-delete operation is used. */
export async function removeDetachedCopies(
  port: DetachedCopyPort
): Promise<{ removed: number; kept: number }> {
  if (!port.detached()) throw new Error('Only an item no longer shared may lose its local copy')
  let removed = 0,
    kept = 0
  for await (const entry of port.state.all()) {
    await port.lease(entry.path, async () => {
      if (!port.detached()) throw new Error('The item is shared again; local removal stopped')
      if (port.covered(entry.path)) {
        kept++
        return
      }
      const info = await port.fs.stat(entry.path)
      if (!info) return
      // mtime alone is not evidence that the bytes are unchanged.
      const fingerprint = await fingerprintFile(port.fs, entry.path, sha256)
      if (fingerprint.sha !== entry.sha || fingerprint.size !== entry.size) {
        kept++
        return
      }
      const latest = await port.fs.stat(entry.path)
      if (!latest || latest.size !== info.size || latest.mtime !== info.mtime) {
        kept++
        return
      }
      if (!port.detached() || port.covered(entry.path)) {
        kept++
        return
      }
      await port.fs.remove(entry.path)
      await port.state.delete(entry.path)
      removed++
    })
  }
  return { removed, kept }
}
